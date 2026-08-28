"use client";

import { useEffect, useState } from "react";

type LocalTimestampProps = {
  value: string;
  variant?: "long" | "compact" | "short";
};

const DATE_FORMATTERS = {
  long: new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }),
  compact: new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }),
  short: new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  })
};

const TIME_FORMATTERS = {
  full: new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }),
  short: new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  })
};

function formatLocalTimestamp(
  value: string,
  variant: "long" | "compact" | "short"
) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  const separator = variant === "short" ? " · " : " ";
  const time = TIME_FORMATTERS[variant === "short" ? "short" : "full"].format(
    date
  );
  return `${DATE_FORMATTERS[variant].format(date)}${separator}${time}`;
}

export function LocalTimestamp({
  value,
  variant = "long"
}: LocalTimestampProps) {
  const [formattedValue, setFormattedValue] = useState<string | null>(null);

  useEffect(() => {
    setFormattedValue(formatLocalTimestamp(value, variant));
  }, [value, variant]);

  return <time dateTime={value}>{formattedValue}</time>;
}
