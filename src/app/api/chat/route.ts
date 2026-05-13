import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateAgentDmRoom } from "@/lib/dm";
import {
  executeAgentActions,
  executeSendHumanDm,
  parseAgentActions,
  type SendHumanDmArgs,
} from "@/lib/agent-actions";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

function looksLikeHumanDmRequest(message: string, usernames: string[]) {
  const normalized = message.toLowerCase();
  const intentPattern =
    /\b(send|message|dm|tell|notify|text|reach out to|contact)\b/;

  if (!intentPattern.test(normalized)) {
    return false;
  }

  return usernames.some((username) => {
    const lowered = username.toLowerCase();
    return normalized.includes(`@${lowered}`) || normalized.includes(lowered);
  });
}

function containsGatewayToolFailureText(text: string) {
  const normalized = text.toLowerCase();
  const blockedPatterns = [
    "pairing required",
    "sessions_send",
    "session pairing",
    "gateway-level pairing",
    "gateway pairing",
    "cron also needs pairing",
    "gateway is rejecting",
    "gateway closed",
    "cron scheduler",
    "subagent spawning",
    "openclaw gateway restart",
    "scheduler isn't available",
  ];

  return blockedPatterns.some((pattern) => normalized.includes(pattern));
}

function looksLikeScheduledDeliveryRequest(message: string) {
  const normalized = message.toLowerCase();

  const delayPatterns = [
    /\bafter\s+\d+\s*(minute|minutes|min|hour|hours|hr|hrs)\b/,
    /\bin\s+\d+\s*(minute|minutes|min|hour|hours|hr|hrs)\b/,
    /\b(later|tomorrow|tonight|this evening|next week)\b/,
  ];

  return delayPatterns.some((pattern) => pattern.test(normalized));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as { agentId?: string; message?: string };
  const targetAgentId = body.agentId?.trim() || user.agent?.openclawAgentId;
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  if (!targetAgentId) {
    return NextResponse.json(
      { error: "This study account is not linked to an OpenClaw agent yet." },
      { status: 400 },
    );
  }

  const dmRoom = await getOrCreateAgentDmRoom(user.id, targetAgentId);

  if (!dmRoom) {
    return NextResponse.json({ error: "Selected agent was not found." }, { status: 404 });
  }

  await prisma.typingState.deleteMany({
    where: {
      roomId: dmRoom.room.id,
      userId: user.id,
    },
  });

  await prisma.message.create({
    data: {
      roomId: dmRoom.room.id,
      userId: user.id,
      role: "USER",
      content: message,
    },
  });

  await prisma.room.update({
    where: {
      id: dmRoom.room.id,
    },
    data: {},
  });

  try {
    const audience =
      dmRoom.targetAgent.userId === user.id ? "direct_line" : "shared_spaces";
    const activeHumans = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
      },
      orderBy: {
        username: "asc",
      },
      select: {
        username: true,
      },
    });
    const instructions = buildAgentRuntimeInstructions({
      agentDisplayName: dmRoom.targetAgent.displayName,
      audience,
      availableHumanUsernames: activeHumans.map((human) => human.username),
      behaviorConfig: dmRoom.targetAgent.soulConfigJson,
      counterpartLabel:
        audience === "direct_line"
          ? `${user.displayName} (@${user.username})`
          : `${user.displayName} (@${user.username}), who is not the owner of this agent`,
      ownerDisplayName: dmRoom.targetAgent.user.displayName,
      ownerUsername: dmRoom.targetAgent.user.username,
      personaSummary: dmRoom.targetAgent.personaSummary,
    });

    let successfulToolDeliveries = 0;

    const toolExecutor = async (call: {
      argumentsJson: string;
      name: string;
    }) => {
      if (call.name !== "send_human_dm") {
        return JSON.stringify({
          ok: false,
          reason: "unknown_tool",
        });
      }

      let parsedArgs: SendHumanDmArgs | null = null;

      try {
        const candidate = JSON.parse(call.argumentsJson) as Record<string, unknown>;
        const toUsername =
          typeof candidate.toUsername === "string"
            ? candidate.toUsername.trim().replace(/^@/, "").toLowerCase()
            : "";
        const outboundMessage =
          typeof candidate.message === "string" ? candidate.message.trim() : "";

        if (toUsername && outboundMessage) {
          parsedArgs = {
            message: outboundMessage,
            toUsername,
          };
        }
      } catch {
        parsedArgs = null;
      }

      if (!parsedArgs) {
        return JSON.stringify({
          ok: false,
          reason: "invalid_arguments",
        });
      }

      const delivery = await executeSendHumanDm({
        ...parsedArgs,
        senderAgentOpenclawId: dmRoom.targetAgent.openclawAgentId,
      });

      if (delivery.ok) {
        successfulToolDeliveries += 1;
      }

      return JSON.stringify(delivery);
    };

    const availableHumanUsernames = activeHumans.map((human) => human.username);
    const isHumanDmRequest = looksLikeHumanDmRequest(message, availableHumanUsernames);
    const isScheduledDeliveryRequest = looksLikeScheduledDeliveryRequest(message);

    let result;

    try {
      result = await runAgentTurn({
        agentId: dmRoom.targetAgent.openclawAgentId,
        instructions,
        message,
        conversationKey: `room:${dmRoom.room.id}`,
        onToolCall: toolExecutor,
        tools: [
          {
            description:
              "Send a direct message to a human participant inside this study app.",
            name: "send_human_dm",
            parameters: {
              additionalProperties: false,
              properties: {
                message: {
                  description: "The exact message to send to the human participant.",
                  type: "string",
                },
                toUsername: {
                  description:
                    "The recipient username inside this app, without the @ prefix.",
                  type: "string",
                },
              },
              required: ["toUsername", "message"],
              type: "object",
            },
          },
        ],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "";

      if (!isHumanDmRequest || !errorMessage.includes("400")) {
        throw error;
      }

      const fallbackInstructions = [
        instructions,
        "",
        "Fallback mode for this turn:",
        "The tool call path is unavailable right now.",
        "If the user is asking you to send a human DM inside this app, respond with only one block in exactly this format and no extra prose:",
        "<send-human-dm>",
        "to: @username",
        "message: Exact message text",
        "</send-human-dm>",
        "Do not mention pairing, sessions_send, sessions, or gateway limitations.",
      ]
        .filter(Boolean)
        .join("\n");

      result = await runAgentTurn({
        agentId: dmRoom.targetAgent.openclawAgentId,
        instructions: fallbackInstructions,
        message,
        conversationKey: `room:${dmRoom.room.id}:fallback`,
      });
    }

    let { actions, visibleText } = parseAgentActions(result.assistantText);

    if (
      isHumanDmRequest &&
      successfulToolDeliveries === 0 &&
      actions.length === 0 &&
      containsGatewayToolFailureText(result.assistantText)
    ) {
      const retryInstructions = [
        instructions,
        "",
        "System enforcement mode:",
        "You must handle this request without mentioning gateway, pairing, sessions_send, or cron limitations.",
        "If this is a request to send a human DM in this app, do one of the following:",
        "1) Call send_human_dm",
        "2) Output exactly one <send-human-dm> block with to and message fields.",
        "Do not output refusal text about infrastructure.",
      ]
        .filter(Boolean)
        .join("\n");

      result = await runAgentTurn({
        agentId: dmRoom.targetAgent.openclawAgentId,
        instructions: retryInstructions,
        message,
        conversationKey: `room:${dmRoom.room.id}:enforced`,
        onToolCall: toolExecutor,
        tools: [
          {
            description:
              "Send a direct message to a human participant inside this study app.",
            name: "send_human_dm",
            parameters: {
              additionalProperties: false,
              properties: {
                message: {
                  description: "The exact message to send to the human participant.",
                  type: "string",
                },
                toUsername: {
                  description:
                    "The recipient username inside this app, without the @ prefix.",
                  type: "string",
                },
              },
              required: ["toUsername", "message"],
              type: "object",
            },
          },
        ],
      });

      ({ actions, visibleText } = parseAgentActions(result.assistantText));
    }

    let assistantText =
      visibleText ||
      (actions.length > 0
        ? "I handled that request."
        : isHumanDmRequest && containsGatewayToolFailureText(result.assistantText)
          ? "I could not complete delivery on this turn. I will retry with an in-app DM action format."
          : result.assistantText);

    if (isHumanDmRequest && containsGatewayToolFailureText(assistantText)) {
      assistantText = isScheduledDeliveryRequest
        ? "I can send messages to participants in this app, but delayed delivery is not enabled yet. I can send it now if you want."
        : "I can send messages to participants in this app. Please tell me who to send it to and what to say.";
    }

    if (actions.length > 0) {
      await executeAgentActions({
        actions,
        senderAgentOpenclawId: dmRoom.targetAgent.openclawAgentId,
      });
    }

    const replyMessage = await prisma.message.create({
      data: {
        roomId: dmRoom.room.id,
        role: "AGENT",
        agentId: dmRoom.targetAgent.openclawAgentId,
        content: assistantText,
      },
    });

    await prisma.room.update({
      where: {
        id: dmRoom.room.id,
      },
      data: {},
    });

    return NextResponse.json({
      reply: assistantText,
      replyMessage: {
        id: replyMessage.id,
        content: replyMessage.content,
        createdAt: replyMessage.createdAt.toISOString(),
      },
      roomId: dmRoom.room.id,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to contact OpenClaw.";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
