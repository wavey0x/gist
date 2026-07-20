"use client";

import { useEffect, useState } from "react";

type LocalTimestampProps = {
  value: string;
  variant?: "long" | "compact";
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
  })
};

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short"
});

function formatLocalTimestamp(value: string, variant: "long" | "compact") {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return `${DATE_FORMATTERS[variant].format(date)} ${TIME_FORMATTER.format(date)}`;
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
