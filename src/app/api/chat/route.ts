import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateAgentDmRoom } from "@/lib/dm";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import { handleInboundTaskReply } from "@/lib/agent-task-workflow";
import {
  CYWORLD_AGENT_TOOLS,
  handleCyWorldAgentToolCall,
} from "@/lib/cyworld-agent-tools";
import {
  shouldTriggerCyWorldDriveSync,
  triggerCyWorldDriveSync,
} from "@/lib/cyworld-drive-sync";
import { buildStudyFilesRuntimeContext } from "@/lib/files";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

function mentionsStudyFiles(message: string) {
  return (
    /\b(files?|folders?|workspace|shared folder|drive|directory|directories|interface|upload|download|pdf|docx?|sheets?)\b/i.test(
      message,
    ) || /(파일|폴더|공유\s*폴더|워크스페이스|인터페이스|업로드|다운로드|문서)/.test(message)
  );
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
      counterpartTimezone: user.timezone,
      ownerDisplayName: dmRoom.targetAgent.user.displayName,
      ownerTimezone: dmRoom.targetAgent.user.timezone,
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
    const shouldAttemptTaskReply =
      audience === "shared_spaces" && Boolean(repliedToTaskMessage);
    const taskReply = shouldAttemptTaskReply
      ? await handleInboundTaskReply({
          agentDisplayName: dmRoom.targetAgent.displayName,
          agentOpenclawId: dmRoom.targetAgent.openclawAgentId,
          behaviorConfig: dmRoom.targetAgent.soulConfigJson,
          ownerDisplayName: dmRoom.targetAgent.user.displayName,
          ownerTimezone: dmRoom.targetAgent.user.timezone,
          ownerUsername: dmRoom.targetAgent.user.username,
          personaSummary: dmRoom.targetAgent.personaSummary,
          replyingDisplayName: user.displayName,
          replyingTimezone: user.timezone,
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
      tools: CYWORLD_AGENT_TOOLS,
      onToolCall: (call) =>
        handleCyWorldAgentToolCall({
          call,
          objective: message,
          requesterUserId: user.id,
          senderAgentOpenclawId: dmRoom.targetAgent.openclawAgentId,
          sourceRoomId: dmRoom.room.id,
        }),
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

    if (shouldTriggerCyWorldDriveSync(message, assistantText)) {
      await triggerCyWorldDriveSync(dmRoom.targetAgent.openclawAgentId);
    }

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
