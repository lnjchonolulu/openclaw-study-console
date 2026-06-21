const DEFAULT_REVIEW_MINUTES = 180;
const MIN_REVIEW_MINUTES = 1;
const MAX_REVIEW_MINUTES = 30 * 24 * 60;

function normalizeWakeupDelayMinutes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_REVIEW_MINUTES;
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
    from.getTime() + normalizeWakeupDelayMinutes(afterMinutes) * 60 * 1000,
  );
}
