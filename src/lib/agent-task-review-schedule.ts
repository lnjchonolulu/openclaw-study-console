import { AgentTaskStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const DEFAULT_REVIEW_MINUTES = 180;
const MIN_REVIEW_MINUTES = 1;
const MAX_REVIEW_MINUTES = 30 * 24 * 60;

export function configuredDefaultReviewMinutes() {
  const value = Number.parseInt(
    process.env.CYWORLD_TASK_REVIEW_DEFAULT_MINUTES ?? "",
    10,
  );

  return Number.isFinite(value) && value > 0
    ? Math.min(Math.max(value, MIN_REVIEW_MINUTES), MAX_REVIEW_MINUTES)
    : DEFAULT_REVIEW_MINUTES;
}

export function normalizeReviewMinutes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return configuredDefaultReviewMinutes();
  }

  return Math.min(
    Math.max(Math.round(value), MIN_REVIEW_MINUTES),
    MAX_REVIEW_MINUTES,
  );
}

export function nextTaskReviewAt({
  afterMinutes,
  from = new Date(),
}: {
  afterMinutes?: unknown;
  from?: Date;
}) {
  return new Date(
    from.getTime() + normalizeReviewMinutes(afterMinutes) * 60 * 1000,
  );
}

export async function markTaskWaitingForReview({
  afterMinutes,
  from,
  resultSummary,
  taskId,
}: {
  afterMinutes?: unknown;
  from?: Date;
  resultSummary?: string | null;
  taskId: string;
}) {
  const nextReviewAt = nextTaskReviewAt({
    afterMinutes,
    from,
  });

  await prisma.agentTask.update({
    where: {
      id: taskId,
    },
    data: {
      nextReviewAt,
      resultSummary,
      reviewLeaseUntil: null,
      status: AgentTaskStatus.WAITING,
    },
  });

  return nextReviewAt;
}
