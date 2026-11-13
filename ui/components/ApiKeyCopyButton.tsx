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
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-label">API key</span>
        <span
          className="settings-row-note"
          data-tone={error ? "danger" : undefined}
          role="status"
        >
          {error || "Lets your agents publish gists as you. Keep it private."}
        </span>
      </div>
      <button
        type="button"
        className="settings-button api-key-copy-action"
        data-copied={copied ? "true" : "false"}
        onClick={copyApiKey}
      >
        {copied ? (
          <Check size={15} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Copy size={15} strokeWidth={1.8} aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy key"}
      </button>
    </div>
  );
}
