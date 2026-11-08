"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  content: string;
  label: string;
  className?: string;
  compact?: boolean;
};

export function CodeCopyButton({ content, label, className = "code-copy-button", compact = false }: Props) {
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempt = useRef(0);
  useEffect(() => () => { clearTimeout(timer.current); ++attempt.current; }, []);

  async function copy() {
    const current = ++attempt.current;
    clearTimeout(timer.current);
    let message: string;
    try {
      await navigator.clipboard.writeText(content);
      message = "Copied";
    } catch {
      message = "Couldn’t copy. Select the code and copy manually.";
    }
    if (current !== attempt.current) return;
    setStatus(message);
    timer.current = setTimeout(() => setStatus(""), message === "Copied" ? 1500 : 4000);
  }

  return (
    <span className="code-copy-control" data-feedback={status ? "true" : undefined}>
      <button type="button" className={className} aria-label={label}
        title={status || "Copy code"} onClick={() => void copy()}>
        {status === "Copied" ? <Check aria-hidden="true" size={16} strokeWidth={1.8} /> : <Copy aria-hidden="true" size={16} strokeWidth={1.8} />}
        {compact ? <span>{status === "Copied" ? "Copied" : status ? "Copy failed" : "Copy"}</span> : null}
      </button>
      <span className={compact ? "sr-only" : "code-copy-status"} role="status">{status}</span>
    </span>
  );
}
