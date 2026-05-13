import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateAgentDmRoom } from "@/lib/dm";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import { createAndRunOutboundAgentTask } from "@/lib/agent-task-workflow";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

type StudyActionIntent = {
  delayMinutes?: number;
  kind: "send_dm" | "schedule_dm";
  message: string | null;
  toUsername: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractQuotedText(message: string) {
  const quoteMatch = message.match(/["'“”‘’]([^"'“”‘’]+)["'“”‘’]/);

  if (quoteMatch?.[1]?.trim()) {
    return quoteMatch[1].trim();
  }

  const colonMatch = message.match(/(?:message|saying|say|text|내용|메시지)\s*[:：]\s*(.+)$/i);

  return colonMatch?.[1]?.trim() || null;
}

function parseDelayMinutes(message: string) {
  const normalized = message.toLowerCase();
  const match = normalized.match(
    /\b(?:after|in)\s+(\d+|a|an|one)\s*(minute|minutes|min|hour|hours|hr|hrs)\b/,
  );

  if (!match) {
    return null;
  }

  const amount = ["a", "an", "one"].includes(match[1]) ? 1 : Number(match[1]);
  const unit = match[2];

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return unit.startsWith("hour") || unit.startsWith("hr") ? amount * 60 : amount;
}

function parseStudyActionIntent({
  activeUsernames,
  currentUsername,
  message,
}: {
  activeUsernames: string[];
  currentUsername: string;
  message: string;
}): StudyActionIntent | null {
  const normalized = message.toLowerCase();
  const hasSendIntent =
    /\b(send|message|dm|tell|notify|text|remind)\b/.test(normalized) ||
    /(보내|전해|알려|리마인드|예약)/.test(message);

  if (!hasSendIntent) {
    return null;
  }

  const delayMinutes = parseDelayMinutes(message);
  const toUsername =
    /\b(me|myself)\b/.test(normalized) || /(나한테|내게|나에게)/.test(message)
      ? currentUsername
      : activeUsernames.find((username) => {
          const lowered = username.toLowerCase();
          const escaped = escapeRegExp(lowered);
          return (
            normalized.includes(`@${lowered}`) ||
            new RegExp(`\\b${escaped}\\b`).test(normalized)
          );
        });

  if (!toUsername) {
    return null;
  }

  return {
    delayMinutes: delayMinutes ?? undefined,
    kind: delayMinutes ? "schedule_dm" : "send_dm",
    message: extractQuotedText(message),
    toUsername,
  };
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

    const actionIntent = parseStudyActionIntent({
      activeUsernames: activeHumans.map((human) => human.username),
      currentUsername: user.username,
      message,
    });

    if (actionIntent) {
      const taskResult = await createAndRunOutboundAgentTask({
        agentDisplayName: dmRoom.targetAgent.displayName,
        agentOpenclawId: dmRoom.targetAgent.openclawAgentId,
        behaviorConfig: dmRoom.targetAgent.soulConfigJson,
        delayMinutes: actionIntent.delayMinutes,
        explicitMessage: actionIntent.message,
        kind: actionIntent.kind,
        ownerDisplayName: dmRoom.targetAgent.user.displayName,
        ownerUsername: dmRoom.targetAgent.user.username,
        personaSummary: dmRoom.targetAgent.personaSummary,
        requesterDisplayName: user.displayName,
        requesterUserId: user.id,
        requesterUsername: user.username,
        sourceMessage: message,
        sourceRoomId: dmRoom.room.id,
        targetUsername: actionIntent.toUsername,
      });

      const assistantText = taskResult.needsClarification
        ? taskResult.question
        : taskResult.ok
          ? actionIntent.kind === "schedule_dm"
            ? `Scheduled a message to @${taskResult.toUsername}.`
            : `Sent a message to @${taskResult.toUsername}.`
          : `I could not deliver that message: ${taskResult.reason}.`;

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
    }

    const result = await runAgentTurn({
      agentId: dmRoom.targetAgent.openclawAgentId,
      instructions,
      message,
      conversationKey: `room:${dmRoom.room.id}`,
    });

    const assistantText = result.assistantText;

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
