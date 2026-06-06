import {
  AgentTaskEventType,
  AgentTaskStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

function formatTaskStatus(status: string) {
  return status.toLowerCase();
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

type ActionReceiptStatus = "success" | "failure";

export type RecordAgentActionReceiptInput = {
  action: string;
  agentOpenclawId: string;
  eventType?: AgentTaskEventType;
  objective?: string | null;
  payload?: Prisma.InputJsonValue;
  requesterUserId?: string | null;
  resultSummary?: string | null;
  sourceRoomId?: string | null;
  status: ActionReceiptStatus;
  summary: string;
  targetUserId?: string | null;
  taskId?: string | null;
  title?: string | null;
};

export type RecordedAgentActionReceipt = {
  eventId: string | null;
  taskId: string;
};

function statusToTaskStatus(status: ActionReceiptStatus) {
  return status === "success" ? AgentTaskStatus.COMPLETED : AgentTaskStatus.FAILED;
}

function defaultEventTypeForAction(action: string, status: ActionReceiptStatus) {
  if (status === "failure") {
    return AgentTaskEventType.SYSTEM_NOTE;
  }

  if (action === "study_send_dm" || action === "send_dm" || action === "report_dm") {
    return AgentTaskEventType.OUTBOUND_MESSAGE;
  }

  if (action === "study_schedule_dm" || action === "schedule_dm") {
    return AgentTaskEventType.SCHEDULED_MESSAGE;
  }

  if (action === "email_reply_received") {
    return AgentTaskEventType.INBOUND_REPLY;
  }

  return AgentTaskEventType.SYSTEM_NOTE;
}

function buildReceiptPayload({
  action,
  payload,
  status,
}: {
  action: string;
  payload?: Prisma.InputJsonValue;
  status: ActionReceiptStatus;
}) {
  return {
    ...(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { data: payload ?? null }),
    receipt: {
      action,
      status,
      recordedAt: new Date().toISOString(),
    },
  } satisfies Prisma.InputJsonValue;
}

export async function recordAgentActionReceipt({
  action,
  agentOpenclawId,
  eventType,
  objective,
  payload,
  requesterUserId,
  resultSummary,
  sourceRoomId,
  status,
  summary,
  targetUserId,
  taskId,
  title,
}: RecordAgentActionReceiptInput): Promise<RecordedAgentActionReceipt | null> {
  const normalizedSummary = compact(summary);
  const receiptPayload = buildReceiptPayload({ action, payload, status });
  const resolvedEventType = eventType ?? defaultEventTypeForAction(action, status);

  if (taskId) {
    const [event] = await prisma.$transaction([
      prisma.agentTaskEvent.create({
        data: {
          taskId,
          type: resolvedEventType,
          summary: normalizedSummary,
          payload: receiptPayload,
        },
      }),
      prisma.agentTask.update({
        where: {
          id: taskId,
        },
        data: {
          updatedAt: new Date(),
        },
      }),
    ]);

    return {
      eventId: event.id,
      taskId,
    };
  }

  if (!requesterUserId) {
    return null;
  }

  const task = await prisma.agentTask.create({
    data: {
      agentId: agentOpenclawId,
      kind: action,
      objective: objective?.trim() || normalizedSummary,
      requesterUserId,
      sourceRoomId: sourceRoomId ?? null,
      status: statusToTaskStatus(status),
      targetUserId: targetUserId ?? null,
      title: title?.trim() || normalizedSummary.slice(0, 120) || action,
      resultSummary: resultSummary?.trim() || normalizedSummary,
      events: {
        create: [
          {
            type: AgentTaskEventType.USER_REQUEST,
            summary: objective?.trim() || normalizedSummary,
          },
          {
            type: resolvedEventType,
            summary: normalizedSummary,
            payload: receiptPayload,
          },
        ],
      },
    },
  });

  return {
    eventId: null,
    taskId: task.id,
  };
}

export async function buildRecentActionReceiptContext({
  agentOpenclawId,
  roomId,
  requesterUserId,
}: {
  agentOpenclawId: string;
  roomId?: string | null;
  requesterUserId?: string | null;
}) {
  const clauses: Prisma.AgentTaskWhereInput[] = [];

  if (roomId) {
    clauses.push({ sourceRoomId: roomId });
  }

  if (requesterUserId) {
    clauses.push({ requesterUserId });
  }

  const tasks = await prisma.agentTask.findMany({
    where: {
      AND: [
        {
          OR: [
            {
              agentId: agentOpenclawId,
            },
            {
              targetAgentId: agentOpenclawId,
            },
          ],
        },
        ...(clauses.length > 0
          ? [
              {
                OR: clauses,
              },
            ]
          : []),
      ],
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 8,
    include: {
      events: {
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
      },
      requester: {
        select: {
          username: true,
        },
      },
      targetUser: {
        select: {
          username: true,
        },
      },
    },
  });

  if (tasks.length === 0) {
    return "";
  }

  const lines = [
    "Recent CyWorld action receipts for this agent",
    "Use these as durable facts about what you already did. Do not deny, redo, or contradict them unless the user asks you to change course.",
  ];

  tasks.forEach((task) => {
    lines.push(
      `- ${task.title} [${formatTaskStatus(task.status)}] taskId=${task.id} requester=@${task.requester.username}${task.agentId === agentOpenclawId ? " role=requesting-agent" : " role=receiving-agent"}${task.targetUser ? ` target=@${task.targetUser.username}` : ""}`,
    );

    task.events
      .slice()
      .reverse()
      .forEach((event) => {
        lines.push(`  - ${event.type}: ${compact(event.summary).slice(0, 220)}`);
      });

    if (task.resultSummary?.trim()) {
      lines.push(`  - Result: ${compact(task.resultSummary).slice(0, 220)}`);
    }
  });

  return lines.join("\n");
}
