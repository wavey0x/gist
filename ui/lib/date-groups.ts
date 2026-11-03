// Calendar grouping for list views ("Today", "Yesterday", "Previous 7 days",
// then months). Server and client compute it with the same time zone and the
// same clock so the first render hydrates without a jump.

export const TIME_ZONE_COOKIE = "wg_tz";

export type DateGroupKind = "today" | "yesterday" | "week" | "month";

export type DateGroup = { key: string; label: string; kind: DateGroupKind };

const DAY_MS = 24 * 60 * 60 * 1000;

export function validTimeZone(value: string | null | undefined) {
  if (!value || value.length > 64) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

function calendarDay(time: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(time);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function dayNumber(day: { year: number; month: number; day: number }) {
  return Math.round(Date.UTC(day.year, day.month - 1, day.day) / DAY_MS);
}

export function dateGroup(value: string, now: number, timeZone: string): DateGroup {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return { key: "unknown", label: "Earlier", kind: "month" };
  }
  const today = calendarDay(now, timeZone);
  const day = calendarDay(time, timeZone);
  const age = dayNumber(today) - dayNumber(day);
  if (age <= 0) return { key: "today", label: "Today", kind: "today" };
  if (age === 1) return { key: "yesterday", label: "Yesterday", kind: "yesterday" };
  if (age < 7) return { key: "week", label: "Previous 7 days", kind: "week" };
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    ...(day.year === today.year ? {} : { year: "numeric" })
  }).format(time);
  return { key: `${day.year}-${day.month}`, label: month, kind: "month" };
}

// The short time shown at the end of a row, matched to its group.
export function rowTime(value: string, kind: DateGroupKind, timeZone: string) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return "";
  }
  const options: Intl.DateTimeFormatOptions =
    kind === "today" || kind === "yesterday"
      ? { hour: "numeric", minute: "2-digit" }
      : kind === "week"
        ? { weekday: "short" }
        : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(time);
}

export function fullTimestamp(value: string, timeZone: string) {
  const time = Date.parse(value);
  return Number.isNaN(time)
    ? value
    : new Intl.DateTimeFormat("en-US", {
        timeZone,
        dateStyle: "medium",
        timeStyle: "short"
      }).format(time);
}
