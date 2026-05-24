import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateAgentDmRoom } from "@/lib/dm";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import {
  createAndRunOutboundAgentTask,
  handleInboundTaskReply,
} from "@/lib/agent-task-workflow";
import { buildStudyFilesRuntimeContext } from "@/lib/files";
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

function isSelfDirectedInformationRequest(message: string) {
  const normalized = message.toLowerCase();

  return (
    /\b(tell|show|list|explain|describe)\s+me\s+(what|which|how|why|where|whether|if|about)\b/.test(
      normalized,
    ) ||
    /\b(can|could|would|will)\s+you\s+(tell|show|list|explain|describe|check|see|access)\b/.test(
      normalized,
    ) ||
    /\bwhat\s+(files|folders|workspace|directory|directories)\b/.test(normalized) ||
    /(뭐.*보여|무엇.*보여|파일.*뭐|폴더.*뭐|워크스페이스.*뭐|공유\s*폴더)/.test(message)
  );
}

function mentionsStudyFiles(message: string) {
  return (
    /\b(files?|folders?|workspace|shared folder|drive|directory|directories|interface|upload|download|pdf|docx?|sheets?)\b/i.test(
      message,
    ) || /(파일|폴더|공유\s*폴더|워크스페이스|인터페이스|업로드|다운로드|문서)/.test(message)
  );
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
  const delayMinutes = parseDelayMinutes(message);

  if (!delayMinutes && isSelfDirectedInformationRequest(message)) {
    return null;
  }

  const hasSendIntent =
    /\b(send|message|dm|notify|text|remind|ask|ping|contact|reach)\b/.test(
      normalized,
    ) ||
    /\btell\s+(?!me\b)(?:@?\w+|her|him|them|someone|somebody)\b/.test(normalized) ||
    /\b(check with|find out|get (?:their|her|his) opinion)\b/.test(normalized) ||
    /(보내|전해|알려|리마인드|예약|물어|질문|확인|연락)/.test(message);

  if (!hasSendIntent) {
    return null;
  }

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

  if (toUsername === currentUsername && !delayMinutes) {
    return null;
  }

  return {
    delayMinutes: delayMinutes ?? undefined,
    kind: delayMinutes ? "schedule_dm" : "send_dm",
    message: extractQuotedText(message),
    toUsername,
  };
}

async function inferMostRecentTaskTargetUsername({
  agentId,
  requesterUserId,
  roomId,
}: {
  agentId: string;
  requesterUserId: string;
  roomId: string;
}) {
  const recent = await prisma.agentTask.findFirst({
    where: {
      agentId,
      requesterUserId,
      sourceRoomId: roomId,
      targetUserId: {
        not: null,
      },
      createdAt: {
        gte: new Date(Date.now() - 1000 * 60 * 60 * 6),
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    include: {
      targetUser: {
        select: {
          username: true,
        },
      },
    },
  });

  return recent?.targetUser?.username ?? null;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    agentId?: string;
    clientMessageId?: string;
    message?: string;
    replyToMessageId?: string;
  };
  const clientMessageId = body.clientMessageId?.trim() || null;
  const targetAgentId = body.agentId?.trim() || user.agent?.openclawAgentId;
  const message = body.message?.trim();
  const replyToMessageId = body.replyToMessageId?.trim() || null;

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

  if (replyToMessageId) {
    const replyTarget = await prisma.message.findFirst({
      where: {
        id: replyToMessageId,
        roomId: dmRoom.room.id,
      },
      select: {
        id: true,
      },
    });

    if (!replyTarget) {
      return NextResponse.json(
        { error: "Reply target was not found in this conversation." },
        { status: 400 },
      );
    }
  }

  const createdUserMessage = await prisma.message.create({
    data: {
      roomId: dmRoom.room.id,
      userId: user.id,
      role: "USER",
      content: message,
      replyToMessageId,
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

    const repliedToTaskMessage = replyToMessageId
      ? await prisma.message.findFirst({
          where: {
            id: replyToMessageId,
            roomId: dmRoom.room.id,
            taskId: {
              not: null,
            },
          },
          select: {
            id: true,
          },
        })
      : null;
    const shouldAttemptTaskReply = Boolean(repliedToTaskMessage) || audience === "shared_spaces";
    const taskReply = shouldAttemptTaskReply
      ? await handleInboundTaskReply({
          agentDisplayName: dmRoom.targetAgent.displayName,
          agentOpenclawId: dmRoom.targetAgent.openclawAgentId,
          behaviorConfig: dmRoom.targetAgent.soulConfigJson,
          ownerDisplayName: dmRoom.targetAgent.user.displayName,
          ownerUsername: dmRoom.targetAgent.user.username,
          personaSummary: dmRoom.targetAgent.personaSummary,
          replyingDisplayName: user.displayName,
          roomId: dmRoom.room.id,
          replyingUserId: user.id,
          userMessageId: createdUserMessage.id,
          replyingUsername: user.username,
          replyMessage: message,
        })
      : null;

    if (taskReply) {
      const replyMessage = await prisma.message.create({
        data: {
          roomId: dmRoom.room.id,
          role: "AGENT",
          agentId: dmRoom.targetAgent.openclawAgentId,
          content: taskReply.acknowledgement,
        },
      });

      await prisma.room.update({
        where: {
          id: dmRoom.room.id,
        },
        data: {},
      });

      return NextResponse.json({
        reply: taskReply.acknowledgement,
        replyMessage: {
          id: replyMessage.id,
          content: replyMessage.content,
          createdAt: replyMessage.createdAt.toISOString(),
        },
        userMessage: {
          clientMessageId,
          createdAt: createdUserMessage.createdAt.toISOString(),
          id: createdUserMessage.id,
        },
        roomId: dmRoom.room.id,
      });
    }

    const actionIntent = parseStudyActionIntent({
      activeUsernames: activeHumans.map((human) => human.username),
      currentUsername: user.username,
      message,
    });

    const normalized = message.toLowerCase();
    const isPronounFollowup =
      /\b(her|him|them)\b/.test(normalized) || /(그녀|그를|그에게|그사람|걔)/.test(message);

    if (actionIntent || isPronounFollowup) {
      const inferredTarget =
        actionIntent?.toUsername ??
        (await inferMostRecentTaskTargetUsername({
          agentId: dmRoom.targetAgent.openclawAgentId,
          requesterUserId: user.id,
          roomId: dmRoom.room.id,
        }));

      if (!inferredTarget) {
        // Fall back to normal agent response if we cannot infer who "her/him/them" refers to.
      } else {
      const taskResult = await createAndRunOutboundAgentTask({
        agentDisplayName: dmRoom.targetAgent.displayName,
        agentOpenclawId: dmRoom.targetAgent.openclawAgentId,
        behaviorConfig: dmRoom.targetAgent.soulConfigJson,
        delayMinutes: actionIntent?.delayMinutes,
        explicitMessage: actionIntent?.message ?? null,
        kind: actionIntent?.kind ?? "send_dm",
        ownerDisplayName: dmRoom.targetAgent.user.displayName,
        ownerUsername: dmRoom.targetAgent.user.username,
        personaSummary: dmRoom.targetAgent.personaSummary,
        requesterDisplayName: user.displayName,
        requesterUserId: user.id,
        requesterUsername: user.username,
        sourceMessage: message,
        sourceRoomId: dmRoom.room.id,
        targetUsername: inferredTarget,
      });

      const assistantText = taskResult.needsClarification
        ? taskResult.question
        : taskResult.ok
          ? (actionIntent?.kind ?? "send_dm") === "schedule_dm"
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
        userMessage: {
          clientMessageId,
          createdAt: createdUserMessage.createdAt.toISOString(),
          id: createdUserMessage.id,
        },
        roomId: dmRoom.room.id,
      });
      }
    }

    const filesContext = mentionsStudyFiles(message)
      ? await buildStudyFilesRuntimeContext({
          agentDatabaseId: dmRoom.targetAgent.id,
          userId: user.id,
        })
      : null;
    const turnInstructions = filesContext
      ? `${instructions}\n\n${filesContext}`
      : instructions;

    const result = await runAgentTurn({
      agentId: dmRoom.targetAgent.openclawAgentId,
      instructions: turnInstructions,
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
      userMessage: {
        clientMessageId,
        createdAt: createdUserMessage.createdAt.toISOString(),
        id: createdUserMessage.id,
      },
      roomId: dmRoom.room.id,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to contact OpenClaw.";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
