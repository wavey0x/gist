"use client";

import { useEffect, useState } from "react";

type ApiKeyCopyButtonProps = {
  apiKey: string;
};

export function ApiKeyCopyButton({ apiKey }: ApiKeyCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyApiKey() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="api-key-copy-action"
      data-copied={copied ? "true" : "false"}
      aria-live="polite"
      onClick={copyApiKey}
    >
      <span className={copied ? "api-key-copy-feedback" : undefined}>
        {copied ? "Copied" : "Copy API key"}
      </span>
    </button>
  );
}
