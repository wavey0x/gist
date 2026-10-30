"use client";

import { useEffect, useState } from "react";

async function fetchApiKey() {
  const response = await fetch("/api/me/key", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load API key");
  }
  const payload = (await response.json()) as { key: string };
  return payload.key;
}

export function ApiKeyCopyButton() {
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
      // Safari only allows a clipboard write that starts inside the tap.
      if (typeof ClipboardItem === "function") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": fetchApiKey().then(
              (key) => new Blob([key], { type: "text/plain" })
            )
          })
        ]);
      } else {
        await navigator.clipboard.writeText(await fetchApiKey());
      }
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
      <span>{copied ? "Copied!" : "Copy API key"}</span>
    </button>
  );
}
