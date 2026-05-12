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

    const result = await runAgentTurn({
      agentId: dmRoom.targetAgent.openclawAgentId,
      instructions,
      message,
      conversationKey: `room:${dmRoom.room.id}`,
      onToolCall: async (call) => {
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

        return JSON.stringify(delivery);
      },
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

    const { actions, visibleText } = parseAgentActions(result.assistantText);
    const assistantText =
      visibleText ||
      (actions.length > 0
        ? "I handled that request."
        : result.assistantText);

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
