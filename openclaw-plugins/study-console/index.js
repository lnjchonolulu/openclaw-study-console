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

function withoutTurnContextId(params) {
  const rest = { ...(params ?? {}) };
  delete rest.turnContextId;

  return rest;
}

async function callCyWorldTool(ctx, toolName, callId, params) {
  const senderAgentOpenclawId = deriveAgentId(ctx);

  if (!senderAgentOpenclawId) {
    return {
      ok: false,
      reason: "missing_agent_identity",
    };
  }

  const turnContextId =
    typeof params?.turnContextId === "string" ? params.turnContextId.trim() : "";

  if (!turnContextId) {
    return {
      ok: false,
      reason: "missing_turn_context_id",
      guidance:
        "Use the turnContextId from the CyWorld Plugin Turn Context section of the current runtime instructions.",
    };
  }

  return callStudyConsole(ctx, "/tool-call", {
    argumentsJson: JSON.stringify(withoutTurnContextId(params)),
    callId: String(callId || `${toolName}:${Date.now()}`),
    senderAgentOpenclawId,
    toolName,
    turnContextId,
  });
}

const turnContextProperty = {
  type: "string",
  description:
    "The exact turnContextId from the CyWorld Plugin Turn Context section of the current runtime instructions.",
};

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

function createListPendingTasksTool(ctx) {
  return {
    name: "study_list_pending_tasks",
    label: "CyWorld Pending Tasks",
    description:
      "Inspect CyWorld's durable action log for this agent, including app-mediated requests, handoffs, external messages, email threads, and tool receipts. Use this when you need factual execution history; keep your own plans in OpenClaw workspace notes.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "number",
          description:
            "Optional maximum number of pending tasks to return, from 1 to 50.",
        },
      },
      required: [],
    },
    async execute(_id, params) {
      const agentOpenclawId = deriveAgentId(ctx);

      if (!agentOpenclawId) {
        return jsonToolResult({
          ok: false,
          reason: "missing_agent_identity",
        });
      }

      const result = await callStudyConsole(ctx, "/pending-tasks", {
        agentOpenclawId,
        limit: Number(params?.limit) || undefined,
      });

      return jsonToolResult(result);
    },
  };
}

function createRecallConversationTool(ctx) {
  return {
    name: "study_recall_conversation",
    label: "CyWorld Recall Conversation",
    description:
      "Recall CyWorld conversation history that this agent is allowed to use. Omit withUsername and teamChannelName for the current DM or Team Chat. Set withUsername to recall this agent's DM with a specific human, or teamChannelName to recall a Team Chat. Use this only when older conversation context is actually needed. CyWorld enforces room membership and the owner's conversation-memory sharing policy.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "number",
          description: "Maximum matching messages to return, from 1 to 30.",
        },
        query: {
          type: "string",
          description:
            "Optional text to search for. Omit it to retrieve the most recent messages in the selected conversation.",
        },
        teamChannelName: {
          type: "string",
          description:
            "Optional CyWorld Team Chat channel name. Do not combine with withUsername.",
        },
        turnContextId: turnContextProperty,
        withUsername: {
          type: "string",
          description:
            "Optional CyWorld username whose DM with this agent should be recalled, without @. Do not combine with teamChannelName.",
        },
      },
      required: ["turnContextId"],
    },
    async execute(id, params) {
      return jsonToolResult(
        await callCyWorldTool(ctx, "study_recall_conversation", id, params),
      );
    },
  };
}

function createUpdateOwnerSharingPoliciesTool(ctx) {
  return {
    name: "study_update_owner_sharing_policies",
    label: "CyWorld Update Owner Sharing Policies",
    description:
      "Save the owner's choices for calendar sharing and remembered-conversation sharing. Use only while speaking directly with this agent's owner, especially during bootstrap after the owner has clearly chosen Never, Ask every time, or Always allowed. Omit a field that the owner has not decided.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        calendarSharingPolicy: {
          type: "string",
          enum: ["never", "ask_each_time", "always"],
        },
        conversationMemorySharingPolicy: {
          type: "string",
          enum: ["never", "ask_each_time", "always"],
        },
        turnContextId: turnContextProperty,
      },
      required: ["turnContextId"],
    },
    async execute(id, params) {
      return jsonToolResult(
        await callCyWorldTool(ctx, "study_update_owner_sharing_policies", id, params),
      );
    },
  };
}

function createSetRelationshipGuidanceTool(ctx) {
  return {
    name: "study_set_relationship_guidance",
    label: "CyWorld Set Relationship Guidance",
    description:
      "Save whether the owner wants one general Shared Spaces approach or person-specific social guidance. Use only while speaking directly with this agent's owner. Person-specific entries are free-text owner preferences for how this agent should relate to known CyWorld users; they are not permissions and must not be invented.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["general", "person_specific"],
        },
        relationships: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              interactionGuidance: {
                type: "string",
                description:
                  "Optional natural-language guidance for tone, distance, candor, or social stance with this person.",
              },
              relationshipLabel: {
                type: "string",
                description:
                  "Optional owner-authored description such as senior colleague or close friend.",
              },
              username: {
                type: "string",
                description: "Existing active CyWorld username, without @.",
              },
            },
            required: ["username"],
          },
        },
        turnContextId: turnContextProperty,
      },
      required: ["mode", "turnContextId"],
    },
    async execute(id, params) {
      return jsonToolResult(
        await callCyWorldTool(ctx, "study_set_relationship_guidance", id, params),
      );
    },
  };
}

function createScheduleWakeupTool(ctx) {
  return {
    name: "study_schedule_wakeup",
    label: "CyWorld Schedule Agent Wakeup",
    description:
      "Schedule a future wakeup for this same OpenClaw agent when there is a specific reason to reconsider something later. This is a judgment opportunity, not an automatic reminder message. At wakeup time CyWorld will provide the purpose and recent room context; the agent must decide what, if anything, to do.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        delayMinutes: {
          type: "number",
          description:
            "Optional delay from now in minutes. Provide either delayMinutes or wakeAt.",
        },
        purpose: {
          type: "string",
          description:
            "Why the agent should wake later, including what to check or reconsider.",
        },
        turnContextId: turnContextProperty,
        wakeAt: {
          type: "string",
          description:
            "Optional ISO 8601 datetime for the wakeup. Provide either wakeAt or delayMinutes.",
        },
      },
      required: ["purpose", "turnContextId"],
    },
    async execute(id, params) {
      return jsonToolResult(
        await callCyWorldTool(ctx, "study_schedule_wakeup", id, params),
      );
    },
  };
}

export default definePluginEntry({
  id: "study_console",
  name: "CyWorld",
  description: "CyWorld action-log inspection and participant messaging tools.",
  register(api) {
    api.registerTool((ctx) => createRecallConversationTool(ctx), {
      name: "study_recall_conversation",
    });
    api.registerTool((ctx) => createListPendingTasksTool(ctx), {
      name: "study_list_pending_tasks",
    });
    api.registerTool((ctx) => createScheduleWakeupTool(ctx), {
      name: "study_schedule_wakeup",
    });
    api.registerTool((ctx) => createSendDmTool(ctx), { name: "study_send_dm" });
    api.registerTool((ctx) => createScheduleDmTool(ctx), {
      name: "study_schedule_dm",
    });
    api.registerTool((ctx) => createSetRelationshipGuidanceTool(ctx), {
      name: "study_set_relationship_guidance",
    });
    api.registerTool((ctx) => createUpdateOwnerSharingPoliciesTool(ctx), {
      name: "study_update_owner_sharing_policies",
    });
  },
});
