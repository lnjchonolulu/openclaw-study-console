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

type OpenClawFunctionTool = {
  description?: string;
  name: string;
  parameters: Record<string, unknown>;
};

type OpenClawFunctionCall = {
  argumentsJson: string;
  callId: string;
  name: string;
};

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

async function invokeOpenClawResponse({
  agentId,
  input,
  instructions,
  previousResponseId,
  tools,
  conversationKey,
}: {
  agentId: string;
  input: string | Array<Record<string, unknown>>;
  instructions?: string;
  previousResponseId?: string;
  tools?: OpenClawFunctionTool[];
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
      ...(instructions ? { instructions } : {}),
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      ...(tools?.length
        ? {
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
      input,
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

  return payload;
}

function extractFunctionCalls(payload: unknown): OpenClawFunctionCall[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidate = payload as Record<string, unknown>;
  const output = candidate.output;

  if (!Array.isArray(output)) {
    return [];
  }

  return output.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const type = record.type;

    if (type !== "function_call") {
      return [];
    }

    const name =
      typeof record.name === "string"
        ? record.name
        : typeof (record.function as Record<string, unknown> | undefined)?.name === "string"
          ? ((record.function as Record<string, unknown>).name as string)
          : null;

    const callId =
      typeof record.call_id === "string"
        ? record.call_id
        : typeof record.id === "string"
          ? record.id
          : null;

    const argumentsJson =
      typeof record.arguments === "string"
        ? record.arguments
        : typeof (record.function as Record<string, unknown> | undefined)?.arguments === "string"
          ? ((record.function as Record<string, unknown>).arguments as string)
          : null;

    if (!name || !callId || !argumentsJson) {
      return [];
    }

    return [
      {
        argumentsJson,
        callId,
        name,
      },
    ];
  });
}

export async function runAgentTurn({
  agentId,
  instructions,
  message,
  conversationKey,
  tools,
  onToolCall,
}: {
  agentId: string;
  instructions?: string;
  message: string;
  conversationKey: string;
  tools?: OpenClawFunctionTool[];
  onToolCall?: (call: OpenClawFunctionCall) => Promise<string>;
}) {
  let payload = await invokeOpenClawResponse({
    agentId,
    input: message,
    instructions,
    tools,
    conversationKey,
  });

  if (tools?.length && onToolCall) {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const functionCalls = extractFunctionCalls(payload);

      if (functionCalls.length === 0) {
        break;
      }

      const outputs = await Promise.all(
        functionCalls.map(async (call) => ({
          call_id: call.callId,
          output: await onToolCall(call),
          type: "function_call_output",
        })),
      );

      payload = await invokeOpenClawResponse({
        agentId,
        input: outputs,
        instructions,
        previousResponseId: typeof payload.id === "string" ? payload.id : undefined,
        tools,
        conversationKey,
      });
    }
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
