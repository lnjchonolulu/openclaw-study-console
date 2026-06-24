import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseChatPayload } from "@/lib/chat-attachments";
import { getOrCreateAgentDmRoom } from "@/lib/dm";
import { buildSelectiveAgentNoteContext } from "@/lib/agent-context-notes";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import {
  createAgentTurnContext,
  formatAgentTurnContextInstruction,
} from "@/lib/agent-turn-context";
import { getAgentRelationshipContext } from "@/lib/agent-relationships";
import { buildRecentRoomConversationContext } from "@/lib/conversation-memory";
import {
  CYWORLD_AGENT_TOOLS,
  handleCyWorldAgentToolCall,
} from "@/lib/cyworld-agent-tools";
import {
  shouldTriggerCyWorldDriveSync,
  triggerCyWorldDriveSyncAll,
} from "@/lib/cyworld-drive-sync";
import { buildStudyFilesRuntimeContext } from "@/lib/files";
import { handleInboundTaskReply } from "@/lib/agent-task-workflow";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

type TrackedToolCall = {
  name: string;
  ok: boolean;
  resultText: string;
};

type GoogleWorkspaceFileType = "docs" | "sheets" | "slides";

const GOOGLE_WORKSPACE_WRITE_TOOLS: Record<GoogleWorkspaceFileType, Set<string>> = {
  docs: new Set(["study_update_google_docs", "study_write_google_docs_text"]),
  sheets: new Set(["study_update_google_sheets"]),
  slides: new Set(["study_update_google_slides"]),
};

function parseToolResultOk(resultText: string) {
  try {
    const parsed = JSON.parse(resultText) as { ok?: unknown };

    return parsed.ok === true;
  } catch {
    return false;
  }
}

function parseToolArguments(argumentsJson: string) {
  try {
    return JSON.parse(argumentsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function envFlagEnabled(name: string, fallback = true) {
  const value = process.env[name]?.trim().toLowerCase();

  if (!value) {
    return fallback;
  }

  return !["0", "false", "off", "no"].includes(value);
}

function hasSuccessfulGoogleWorkspaceWrite(
  toolCalls: TrackedToolCall[],
  fileTypes: Set<GoogleWorkspaceFileType>,
) {
  return toolCalls.some(
    (call) =>
      Array.from(fileTypes).some((fileType) =>
        GOOGLE_WORKSPACE_WRITE_TOOLS[fileType].has(call.name),
      ) && call.ok,
  );
}

function inferGoogleWorkspaceWriteRequestTypes({
  filesContext,
  message,
}: {
  filesContext: string;
  message: string;
}) {
  const text = message.toLowerCase();
  const fileTypes = new Set<GoogleWorkspaceFileType>();
  const hasVisibleGoogleFile =
    filesContext.includes("Google Workspace file") && filesContext.includes("Google URL:");
  const mentionsGoogleDocs =
    /\bgoogle\s+(doc|docs|document)\b/.test(text) ||
    /\bdoc(ument)?\b/.test(text);
  const mentionsGoogleSheets =
    /\bgoogle\s+(sheet|sheets|spreadsheet)\b/.test(text) ||
    /\bspreadsheet\b/.test(text) ||
    /\bsheet\b/.test(text);
  const mentionsGoogleSlides =
    /\bgoogle\s+(slide|slides|presentation)\b/.test(text) ||
    /\bpresentation\b/.test(text) ||
    /\bslide deck\b/.test(text);
  const asksToCreateWithContent =
    /\b(create|make|build)\b/.test(text) &&
    /\b(about|content|draft|fill|include|write|with)\b/.test(text);
  const asksForWrite =
    /\b(add|append|draft|edit|fill|insert|put|replace|update|write)\b/.test(text) ||
    /\b(empty|blank|content|still empty|try again)\b/.test(text) ||
    asksToCreateWithContent;
  const followUpToRecentDoc =
    hasVisibleGoogleFile &&
    /\b(that|this|the)\s+(file|doc|document|sheet|spreadsheet|slide|presentation)\b/.test(text);
  const emptyFollowUp = hasVisibleGoogleFile && /\b(empty|blank|fill it|try again)\b/.test(text);

  if (!asksForWrite && !followUpToRecentDoc && !emptyFollowUp) {
    return fileTypes;
  }

  if (mentionsGoogleDocs) {
    fileTypes.add("docs");
  }

  if (mentionsGoogleSheets) {
    fileTypes.add("sheets");
  }

  if (mentionsGoogleSlides) {
    fileTypes.add("slides");
  }

  if (followUpToRecentDoc || emptyFollowUp) {
    if (filesContext.includes("application/vnd.google-apps.document")) {
      fileTypes.add("docs");
    }

    if (filesContext.includes("application/vnd.google-apps.spreadsheet")) {
      fileTypes.add("sheets");
    }

    if (filesContext.includes("application/vnd.google-apps.presentation")) {
      fileTypes.add("slides");
    }

    if (/docs\.google\.com\/document\/d\//.test(filesContext)) {
      fileTypes.add("docs");
    }

    if (/docs\.google\.com\/spreadsheets\/d\//.test(filesContext)) {
      fileTypes.add("sheets");
    }

    if (/docs\.google\.com\/presentation\/d\//.test(filesContext)) {
      fileTypes.add("slides");
    }
  }

  return fileTypes;
}

function assistantClaimsGoogleWorkspaceWriteSuccess(text: string) {
  const lower = text.toLowerCase();
  const claimsSuccess =
    /\b(done|filled|updated|written|successfully|complete|created)\b/.test(lower);
  const mentionsGoogleWorkspaceFile =
    /\bgoogle\s+(doc|docs|document|sheet|sheets|spreadsheet|slide|slides|presentation)\b/.test(
      lower,
    ) ||
    /\b(document|spreadsheet|presentation|slide deck)\b/.test(lower);

  return claimsSuccess && mentionsGoogleWorkspaceFile;
}

function cyWorldAgentRuntimeMode() {
  return process.env.CYWORLD_AGENT_RUNTIME_MODE?.trim() === "none" ? "none" : "full";
}

function isReadOnlyCyWorldTool(toolName: string) {
  return (
    toolName === "study_list_pending_tasks" ||
    toolName === "study_recall_conversation" ||
    toolName === "study_list_calendar" ||
    toolName === "study_list_email_threads" ||
    toolName.startsWith("study_inspect_")
  );
}

function createsExternalReplyWait(toolName: string, argumentsJson: string, resultText: string) {
  if (toolName !== "study_send_dm" && toolName !== "study_schedule_dm") {
    return false;
  }

  const args = parseToolArguments(argumentsJson);

  return args.expectReply === true && parseToolResultOk(resultText);
}

function buildGoogleWorkspaceWriteVerificationPrompt({
  assistantText,
  fileTypes,
  message,
}: {
  assistantText: string;
  fileTypes: Set<GoogleWorkspaceFileType>;
  message: string;
}) {
  const expectedTools = Array.from(fileTypes)
    .flatMap((fileType) => Array.from(GOOGLE_WORKSPACE_WRITE_TOOLS[fileType]))
    .join(", ");

  return [
    "CyWorld verification detected a missing Google Workspace write receipt.",
    "",
    "The user's latest request appears to require adding, filling, writing, or updating a Google Docs, Sheets, or Slides file.",
    `Your previous response did not produce a successful receipt from the expected tool(s): ${expectedTools}.`,
    "",
    "Continue the same user request now:",
    "- If the target Google file is identifiable from the conversation or visible CyWorld Drive context, call the matching Google Workspace update/write tool.",
    "- If the target document is not identifiable, ask one short clarification for the document link or target.",
    "- Do not claim the Google file was filled, written, or updated unless the matching Google Workspace write/update tool returns ok:true.",
    "",
    `Original user request: ${message}`,
    "",
    `Previous assistant response that lacked a write receipt: ${assistantText}`,
  ].join("\n");
}

function formatReplyTargetContext(
  replyTarget: {
    agent?: {
      displayName: string;
    } | null;
    content: string;
    createdAt: Date;
    role: string;
    user?: {
      displayName: string;
      username: string;
    } | null;
  } | null,
) {
  if (!replyTarget) {
    return "";
  }

  const author =
    replyTarget.role === "AGENT"
      ? replyTarget.agent?.displayName ?? "Agent"
      : replyTarget.user
        ? `${replyTarget.user.displayName} (@${replyTarget.user.username})`
        : "System";

  return `## Current Reply Target

The current human message is a direct UI reply to this earlier CyWorld message.

- ${replyTarget.createdAt.toISOString()} ${author}: ${replyTarget.content}`;
}

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
      dmRoom.targetAgent.userId === user.id ? "direct_line" : "non_owner_dm";

    if (audience === "non_owner_dm" && message.trim()) {
      const taskReply = await handleInboundTaskReply({
        agentDisplayName: dmRoom.targetAgent.displayName,
        agentOpenclawId: dmRoom.targetAgent.openclawAgentId,
        behaviorConfig: dmRoom.targetAgent.soulConfigJson,
        ownerDisplayName: dmRoom.targetAgent.user.displayName,
        ownerTimezone: dmRoom.targetAgent.user.timezone,
        ownerUsername: dmRoom.targetAgent.user.username,
        personaSummary: dmRoom.targetAgent.personaSummary,
        replyingDisplayName: user.displayName,
        replyingTimezone: user.timezone,
        replyingUserId: user.id,
        replyingUsername: user.username,
        replyMessage: message,
        roomId: dmRoom.room.id,
        userMessageId: createdUserMessage.id,
      });

      if (taskReply) {
        const replyMessage = await prisma.message.create({
          data: {
            roomId: dmRoom.room.id,
            role: "AGENT",
            agentId: dmRoom.targetAgent.openclawAgentId,
            content: taskReply.acknowledgement,
            replyToMessageId: createdUserMessage.id,
            taskId: taskReply.taskId,
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
    }

    const runtimeMode = cyWorldAgentRuntimeMode();
    let filesContext = "";
    let turnInstructions = "";

    if (runtimeMode === "full") {
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
        audience === "non_owner_dm"
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

      if (envFlagEnabled("CYWORLD_AGENT_INCLUDE_FILES_CONTEXT")) {
        filesContext = await buildStudyFilesRuntimeContext({
          agentDatabaseId: dmRoom.targetAgent.id,
          maxInaccessibleFolders: 8,
          maxVisibleEntries: 16,
          userId: user.id,
        });
      }
      const recentConversationContext = envFlagEnabled(
        "CYWORLD_AGENT_INCLUDE_RECENT_CONTEXT",
      )
        ? await buildRecentRoomConversationContext({
            roomId: dmRoom.room.id,
          })
        : "";
      const replyTargetContext = replyToMessageId
        ? formatReplyTargetContext(
            await prisma.message.findFirst({
              where: {
                id: replyToMessageId,
                roomId: dmRoom.room.id,
              },
              include: {
                agent: {
                  select: {
                    displayName: true,
                  },
                },
                user: {
                  select: {
                    displayName: true,
                    username: true,
                  },
                },
              },
            }),
          )
        : "";
      const selectiveNoteContext = envFlagEnabled("CYWORLD_AGENT_INCLUDE_SELECTIVE_NOTES")
        ? await buildSelectiveAgentNoteContext({
            agentId: dmRoom.targetAgent.openclawAgentId,
            counterpart: {
              displayName: user.displayName,
              id: user.id,
              username: user.username,
            },
            ownerUsername: dmRoom.targetAgent.user.username,
          })
        : "";
      const turnContext = await createAgentTurnContext({
        agentOpenclawId: dmRoom.targetAgent.openclawAgentId,
        currentHumanUserId: user.id,
        objective: message,
        requesterUserId: user.id,
        sourceRoomId: dmRoom.room.id,
        triggerType: "human_dm",
      });
      turnInstructions = [
        instructions,
        formatAgentTurnContextInstruction(turnContext.id),
        recentConversationContext,
        replyTargetContext,
        selectiveNoteContext,
        filesContext,
      ]
        .filter((part): part is string => Boolean(part?.trim()))
        .join("\n\n");
    }

    const googleWorkspaceWriteTypes = inferGoogleWorkspaceWriteRequestTypes({
      message,
      filesContext,
    });
    let waitingForExternalReply = false;
    const toolCalls: TrackedToolCall[] = [];
    const runTurnWithTrackedTools = (turnMessage: string, objective = message) =>
      runAgentTurn({
        agentId: dmRoom.targetAgent.openclawAgentId,
        imageAttachments: body.openClawImages,
        instructions: turnInstructions,
        message: turnMessage,
        conversationKey: `room:${dmRoom.room.id}`,
        tools: CYWORLD_AGENT_TOOLS,
        onToolCall: async (call) => {
          if (waitingForExternalReply && !isReadOnlyCyWorldTool(call.name)) {
            const resultText = JSON.stringify({
              ok: false,
              reason: "pending_external_reply",
              guidance:
                "A CyWorld message in this turn is already waiting for the recipient's reply. Do not perform additional side effects that depend on that reply. Tell the requester that you sent the request and will continue when the recipient replies.",
            });

            toolCalls.push({
              name: call.name,
              ok: false,
              resultText,
            });

            return resultText;
          }

          const resultText = await handleCyWorldAgentToolCall({
            call,
            currentHumanUserId: user.id,
            objective,
            requesterUserId: user.id,
            senderAgentOpenclawId: dmRoom.targetAgent.openclawAgentId,
            sourceRoomId: dmRoom.room.id,
            triggerType: "human_dm",
          });

          if (createsExternalReplyWait(call.name, call.argumentsJson, resultText)) {
            waitingForExternalReply = true;
          }

          toolCalls.push({
            name: call.name,
            ok: parseToolResultOk(resultText),
            resultText,
          });

          return resultText;
        },
      });

    let assistantText: string;
    const result = await runTurnWithTrackedTools(message);
    assistantText = result.assistantText;

    if (
      googleWorkspaceWriteTypes.size > 0 &&
      !hasSuccessfulGoogleWorkspaceWrite(toolCalls, googleWorkspaceWriteTypes)
    ) {
      const verificationResult = await runTurnWithTrackedTools(
        buildGoogleWorkspaceWriteVerificationPrompt({
          assistantText,
          fileTypes: googleWorkspaceWriteTypes,
          message,
        }),
      );
      assistantText = verificationResult.assistantText;
    }

    if (
      googleWorkspaceWriteTypes.size > 0 &&
      !hasSuccessfulGoogleWorkspaceWrite(toolCalls, googleWorkspaceWriteTypes) &&
      assistantClaimsGoogleWorkspaceWriteSuccess(assistantText)
    ) {
      throw new Error(
        "Google Workspace write was not verified. Please ask again with the file link or target file name.",
      );
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
