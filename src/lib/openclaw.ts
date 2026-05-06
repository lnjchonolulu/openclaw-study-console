function extractAssistantText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const directTextKeys = ["output_text", "text", "message", "response"];

  for (const key of directTextKeys) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const output = candidate.output;
  if (Array.isArray(output)) {
    const fragments = output
      .flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }

        const record = item as Record<string, unknown>;
        const content = record.content;

        if (!Array.isArray(content)) {
          return [];
        }

        return content
          .map((part) => {
            if (!part || typeof part !== "object") {
              return null;
            }

            const text = (part as Record<string, unknown>).text;
            return typeof text === "string" ? text : null;
          })
          .filter((text): text is string => Boolean(text));
      })
      .join("\n")
      .trim();

    if (fragments) {
      return fragments;
    }
  }

  return null;
}

function getResponsesEndpoint() {
  const configuredUrl = process.env.OPENCLAW_RESPONSES_URL?.trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();

  if (!gatewayUrl) {
    throw new Error("Missing OPENCLAW_GATEWAY_URL or OPENCLAW_RESPONSES_URL.");
  }

  if (gatewayUrl.startsWith("ws://")) {
    return `${gatewayUrl.replace(/^ws:\/\//, "http://")}/v1/responses`;
  }

  if (gatewayUrl.startsWith("wss://")) {
    return `${gatewayUrl.replace(/^wss:\/\//, "https://")}/v1/responses`;
  }

  if (gatewayUrl.startsWith("http://") || gatewayUrl.startsWith("https://")) {
    return gatewayUrl.endsWith("/v1/responses") ? gatewayUrl : `${gatewayUrl}/v1/responses`;
  }

  throw new Error("Unsupported OpenClaw gateway URL format.");
}

export async function runAgentTurn({
  agentId,
  message,
  conversationKey,
}: {
  agentId: string;
  message: string;
  conversationKey: string;
}) {
  const endpoint = getResponsesEndpoint();
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      model: `openclaw:${agentId}`,
      input: message,
      user: conversationKey,
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : `OpenClaw HTTP API returned ${response.status}.`,
    );
  }

  const assistantText = extractAssistantText(payload);

  if (!assistantText) {
    console.log("[openclaw] empty assistant payload", { agentId, conversationKey, payload });
    throw new Error("OpenClaw returned an empty assistant response.");
  }

  return {
    assistantText,
    payload,
  };
}
