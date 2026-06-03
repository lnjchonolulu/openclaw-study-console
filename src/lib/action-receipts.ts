import { AgentTaskStatus, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

function formatTaskStatus(status: string) {
  return status.toLowerCase();
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
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

  clauses.push({
    status: {
      in: [AgentTaskStatus.OPEN, AgentTaskStatus.WAITING],
    },
  });

  const tasks = await prisma.agentTask.findMany({
    where: {
      agentId: agentOpenclawId,
      OR: clauses,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 6,
    include: {
      events: {
        orderBy: {
          createdAt: "desc",
        },
        take: 4,
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
      `- ${task.title} [${formatTaskStatus(task.status)}] requester=@${task.requester.username}${task.targetUser ? ` target=@${task.targetUser.username}` : ""}`,
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
