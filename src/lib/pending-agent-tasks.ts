import { AgentTaskEventType, AgentTaskStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const DEFAULT_TASK_LIMIT = 20;
const MAX_TASK_LIMIT = 50;
const STALE_RUNNING_MS = 15 * 60 * 1000;

type PendingTaskAttention =
  | "recover_stalled_execution"
  | "review_new_input"
  | "explicit_wakeup_due"
  | "start_or_review"
  | "waiting_for_external_input";

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function latestTimestamp(values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value || (latest && latest >= value)) {
      return latest;
    }

    return value;
  }, null);
}

function resolveAttention({
  latestEventType,
  latestInboundAt,
  latestOutboundAt,
  nextReviewAt,
  status,
  updatedAt,
}: {
  latestEventType?: AgentTaskEventType;
  latestInboundAt: Date | null;
  latestOutboundAt: Date | null;
  nextReviewAt: Date | null;
  status: AgentTaskStatus;
  updatedAt: Date;
}): PendingTaskAttention {
  if (
    latestEventType === AgentTaskEventType.INBOUND_REPLY ||
    (latestInboundAt && (!latestOutboundAt || latestInboundAt > latestOutboundAt))
  ) {
    return "review_new_input";
  }

  if (
    status === AgentTaskStatus.RUNNING &&
    Date.now() - updatedAt.getTime() >= STALE_RUNNING_MS
  ) {
    return "recover_stalled_execution";
  }

  if (status === AgentTaskStatus.OPEN) {
    return "start_or_review";
  }

  if (nextReviewAt && nextReviewAt.getTime() <= Date.now()) {
    return "explicit_wakeup_due";
  }

  return "waiting_for_external_input";
}

export async function listPendingAgentTasks({
  agentOpenclawId,
  limit = DEFAULT_TASK_LIMIT,
}: {
  agentOpenclawId: string;
  limit?: number;
}) {
  const normalizedLimit = Math.min(Math.max(Math.round(limit), 1), MAX_TASK_LIMIT);
  const agent = await prisma.agent.findUnique({
    where: {
      openclawAgentId: agentOpenclawId,
    },
    select: {
      displayName: true,
      openclawAgentId: true,
      user: {
        select: {
          displayName: true,
          username: true,
        },
      },
    },
  });

  if (!agent) {
    return {
      ok: false as const,
      reason: "acting_agent_not_found",
    };
  }

  const tasks = await prisma.agentTask.findMany({
    where: {
      OR: [
        {
          agentId: agentOpenclawId,
        },
        {
          targetAgentId: agentOpenclawId,
        },
      ],
      status: {
        in: [
          AgentTaskStatus.OPEN,
          AgentTaskStatus.RUNNING,
          AgentTaskStatus.WAITING,
        ],
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: normalizedLimit,
    include: {
      emailThreads: {
        include: {
          messages: {
            orderBy: {
              createdAt: "desc",
            },
            take: 8,
          },
        },
      },
      events: {
        orderBy: {
          createdAt: "desc",
        },
        take: 8,
      },
      requester: {
        select: {
          displayName: true,
          username: true,
        },
      },
      sourceRoom: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
      targetAgent: {
        select: {
          displayName: true,
          openclawAgentId: true,
          user: {
            select: {
              username: true,
            },
          },
        },
      },
      targetUser: {
        select: {
          displayName: true,
          username: true,
        },
      },
    },
  });

  const pendingTasks = tasks.map((task) => {
    const emailMessages = task.emailThreads.flatMap((thread) => thread.messages);
    const latestInboundAt = latestTimestamp([
      ...task.events
        .filter((event) => event.type === AgentTaskEventType.INBOUND_REPLY)
        .map((event) => event.createdAt),
      ...emailMessages
        .filter((message) => message.direction === "INBOUND")
        .map((message) => message.receivedAt ?? message.createdAt),
    ]);
    const latestOutboundAt = latestTimestamp([
      ...task.events
        .filter(
          (event) =>
            event.type === AgentTaskEventType.OUTBOUND_MESSAGE ||
            event.type === AgentTaskEventType.SCHEDULED_MESSAGE ||
            event.type === AgentTaskEventType.HANDOFF_REQUEST,
        )
        .map((event) => event.createdAt),
      ...emailMessages
        .filter((message) => message.direction === "OUTBOUND")
        .map((message) => message.createdAt),
    ]);
    const attention = resolveAttention({
      latestEventType: task.events[0]?.type,
      latestInboundAt,
      latestOutboundAt,
      nextReviewAt: task.nextReviewAt,
      status: task.status,
      updatedAt: task.updatedAt,
    });

    return {
      attention,
      events: task.events
        .slice()
        .reverse()
        .map((event) => ({
          at: event.createdAt.toISOString(),
          summary: compact(event.summary).slice(0, 500),
          type: event.type,
        })),
      id: task.id,
      kind: task.kind,
      objective: compact(task.objective),
      nextReviewAt: task.nextReviewAt?.toISOString() ?? null,
      reviewCount: task.reviewCount,
      requester: {
        displayName: task.requester.displayName,
        username: task.requester.username,
      },
      resultSummary: task.resultSummary ? compact(task.resultSummary) : null,
      role: task.agentId === agentOpenclawId ? "requesting_agent" : "receiving_agent",
      sourceRoom: task.sourceRoom,
      status: task.status,
      targetAgent: task.targetAgent
        ? {
            displayName: task.targetAgent.displayName,
            openclawAgentId: task.targetAgent.openclawAgentId,
            ownerUsername: task.targetAgent.user.username,
          }
        : null,
      targetUser: task.targetUser,
      threads: task.emailThreads.map((thread) => ({
        lastMessage: thread.messages[0]
          ? {
              at: (
                thread.messages[0].receivedAt ?? thread.messages[0].createdAt
              ).toISOString(),
              direction: thread.messages[0].direction,
              from: thread.messages[0].from,
              snippet: compact(
                thread.messages[0].body ||
                  thread.messages[0].snippet ||
                  "(empty message)",
              ).slice(0, 500),
            }
          : null,
        status: thread.status,
        subject: thread.subject,
        threadId: thread.id,
      })),
      updatedAt: task.updatedAt.toISOString(),
    };
  });

  return {
    agent: {
      displayName: agent.displayName,
      openclawAgentId: agent.openclawAgentId,
      owner: {
        displayName: agent.user.displayName,
        username: agent.user.username,
      },
    },
    guidance: {
      recover_stalled_execution:
        "Inspect the task history and continue only the unfinished step. Do not repeat a side effect that already has a successful receipt.",
      review_new_input:
        "Review the new reply or event and decide the next useful action or report.",
      explicit_wakeup_due:
        "An agent-scheduled wakeup is due. Use it as a judgment opportunity, not as an automatic reminder.",
      start_or_review:
        "Review whether this task still needs action. Act only when the objective and authority are clear.",
      waiting_for_external_input:
        "No new input is available. Do not repeat the request or send a filler update solely because this task is pending.",
    },
    ok: true as const,
    pendingTasks,
    summary: {
      needsAttention: pendingTasks.filter(
        (task) => task.attention !== "waiting_for_external_input",
      ).length,
      total: pendingTasks.length,
      waiting: pendingTasks.filter(
        (task) => task.attention === "waiting_for_external_input",
      ).length,
    },
  };
}
