import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseChatPayload } from "@/lib/chat-attachments";
import { getOrCreateAgentDmRoom } from "@/lib/dm";
import { buildSelectiveAgentNoteContext } from "@/lib/agent-context-notes";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import { getAgentRelationshipContext } from "@/lib/agent-relationships";
import { handleInboundTaskReply } from "@/lib/agent-task-workflow";
import {
  CYWORLD_AGENT_TOOLS,
  handleCyWorldAgentToolCall,
} from "@/lib/cyworld-agent-tools";
import {
  shouldTriggerCyWorldDriveSync,
  triggerCyWorldDriveSyncAll,
} from "@/lib/cyworld-drive-sync";
import { buildStudyFilesRuntimeContext } from "@/lib/files";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await parseChatPayload(request);
  const clientMessageId = body.clientMessageId || null;
  const targetAgentId = body.agentId || user.agent?.openclawAgentId;
  const message = body.message;
  const replyToMessageId = body.replyToMessageId || null;

  if (!message && body.attachments.length === 0) {
    return NextResponse.json({ error: "Message or image is required." }, { status: 400 });
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
      attachmentsJson: body.attachments,
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
        agent: {
          select: {
            displayName: true,
            openclawAgentId: true,
          },
        },
        username: true,
      },
    });
    const relationshipContext =
      audience === "shared_spaces"
        ? await getAgentRelationshipContext({
            agentDatabaseId: dmRoom.targetAgent.id,
            targetUserId: user.id,
          })
        : null;
    const instructions = buildAgentRuntimeInstructions({
      agentDisplayName: dmRoom.targetAgent.displayName,
      audience,
      availableAgents: activeHumans.flatMap((human) =>
        human.agent
          ? [
              {
                displayName: human.agent.displayName,
                openclawAgentId: human.agent.openclawAgentId,
                ownerUsername: human.username,
              },
            ]
          : [],
      ),
      availableHumanUsernames: activeHumans.map((human) => human.username),
      behaviorConfig: dmRoom.targetAgent.soulConfigJson,
      counterpartLabel:
        audience === "direct_line"
          ? `${user.displayName} (@${user.username})`
          : `${user.displayName} (@${user.username}), who is not the owner of this agent`,
      counterpartTimezone: user.timezone,
      currentHumanDisplayName: user.displayName,
      currentHumanUsername: user.username,
      ownerDisplayName: dmRoom.targetAgent.user.displayName,
      ownerTimezone: dmRoom.targetAgent.user.timezone,
      ownerUsername: dmRoom.targetAgent.user.username,
      personaSummary: dmRoom.targetAgent.personaSummary,
      relationshipContext,
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
          attachments: body.attachments,
          clientMessageId,
          createdAt: createdUserMessage.createdAt.toISOString(),
          id: createdUserMessage.id,
        },
        roomId: dmRoom.room.id,
      });
    }

    const filesContext = await buildStudyFilesRuntimeContext({
      agentDatabaseId: dmRoom.targetAgent.id,
      maxInaccessibleFolders: 8,
      maxVisibleEntries: 16,
      userId: user.id,
    });
    const selectiveNoteContext = await buildSelectiveAgentNoteContext({
      agentId: dmRoom.targetAgent.openclawAgentId,
      counterpart: {
        displayName: user.displayName,
        id: user.id,
        username: user.username,
      },
      ownerUsername: dmRoom.targetAgent.user.username,
    });
    const turnInstructions = [
      instructions,
      selectiveNoteContext,
      filesContext,
    ]
      .filter((part): part is string => Boolean(part?.trim()))
      .join("\n\n");

    const result = await runAgentTurn({
      agentId: dmRoom.targetAgent.openclawAgentId,
      imageAttachments: body.openClawImages,
      instructions: turnInstructions,
      message,
      conversationKey: `room:${dmRoom.room.id}`,
      tools: CYWORLD_AGENT_TOOLS,
      onToolCall: (call) =>
        handleCyWorldAgentToolCall({
          call,
          currentHumanUserId: user.id,
          objective: message,
          requesterUserId: user.id,
          senderAgentOpenclawId: dmRoom.targetAgent.openclawAgentId,
          sourceRoomId: dmRoom.room.id,
          triggerType: "human_dm",
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
      await triggerCyWorldDriveSyncAll();
    }

    return NextResponse.json({
      reply: assistantText,
      replyMessage: {
        id: replyMessage.id,
        content: replyMessage.content,
        createdAt: replyMessage.createdAt.toISOString(),
      },
      userMessage: {
        attachments: body.attachments,
        clientMessageId,
        createdAt: createdUserMessage.createdAt.toISOString(),
        id: createdUserMessage.id,
      },
      roomId: dmRoom.room.id,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to contact OpenClaw.";

    console.error("[chat] OpenClaw agent turn failed", {
      agentId: targetAgentId,
      error,
      messageId: createdUserMessage.id,
      roomId: dmRoom.room.id,
      userId: user.id,
    });

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
