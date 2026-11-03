// Row dates for list views. Server and client format them with the same time
// zone and clock so the first render hydrates without a jump.

export const TIME_ZONE_COOKIE = "wg_tz";

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

// The date shown at the end of a row: the time today, "Nov 2, 5:11 PM" this
// year, and "Oct 27, 2025" before that.
export function rowTime(value: string, now: number, timeZone: string) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return "";
  }
  const today = calendarDay(now, timeZone);
  const day = calendarDay(time, timeZone);
  const sameDay =
    today.year === day.year && today.month === day.month && today.day === day.day;
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : day.year === today.year
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric" };
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
