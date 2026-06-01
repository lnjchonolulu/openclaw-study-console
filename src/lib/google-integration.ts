import { type Prisma } from "@prisma/client";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

type GoogleTokenJson = {
  access_token?: string;
  expiry_date?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
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

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.");
  }

  return new google.auth.OAuth2(clientId, clientSecret, getGoogleRedirectUri());
}

function toTokenJson(value: unknown): GoogleTokenJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as GoogleTokenJson;
}

export function googleAuthUrl(state: string) {
  const client = getOAuthClient();

  return client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  });
}

export async function saveGoogleAuthCode({
  code,
  connectedById,
}: {
  code: string;
  connectedById: string;
}) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const profile = await oauth2.userinfo.get();
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
    refresh_token: tokens.refresh_token ?? currentTokens.refresh_token,
  };

  await prisma.externalIntegration.upsert({
    where: {
      provider: "GOOGLE",
    },
    update: {
      accountEmail: profile.data.email ?? null,
      connectedAt: new Date(),
      connectedById,
      scopes: GOOGLE_SCOPES,
      tokenJson: nextTokens as Prisma.InputJsonValue,
    },
    create: {
      accountEmail: profile.data.email ?? null,
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

export async function getAuthorizedGoogleClient() {
  const integration = await prisma.externalIntegration.findUnique({
    where: {
      provider: "GOOGLE",
    },
  });

  if (!integration) {
    return null;
  }

  const client = getOAuthClient();
  client.setCredentials(toTokenJson(integration.tokenJson));
  client.on("tokens", (tokens) => {
    const current = toTokenJson(integration.tokenJson);
    void prisma.externalIntegration.update({
      where: {
        provider: "GOOGLE",
      },
      data: {
        tokenJson: {
          ...current,
          ...tokens,
          refresh_token: tokens.refresh_token ?? current.refresh_token,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return client;
}

function getCalendarId() {
  return process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";
}

export async function upsertGoogleCalendarEvent(eventId: string) {
  const auth = await getAuthorizedGoogleClient();

  if (!auth) {
    return { ok: false, reason: "google_not_connected" };
  }

  const event = await prisma.calendarEvent.findUnique({
    where: {
      id: eventId,
    },
    include: {
      createdBy: true,
      invitations: {
        include: {
          invitedUser: true,
        },
      },
    },
  });

  if (!event) {
    return { ok: false, reason: "event_not_found" };
  }

  const calendar = google.calendar({ auth, version: "v3" });
  const calendarId = getCalendarId();
  const descriptionLines = [
    event.description,
    "",
    "Created from CyWorld.",
    event.createdBy ? `CyWorld creator: ${event.createdBy.displayName} (@${event.createdBy.username})` : null,
    event.invitations.length
      ? `CyWorld invitees: ${event.invitations
          .map((invitation) => `@${invitation.invitedUser.username} (${invitation.status})`)
          .join(", ")}`
      : null,
  ].filter((line): line is string => Boolean(line));
  const requestBody = {
    description: descriptionLines.join("\n"),
    end: {
      dateTime: event.endAt.toISOString(),
    },
    location: event.location ?? undefined,
    start: {
      dateTime: event.startAt.toISOString(),
    },
    summary: event.title,
  };

  if (event.externalProvider === "google" && event.externalEventId) {
    const updated = await calendar.events.update({
      calendarId,
      eventId: event.externalEventId,
      requestBody,
    });

    return {
      externalEventId: updated.data.id ?? event.externalEventId,
      ok: true,
    };
  }

  const created = await calendar.events.insert({
    calendarId,
    requestBody,
  });

  if (created.data.id) {
    await prisma.calendarEvent.update({
      where: {
        id: event.id,
      },
      data: {
        externalEventId: created.data.id,
        externalProvider: "google",
      },
    });
  }

  return {
    externalEventId: created.data.id ?? null,
    ok: true,
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

export async function sendSharedGmail({
  body,
  subject,
  to,
}: {
  body: string;
  subject: string;
  to: string;
}) {
  const auth = await getAuthorizedGoogleClient();

  if (!auth) {
    return {
      ok: false,
      reason: "google_not_connected",
    };
  }

  const integration = await getGoogleIntegrationStatus();
  const gmail = google.gmail({ auth, version: "v1" });
  const message = [
    `To: ${sanitizeHeader(to)}`,
    integration.accountEmail ? `From: ${sanitizeHeader(integration.accountEmail)}` : null,
    `Subject: ${sanitizeHeader(subject)}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ]
    .filter((line): line is string => line !== null)
    .join("\r\n");
  const result = await gmail.users.messages.send({
    requestBody: {
      raw: base64UrlEncode(message),
    },
    userId: "me",
  });

  return {
    accountEmail: integration.accountEmail,
    messageId: result.data.id ?? null,
    ok: true,
  };
}
