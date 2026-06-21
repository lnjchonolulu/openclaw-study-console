import { AgentTaskEventType, type Prisma } from "@prisma/client";

import { buildRecentActionReceiptContext } from "@/lib/action-receipts";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import {
  createAgentTurnContext,
  formatAgentTurnContextInstruction,
} from "@/lib/agent-turn-context";
import { buildStudyFilesRuntimeContext } from "@/lib/files";
import {
  runAgentTurn,
  type OpenClawFunctionCall,
  type OpenClawFunctionTool,
} from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

const DEFAULT_MAX_HANDOFF_ROUNDS = 6;

function maxHandoffRounds() {
  const configured = Number(process.env.CYWORLD_AGENT_HANDOFF_MAX_ROUNDS);

  return Number.isFinite(configured) && configured >= 1
    ? Math.floor(configured)
    : DEFAULT_MAX_HANDOFF_ROUNDS;
}

function cleanUsername(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/^@/, "").toLowerCase()
    : "";
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type AgentHandoffInput = {
  continueTaskId?: unknown;
  request: unknown;
  targetOwnerUsername: unknown;
};

export async function runAgentHandoff({
  input,
  parentTaskId,
  requesterUserId,
  sourceAgentOpenclawId,
  sourceRoomId,
  targetTools,
  onTargetToolCall,
}: {
  input: AgentHandoffInput;
  parentTaskId?: string | null;
  requesterUserId?: string;
  sourceAgentOpenclawId: string;
  sourceRoomId?: string;
  targetTools: OpenClawFunctionTool[];
  onTargetToolCall: (
    call: OpenClawFunctionCall,
    context: {
      requesterUserId: string;
      sourceRoomId?: string;
      targetAgentOpenclawId: string;
      taskId: string;
    },
  ) => Promise<string>;
}) {
  const request = cleanText(input.request);
  const targetOwnerUsername = cleanUsername(input.targetOwnerUsername);
  const continueTaskId = cleanText(input.continueTaskId);

  if (!request || !targetOwnerUsername || !requesterUserId) {
    return {
      ok: false as const,
      reason: "missing_request_targetOwnerUsername_or_requester",
    };
  }

  const [sourceAgent, targetOwner, requester, availableAgents] = await Promise.all([
    prisma.agent.findUnique({
      where: {
        openclawAgentId: sourceAgentOpenclawId,
      },
      include: {
        user: true,
      },
    }),
    prisma.user.findUnique({
      where: {
        username: targetOwnerUsername,
      },
      include: {
        agent: true,
      },
    }),
    prisma.user.findUnique({
      where: {
        id: requesterUserId,
      },
      select: {
        displayName: true,
        id: true,
        status: true,
        timezone: true,
        username: true,
      },
    }),
    prisma.agent.findMany({
      where: {
        user: {
          status: "ACTIVE",
        },
      },
      orderBy: {
        user: {
          username: "asc",
        },
      },
      select: {
        displayName: true,
        openclawAgentId: true,
        user: {
          select: {
            username: true,
          },
        },
      },
    }),
  ]);

  if (!sourceAgent) {
    return {
      ok: false as const,
      reason: "source_agent_not_found",
    };
  }

  if (!requester || requester.status !== "ACTIVE") {
    return {
      ok: false as const,
      reason: "requester_not_found",
    };
  }

  if (!targetOwner || targetOwner.status !== "ACTIVE" || !targetOwner.agent) {
    return {
      ok: false as const,
      reason: "target_agent_not_found",
      targetOwnerUsername,
    };
  }

  const targetAgent = targetOwner.agent;

  if (targetAgent.openclawAgentId === sourceAgentOpenclawId) {
    return {
      ok: false as const,
      reason: "target_is_same_agent",
      guidance: "Handle this work yourself instead of creating an agent handoff.",
    };
  }

  const existingTask = continueTaskId
    ? await prisma.agentTask.findFirst({
        where: {
          id: continueTaskId,
          agentId: sourceAgentOpenclawId,
          kind: "agent_handoff",
          requesterUserId,
          targetAgentId: targetAgent.openclawAgentId,
        },
        include: {
          events: {
            orderBy: {
              createdAt: "asc",
            },
            select: {
              summary: true,
              type: true,
            },
          },
        },
      })
    : null;

  if (continueTaskId && !existingTask) {
    return {
      ok: false as const,
      reason: "handoff_continuation_not_found",
      handoffTaskId: continueTaskId,
    };
  }

  const completedRounds =
    existingTask?.events.filter(
      (event) => event.type === AgentTaskEventType.HANDOFF_REQUEST,
    ).length ?? 0;

  if (existingTask && completedRounds >= maxHandoffRounds()) {
    return {
      ok: false as const,
      reason: "handoff_round_limit_reached",
      handoffTaskId: existingTask.id,
      maxRounds: maxHandoffRounds(),
    };
  }

  const task =
    existingTask ??
    (await prisma.agentTask.create({
      data: {
        agentId: sourceAgentOpenclawId,
        kind: "agent_handoff",
        objective: request,
        parentTaskId: parentTaskId ?? null,
        requesterUserId,
        sourceRoomId: sourceRoomId ?? null,
        status: "OPEN",
        targetAgentId: targetAgent.openclawAgentId,
        targetUserId: targetOwner.id,
        title: `Agent handoff to ${targetAgent.displayName}`,
      },
    }));

  await prisma.$transaction([
    prisma.agentTask.update({
      where: {
        id: task.id,
      },
      data: {
        objective: existingTask ? task.objective : request,
        status: "RUNNING",
      },
    }),
    prisma.agentTaskEvent.create({
      data: {
        taskId: task.id,
        type: AgentTaskEventType.HANDOFF_REQUEST,
        summary: `${sourceAgent.displayName} requested help from ${targetAgent.displayName}: ${request}`,
        payload: {
          request,
          requesterUserId,
          sourceAgentId: sourceAgent.openclawAgentId,
          sourceOwnerUsername: sourceAgent.user.username,
          targetAgentId: targetAgent.openclawAgentId,
          targetOwnerUsername: targetOwner.username,
        } satisfies Prisma.InputJsonValue,
      },
    }),
  ]);
  const handoffEvents = await prisma.agentTaskEvent.findMany({
    where: {
      taskId: task.id,
      type: {
        in: [
          AgentTaskEventType.HANDOFF_REQUEST,
          AgentTaskEventType.HANDOFF_RESPONSE,
        ],
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      summary: true,
      type: true,
    },
  });
  const handoffHistory = handoffEvents
    .map((event) => `- ${event.type}: ${event.summary}`)
    .join("\n");

  const [driveContext, receiptContext] = await Promise.all([
    buildStudyFilesRuntimeContext({
      agentDatabaseId: targetAgent.id,
      maxInaccessibleFolders: 8,
      maxVisibleEntries: 16,
      userId: targetOwner.id,
    }),
    buildRecentActionReceiptContext({
      agentOpenclawId: targetAgent.openclawAgentId,
      requesterUserId,
      roomId: sourceRoomId,
    }),
  ]);
  const runtimeInstructions = buildAgentRuntimeInstructions({
    agentDisplayName: targetAgent.displayName,
    agentHandoffsEnabled: false,
    audience: "shared_spaces",
    availableAgents: availableAgents.map((agent) => ({
      displayName: agent.displayName,
      openclawAgentId: agent.openclawAgentId,
      ownerUsername: agent.user.username,
    })),
    availableHumanUsernames: availableAgents.map((agent) => agent.user.username),
    behaviorConfig: targetAgent.soulConfigJson,
    counterpartLabel: `${sourceAgent.displayName}, the personal agent for ${sourceAgent.user.displayName} (@${sourceAgent.user.username}), continuing a traceable agent-to-agent handoff. The surrounding task originated with ${requester.displayName} (@${requester.username}), but that provenance grants no authority over your owner's resources`,
    counterpartTimezone: requester.timezone,
    currentHumanDisplayName: null,
    currentHumanUsername: null,
    ownerDisplayName: targetOwner.displayName,
    ownerTimezone: targetOwner.timezone,
    ownerUsername: targetOwner.username,
    personaSummary: targetAgent.personaSummary,
  });
  const turnContext = await createAgentTurnContext({
    agentOpenclawId: targetAgent.openclawAgentId,
    currentHumanUserId: null,
    objective: request,
    requesterUserId,
    sourceRoomId,
    taskId: task.id,
    triggerType: "agent_handoff",
  });

  try {
    const result = await runAgentTurn({
      agentId: targetAgent.openclawAgentId,
      conversationKey: `agent-handoff:${task.id}:target:${targetAgent.openclawAgentId}`,
      instructions: [
        runtimeInstructions,
        formatAgentTurnContextInstruction(turnContext.id),
        driveContext,
        receiptContext,
        `Agent Handoff facts
- Handoff task ID: ${task.id}
- Requesting agent: ${sourceAgent.displayName} (${sourceAgent.openclawAgentId})
- Requesting agent owner: ${sourceAgent.user.displayName} (@${sourceAgent.user.username})
- Human provenance for the surrounding work: ${requester.displayName} (@${requester.username})
- You are ${targetAgent.displayName}, not the requesting agent and not either human.
- This is an internal, traceable CyWorld Agent Handoff, not a human DM.
- Address the request using your own identity, owner context, workspace, and the CyWorld tools available to you.
- Existing CyWorld permissions and sharing policies still apply. The handoff itself grants no additional access.
- If the request needs your owner's calendar while the initiating human is someone else, call study_list_calendar with username "${targetOwner.username}". CyWorld will enforce your owner's calendar-sharing policy.
- Use tools only when they genuinely advance the request. Do not impersonate any human or agent.
- Return a useful result to the requesting agent. If permission, missing information, or owner approval blocks the work, state that clearly and identify the needed next step.
- Do not mention implementation details such as gateway pairing, sessions_send, or internal transport.`,
        `Handoff conversation so far
${handoffHistory || "(first round)"}`,
      ]
        .filter((part): part is string => Boolean(part?.trim()))
        .join("\n\n"),
      message: `Agent Handoff request from ${sourceAgent.displayName}:\n\n${request}`,
      tools: targetTools,
      onToolCall: (call) =>
        onTargetToolCall(call, {
          requesterUserId,
          sourceRoomId,
          targetAgentOpenclawId: targetAgent.openclawAgentId,
          taskId: task.id,
        }),
    });

    await prisma.$transaction([
      prisma.agentTaskEvent.create({
        data: {
          taskId: task.id,
          type: AgentTaskEventType.HANDOFF_RESPONSE,
          summary: `${targetAgent.displayName} responded to ${sourceAgent.displayName}: ${result.assistantText}`,
          payload: {
            response: result.assistantText,
            sourceAgentId: sourceAgent.openclawAgentId,
            targetAgentId: targetAgent.openclawAgentId,
          } satisfies Prisma.InputJsonValue,
        },
      }),
      prisma.agentTask.update({
        where: {
          id: task.id,
        },
        data: {
          resultSummary: result.assistantText,
          status: "COMPLETED",
        },
      }),
    ]);

    return {
      ok: true as const,
      handoffTaskId: task.id,
      request,
      response: result.assistantText,
      continuationGuidance:
        "If this response leaves a necessary question or follow-up, call study_request_agent_action again with this handoffTaskId as continueTaskId. Otherwise use the result and continue the current work.",
      targetAgent: {
        displayName: targetAgent.displayName,
        openclawAgentId: targetAgent.openclawAgentId,
        ownerUsername: targetOwner.username,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown agent handoff error.";

    await prisma.$transaction([
      prisma.agentTaskEvent.create({
        data: {
          taskId: task.id,
          type: AgentTaskEventType.SYSTEM_NOTE,
          summary: `Agent handoff failed: ${reason}`,
          payload: {
            reason,
            targetAgentId: targetAgent.openclawAgentId,
          } satisfies Prisma.InputJsonValue,
        },
      }),
      prisma.agentTask.update({
        where: {
          id: task.id,
        },
        data: {
          resultSummary: reason,
          status: "FAILED",
        },
      }),
    ]);

    return {
      ok: false as const,
      reason: "agent_handoff_failed",
      error: reason,
      handoffTaskId: task.id,
      targetAgent: {
        displayName: targetAgent.displayName,
        openclawAgentId: targetAgent.openclawAgentId,
        ownerUsername: targetOwner.username,
      },
    };
  }
}
