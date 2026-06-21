import {
  AgentTaskEventType,
  AgentTaskStatus,
  type Prisma,
} from "@prisma/client";

import { buildRecentActionReceiptContext } from "@/lib/action-receipts";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import {
  CYWORLD_AGENT_TOOLS,
  handleCyWorldAgentToolCall,
} from "@/lib/cyworld-agent-tools";
import {
  createAgentTurnContext,
  formatAgentTurnContextInstruction,
} from "@/lib/agent-turn-context";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_MINUTES = 15;
const MAX_BATCH_SIZE = 50;

function readPositiveInteger(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function leaseUntil(now: Date) {
  return new Date(
    now.getTime() +
      readPositiveInteger(
        "CYWORLD_TASK_REVIEW_LEASE_MINUTES",
        DEFAULT_LEASE_MINUTES,
      ) *
        60 *
        1000,
  );
}

function dueTaskWhere(now: Date): Prisma.AgentTaskWhereInput {
  return {
    kind: "explicit_wakeup",
    nextReviewAt: {
      lte: now,
    },
    status: AgentTaskStatus.WAITING,
    OR: [
      {
        reviewLeaseUntil: null,
      },
      {
        reviewLeaseUntil: {
          lte: now,
        },
      },
    ],
  };
}

async function claimTask(taskId: string, now: Date) {
  const claimed = await prisma.agentTask.updateMany({
    where: {
      id: taskId,
      ...dueTaskWhere(now),
    },
    data: {
      lastReviewedAt: now,
      reviewCount: {
        increment: 1,
      },
      reviewLeaseUntil: leaseUntil(now),
      status: AgentTaskStatus.RUNNING,
    },
  });

  return claimed.count === 1;
}

function formatTaskEvents(
  events: {
    createdAt: Date;
    summary: string;
    type: AgentTaskEventType;
  }[],
) {
  return events.length
    ? events
        .map(
          (event) =>
            `- ${event.createdAt.toISOString()} ${event.type}: ${event.summary}`,
        )
        .join("\n")
    : "(no task events recorded)";
}

async function reviewTask(taskId: string) {
  const task = await prisma.agentTask.findUnique({
    where: {
      id: taskId,
    },
    include: {
      agent: {
        include: {
          user: true,
        },
      },
      events: {
        orderBy: {
          createdAt: "asc",
        },
      },
      requester: true,
      sourceRoom: true,
      targetAgent: {
        include: {
          user: true,
        },
      },
      targetUser: true,
    },
  });

  if (!task || task.status !== AgentTaskStatus.RUNNING) {
    return {
      ok: false as const,
      reason: "task_not_available_after_claim",
      taskId,
    };
  }

  const activeUsers = await prisma.user.findMany({
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
  const runtimeInstructions = buildAgentRuntimeInstructions({
    agentDisplayName: task.agent.displayName,
    audience: "shared_spaces",
    availableAgents: activeUsers.flatMap((user) =>
      user.agent
        ? [
            {
              displayName: user.agent.displayName,
              openclawAgentId: user.agent.openclawAgentId,
              ownerUsername: user.username,
            },
          ]
        : [],
    ),
    availableHumanUsernames: activeUsers.map((user) => user.username),
    behaviorConfig: task.agent.soulConfigJson,
    counterpartLabel: `agent-scheduled CyWorld wakeup "${task.title}"`,
    currentHumanDisplayName: null,
    currentHumanUsername: null,
    ownerDisplayName: task.agent.user.displayName,
    ownerTimezone: task.agent.user.timezone,
    ownerUsername: task.agent.user.username,
    personaSummary: task.agent.personaSummary,
  });
  const receiptContext = await buildRecentActionReceiptContext({
    agentOpenclawId: task.agent.openclawAgentId,
    requesterUserId: task.requesterUserId,
    roomId: task.sourceRoomId,
  });
  const turnContext = await createAgentTurnContext({
    agentOpenclawId: task.agent.openclawAgentId,
    currentHumanUserId: null,
    objective: task.objective,
    requesterUserId: task.requesterUserId,
    sourceRoomId: task.sourceRoomId,
    taskId: task.id,
    triggerType: "agent_scheduled_wakeup",
  });
  const taskContext = [
    `Task ID: ${task.id}`,
    `Task title: ${task.title}`,
    `Task kind: ${task.kind}`,
    `Objective: ${task.objective}`,
    `Requester: ${task.requester.displayName} (@${task.requester.username})`,
    `Original room: ${
      task.sourceRoom
        ? `${task.sourceRoom.name} (${task.sourceRoom.type})`
        : "not available"
    }`,
    task.targetUser
      ? `Target human: ${task.targetUser.displayName} (@${task.targetUser.username})`
      : null,
    task.targetAgent
      ? `Target agent: ${task.targetAgent.displayName}, personal agent for @${task.targetAgent.user.username}`
      : null,
    `Previous result/status summary: ${task.resultSummary?.trim() || "(none)"}`,
    "Task event history:",
    formatTaskEvents(task.events),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  try {
    const result = await runAgentTurn({
      agentId: task.agent.openclawAgentId,
      conversationKey: `wakeup:${task.id}:${task.agent.openclawAgentId}`,
      instructions: `${[
        runtimeInstructions,
        formatAgentTurnContextInstruction(turnContext.id),
        receiptContext,
      ]
        .filter((part): part is string => Boolean(part?.trim()))
        .join("\n\n")}

You are awake because you previously scheduled this CyWorld wakeup for yourself.
- This wakeup is a judgment opportunity, not an automatic reminder.
- Inspect the purpose, recent task/event log, action receipts, and your own workspace notes before deciding what to do.
- Continue useful work autonomously only when a next step is actually warranted.
- Do not repeat a side effect that a successful receipt says already happened.
- Use CyWorld tools for real actions. Do not claim that an action happened without a successful tool result.
- If another future check is needed, call study_schedule_wakeup explicitly with the reason and time.
- Any message to a person or room must be delivered through a CyWorld tool. Your final assistant text is an internal review note and is not shown to a user.`,
      message: taskContext,
      tools: CYWORLD_AGENT_TOOLS,
      onToolCall: (call) =>
        handleCyWorldAgentToolCall({
          call,
          currentHumanUserId: null,
          objective: task.objective,
          requesterUserId: task.requesterUserId,
          senderAgentOpenclawId: task.agent.openclawAgentId,
          sourceRoomId: task.sourceRoomId ?? undefined,
          taskId: task.id,
          triggerType: "agent_scheduled_wakeup",
        }),
      onToolRoundCheckpoint: async ({
        pendingCalls,
        responseId,
        toolRounds,
      }) => {
        await prisma.agentTaskEvent.create({
          data: {
            taskId: task.id,
            type: AgentTaskEventType.SYSTEM_NOTE,
            summary: `Continued autonomous execution after ${toolRounds} tool rounds.`,
            payload: {
              pendingToolNames: pendingCalls.map((call) => call.name),
              responseId: responseId ?? null,
              toolRounds,
            },
          },
        });
      },
    });
    await prisma.$transaction([
      prisma.agentTask.update({
        where: {
          id: task.id,
        },
        data: {
          lastReviewedAt: new Date(),
          nextReviewAt: null,
          resultSummary: result.assistantText,
          reviewLeaseUntil: null,
          status: AgentTaskStatus.COMPLETED,
        },
      }),
      prisma.agentTaskEvent.create({
        data: {
          taskId: task.id,
          type: AgentTaskEventType.SYSTEM_NOTE,
          summary: "Completed agent-scheduled wakeup.",
          payload: {
            assistantText: result.assistantText,
            toolRounds: result.toolRounds,
          },
        },
      }),
    ]);

    return {
      ok: true as const,
      taskId: task.id,
      toolRounds: result.toolRounds,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown scheduled wakeup error.";

    await prisma.agentTaskEvent.create({
      data: {
        taskId: task.id,
        type: AgentTaskEventType.SYSTEM_NOTE,
        summary: `Agent-scheduled wakeup failed: ${reason}`,
        payload: {
          error: reason,
        },
      },
    });
    await prisma.agentTask.update({
      where: {
        id: task.id,
      },
      data: {
        nextReviewAt: null,
        resultSummary: `Agent-scheduled wakeup failed: ${reason}`,
        reviewLeaseUntil: null,
        status: AgentTaskStatus.FAILED,
      },
    });

    return {
      error: reason,
      ok: false as const,
      taskId: task.id,
    };
  }
}

export async function reviewDueAgentTasks({
  limit = DEFAULT_BATCH_SIZE,
  now = new Date(),
}: {
  limit?: number;
  now?: Date;
} = {}) {
  const normalizedLimit = Math.min(
    Math.max(Math.round(limit), 1),
    MAX_BATCH_SIZE,
  );
  const candidates = await prisma.agentTask.findMany({
    where: dueTaskWhere(now),
    orderBy: [
      {
        nextReviewAt: "asc",
      },
      {
        updatedAt: "asc",
      },
    ],
    take: normalizedLimit,
    select: {
      id: true,
    },
  });
  const results = [];

  for (const candidate of candidates) {
    if (!(await claimTask(candidate.id, now))) {
      continue;
    }

    results.push(await reviewTask(candidate.id));
  }

  return {
    candidates: candidates.length,
    processed: results.length,
    results,
  };
}
