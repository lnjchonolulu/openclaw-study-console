import { t as definePluginEntry } from "/usr/lib/node_modules/openclaw/dist/plugin-entry-9sXOq4uc.js";

function jsonToolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

function deriveAgentId(ctx) {
  const candidates = [
    ctx?.agentId,
    ctx?.agent?.id,
    ctx?.route?.agentId,
    ctx?.session?.agentId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const agentDir = typeof ctx?.agentDir === "string" ? ctx.agentDir : "";
  const match = agentDir.match(/\/agents\/([^/]+)\/agent\/?$/);

  return match?.[1] ?? "";
}

function getPluginConfig(ctx) {
  const entries = ctx?.config?.plugins?.entries;
  const config = entries?.study_console?.config ?? {};

  return {
    baseUrl:
      typeof config.baseUrl === "string" && config.baseUrl.trim()
        ? config.baseUrl.replace(/\/+$/, "")
        : "http://127.0.0.1:3000/api/internal/agent-actions",
    token:
      typeof config.token === "string" && config.token.trim()
        ? config.token.trim()
        : "",
  };
}

async function callStudyConsole(ctx, path, body) {
  const { baseUrl, token } = getPluginConfig(ctx);

  if (!token) {
    return {
      ok: false,
      reason: "missing_internal_agent_action_token",
    };
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      reason: "study_console_api_error",
      status: response.status,
      payload,
    };
  }

  return payload;
}

function createSendDmTool(ctx) {
  return {
    name: "study_send_dm",
    label: "CyWorld Send DM",
    description:
      "Send a CyWorld DM to another human participant. Use it when the conversation clearly asks this agent to contact, ask, tell, update, remind, or message a different CyWorld person, even if the user does not say 'DM'. Do not use sessions_send, message, gateway, or cron for CyWorld participants.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        toUsername: {
          type: "string",
          description: "Recipient CyWorld username without @.",
        },
        message: {
          type: "string",
          description: "Exact message to deliver to the participant.",
        },
      },
      required: ["toUsername", "message"],
    },
    async execute(_id, params) {
      const senderAgentOpenclawId = deriveAgentId(ctx);

      if (!senderAgentOpenclawId) {
        return jsonToolResult({
          ok: false,
          reason: "missing_agent_identity",
        });
      }

      const result = await callStudyConsole(ctx, "/send-dm", {
        senderAgentOpenclawId,
        toUsername: String(params.toUsername ?? "").replace(/^@/, ""),
        message: String(params.message ?? ""),
      });

      return jsonToolResult(result);
    },
  };
}

function createScheduleDmTool(ctx) {
  return {
    name: "study_schedule_dm",
    label: "CyWorld Schedule DM",
    description:
      "Schedule a future CyWorld DM to a human participant. Use it when the user clearly wants someone to receive a message later, regardless of whether they say 'DM'. Do not use OpenClaw cron for CyWorld participant messages.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        toUsername: {
          type: "string",
          description: "Recipient CyWorld username without @.",
        },
        message: {
          type: "string",
          description: "Exact message to deliver later.",
        },
        delayMinutes: {
          type: "number",
          description: "Delay from now in minutes. For one hour, use 60.",
        },
      },
      required: ["toUsername", "message", "delayMinutes"],
    },
    async execute(_id, params) {
      const senderAgentOpenclawId = deriveAgentId(ctx);

      if (!senderAgentOpenclawId) {
        return jsonToolResult({
          ok: false,
          reason: "missing_agent_identity",
        });
      }

      const result = await callStudyConsole(ctx, "/schedule-dm", {
        senderAgentOpenclawId,
        toUsername: String(params.toUsername ?? "").replace(/^@/, ""),
        message: String(params.message ?? ""),
        delayMinutes: Number(params.delayMinutes),
      });

      return jsonToolResult(result);
    },
  };
}

export default definePluginEntry({
  id: "study_console",
  name: "CyWorld",
  description: "CyWorld participant messaging tools.",
  register(api) {
    api.registerTool((ctx) => createSendDmTool(ctx), { name: "study_send_dm" });
    api.registerTool((ctx) => createScheduleDmTool(ctx), {
      name: "study_schedule_dm",
    });
  },
});
