"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

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
  const [error, setError] = useState("");

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyApiKey() {
    setError("");
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
      setError("Couldn’t copy the API key. Try again.");
    }
  }

  return (
    <span className="code-copy-control">
      <button
        type="button"
        className="icon-button api-key-copy-action"
        data-copied={copied ? "true" : "false"}
        aria-label="Copy API key"
        title={copied ? "Copied" : "Copy API key"}
        onClick={copyApiKey}
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      </button>
      <span role="status" className={error ? "code-copy-status" : "sr-only"}>{error || (copied ? "Copied" : "")}</span>
    </span>
  );
}
