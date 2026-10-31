"use client";

import { useEffect, useState } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;
const SAME_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const OTHER_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric"
});
const FULL = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short"
});

export function formatRelativeTime(value: string, now = Date.now()) {
  const date = new Date(value);
  const time = date.valueOf();
  if (Number.isNaN(time)) {
    return value;
  }
  const elapsed = Math.max(0, now - time);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDay = new Date(time);
  startOfDay.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday.valueOf() - startOfDay.valueOf()) / DAY_MS);
  if (days <= 0) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return (date.getFullYear() === new Date(now).getFullYear() ? SAME_YEAR : OTHER_YEAR).format(
    date
  );
}

export function RelativeTime({ value }: { value: string }) {
  const [label, setLabel] = useState<string | null>(null);
  const [title, setTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    setLabel(formatRelativeTime(value));
    const date = new Date(value);
    setTitle(Number.isNaN(date.valueOf()) ? undefined : FULL.format(date));
  }, [value]);

  return (
    <time dateTime={value} title={title}>
      {label}
    </time>
  );
}
