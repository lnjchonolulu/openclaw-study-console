export const DEFAULT_TIME_ZONE = "Asia/Seoul";

export const timeZoneOptions = [
  { label: "Seoul (KST)", value: "Asia/Seoul" },
  { label: "Tokyo (JST)", value: "Asia/Tokyo" },
  { label: "Singapore (SGT)", value: "Asia/Singapore" },
  { label: "Los Angeles (PT)", value: "America/Los_Angeles" },
  { label: "New York (ET)", value: "America/New_York" },
  { label: "London", value: "Europe/London" },
  { label: "Berlin", value: "Europe/Berlin" },
  { label: "UTC", value: "UTC" },
] as const;

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value: unknown) {
  if (typeof value !== "string") {
    return DEFAULT_TIME_ZONE;
  }

  const trimmed = value.trim();

  return trimmed && isValidTimeZone(trimmed) ? trimmed : DEFAULT_TIME_ZONE;
}

function getParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<"day" | "hour" | "minute" | "month" | "second" | "year", string>;
}

export function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = getParts(date, timeZone);

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function timeInputValueInTimeZone(date: Date, timeZone: string) {
  const parts = getParts(date, timeZone);

  return `${parts.hour}:${parts.minute}`;
}

export function monthKeyInTimeZone(date: Date, timeZone: string) {
  const parts = getParts(date, timeZone);

  return `${parts.year}-${parts.month}`;
}

export function addMonthsToMonthKey(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year || 1970, (monthNumber || 1) - 1 + amount, 1));

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function normalizeMonthKey(month: string | null | undefined, timeZone: string) {
  if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month.trim())) {
    return month.trim();
  }

  return monthKeyInTimeZone(new Date(), timeZone);
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - date.getTime();
}

export function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  if (
    !year ||
    !month ||
    month < 1 ||
    month > 12 ||
    !day ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const wallClockAsUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const firstOffset = timeZoneOffsetMs(wallClockAsUtc, timeZone);
  const adjusted = new Date(wallClockAsUtc.getTime() - firstOffset);
  const secondOffset = timeZoneOffsetMs(adjusted, timeZone);

  return new Date(wallClockAsUtc.getTime() - secondOffset);
}

export function monthBoundaryUtc(month: string, timeZone: string) {
  const normalizedMonth = normalizeMonthKey(month, timeZone);
  const [year, monthNumber] = normalizedMonth.split("-").map(Number);
  const start = zonedDateTimeToUtc(
    `${year}-${String(monthNumber).padStart(2, "0")}-01`,
    "00:00",
    timeZone,
  );
  const endMonth = addMonthsToMonthKey(normalizedMonth, 1);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  const end = zonedDateTimeToUtc(
    `${endYear}-${String(endMonthNumber).padStart(2, "0")}-01`,
    "00:00",
    timeZone,
  );

  return {
    end: end ?? new Date(Date.UTC(year, monthNumber, 1)),
    month: normalizedMonth,
    start: start ?? new Date(Date.UTC(year, monthNumber - 1, 1)),
  };
}

export function formatDateTimeInTimeZone(
  isoStringOrDate: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  const date =
    typeof isoStringOrDate === "string" ? new Date(isoStringOrDate) : isoStringOrDate;

  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: normalizeTimeZone(timeZone),
  }).format(date);
}
