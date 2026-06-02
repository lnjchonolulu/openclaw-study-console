import { type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

type GoogleTokenJson = {
  access_token?: string;
  expires_in?: number;
  expiry_date?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleAccess = {
  accessToken: string;
  accountEmail: string | null;
};

function getGoogleRedirectUri() {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();

  if (configured) {
    return configured;
  }

  const baseUrl = process.env.APP_BASE_URL?.trim();

  if (!baseUrl) {
    throw new Error("Missing GOOGLE_REDIRECT_URI or APP_BASE_URL.");
  }

  return `${baseUrl.replace(/\/$/, "")}/api/integrations/google/callback`;
}

function getGoogleClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.");
  }

  return {
    clientId,
    clientSecret,
    redirectUri: getGoogleRedirectUri(),
  };
}

function toTokenJson(value: unknown): GoogleTokenJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as GoogleTokenJson;
}

async function googleJson<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T & { error?: string; error_description?: string }) : null;

  if (!response.ok) {
    const message = data?.error_description || data?.error || response.statusText;
    throw new Error(`Google API request failed: ${message}`);
  }

  return data as T;
}

export function googleAuthUrl(state: string) {
  const { clientId, redirectUri } = getGoogleClientConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", state);

  return url.toString();
}

async function exchangeGoogleCode(code: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  return googleJson<GoogleTokenJson>("https://oauth2.googleapis.com/token", {
    body,
    method: "POST",
  });
}

async function refreshGoogleToken(tokens: GoogleTokenJson) {
  if (!tokens.refresh_token) {
    throw new Error("Google refresh token is missing. Reconnect Google.");
  }

  const { clientId, clientSecret } = getGoogleClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });

  const refreshed = await googleJson<GoogleTokenJson>(
    "https://oauth2.googleapis.com/token",
    {
      body,
      method: "POST",
    },
  );

  return {
    ...tokens,
    ...refreshed,
    expiry_date: refreshed.expires_in
      ? Date.now() + refreshed.expires_in * 1000
      : refreshed.expiry_date,
    refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
  } satisfies GoogleTokenJson;
}

async function fetchGoogleUserEmail(accessToken: string) {
  const profile = await googleJson<{ email?: string }>(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    },
  );

  return profile.email ?? null;
}

export async function saveGoogleAuthCode({
  code,
  connectedById,
}: {
  code: string;
  connectedById: string;
}) {
  const tokens = await exchangeGoogleCode(code);
  const existing = await prisma.externalIntegration.findUnique({
    where: {
      provider: "GOOGLE",
    },
    select: {
      tokenJson: true,
    },
  });
  const currentTokens = toTokenJson(existing?.tokenJson);
  const nextTokens = {
    ...currentTokens,
    ...tokens,
    expiry_date: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : tokens.expiry_date,
    refresh_token: tokens.refresh_token ?? currentTokens.refresh_token,
  };
  const accountEmail = nextTokens.access_token
    ? await fetchGoogleUserEmail(nextTokens.access_token)
    : null;

  await prisma.externalIntegration.upsert({
    where: {
      provider: "GOOGLE",
    },
    update: {
      accountEmail,
      connectedAt: new Date(),
      connectedById,
      scopes: GOOGLE_SCOPES,
      tokenJson: nextTokens as Prisma.InputJsonValue,
    },
    create: {
      accountEmail,
      connectedById,
      provider: "GOOGLE",
      scopes: GOOGLE_SCOPES,
      tokenJson: nextTokens as Prisma.InputJsonValue,
    },
  });
}

export async function getGoogleIntegrationStatus() {
  const integration = await prisma.externalIntegration.findUnique({
    where: {
      provider: "GOOGLE",
    },
    select: {
      accountEmail: true,
      connectedAt: true,
      scopes: true,
    },
  });

  return {
    accountEmail: integration?.accountEmail ?? null,
    connected: Boolean(integration),
    connectedAt: integration?.connectedAt.toISOString() ?? null,
    scopes: integration?.scopes ?? [],
  };
}

export async function disconnectGoogleIntegration() {
  await prisma.externalIntegration.deleteMany({
    where: {
      provider: "GOOGLE",
    },
  });
}

async function getGoogleAccess(): Promise<GoogleAccess | null> {
  const integration = await prisma.externalIntegration.findUnique({
    where: {
      provider: "GOOGLE",
    },
  });

  if (!integration) {
    return null;
  }

  let tokens = toTokenJson(integration.tokenJson);

  if (
    !tokens.access_token ||
    !tokens.expiry_date ||
    tokens.expiry_date < Date.now() + 60_000
  ) {
    tokens = await refreshGoogleToken(tokens);
    await prisma.externalIntegration.update({
      where: {
        provider: "GOOGLE",
      },
      data: {
        tokenJson: tokens as Prisma.InputJsonValue,
      },
    });
  }

  if (!tokens.access_token) {
    return null;
  }

  return {
    accessToken: tokens.access_token,
    accountEmail: integration.accountEmail,
  };
}

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? value;
}

function buildPlainTextMessage({
  body,
  cc,
  from,
  subject,
  to,
}: {
  body: string;
  cc?: string | null;
  from: string | null;
  subject: string;
  to: string;
}) {
  return [
    `To: ${sanitizeHeader(to)}`,
    cc ? `Cc: ${sanitizeHeader(cc)}` : null,
    from ? `From: ${sanitizeHeader(from)}` : null,
    `Subject: ${sanitizeHeader(subject)}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ]
    .filter((line): line is string => line !== null)
    .join("\r\n");
}

function buildMultipartMessage({
  attachments,
  body,
  cc,
  from,
  subject,
  to,
}: {
  attachments: {
    content: string;
    contentType: string;
    filename: string;
  }[];
  body: string;
  cc?: string | null;
  from: string | null;
  subject: string;
  to: string;
}) {
  const boundary = `cyworld-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const parts = [
    [
      `To: ${sanitizeHeader(to)}`,
      cc ? `Cc: ${sanitizeHeader(cc)}` : null,
      from ? `From: ${sanitizeHeader(from)}` : null,
      `Subject: ${sanitizeHeader(subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ]
      .filter((line): line is string => line !== null)
      .join("\r\n"),
    ...attachments.map((attachment) =>
      [
        `--${boundary}`,
        `Content-Type: ${attachment.contentType}; name="${sanitizeHeader(attachment.filename)}"`,
        `Content-Disposition: attachment; filename="${sanitizeHeader(attachment.filename)}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(Buffer.from(attachment.content, "utf8").toString("base64")),
      ].join("\r\n"),
    ),
    `--${boundary}--`,
  ];

  return parts.join("\r\n");
}

export async function sendSharedGmail({
  attachments = [],
  body,
  cc,
  subject,
  to,
}: {
  attachments?: {
    content: string;
    contentType: string;
    filename: string;
  }[];
  body: string;
  cc?: string | null;
  subject: string;
  to: string;
}) {
  const access = await getGoogleAccess();

  if (!access) {
    return {
      ok: false,
      reason: "google_not_connected",
    };
  }

  const message =
    attachments.length > 0
      ? buildMultipartMessage({
          attachments,
          body,
          cc,
          from: access.accountEmail,
          subject,
          to,
        })
      : buildPlainTextMessage({
          body,
          cc,
          from: access.accountEmail,
          subject,
          to,
        });
  const result = await googleJson<{ id?: string }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      body: JSON.stringify({
        raw: base64UrlEncode(message),
      }),
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  return {
    accountEmail: access.accountEmail,
    messageId: result.id ?? null,
    ok: true,
  };
}
