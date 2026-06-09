"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ApiKeyDisclosureProps = {
  apiKey: string;
  keyPrefix: string;
};

export function ApiKeyDisclosure({ apiKey, keyPrefix }: ApiKeyDisclosureProps) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyApiKey() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      inputRef.current?.select();
    } catch {
      setCopied(false);
    }
  }

  return (
    <details className="api-key-disclosure">
      <summary>
        <span>View API key</span>
        <code>{keyPrefix}</code>
      </summary>
      <div className="api-key-row">
        <input
          ref={inputRef}
          className="api-key-field"
          value={apiKey}
          readOnly
          spellCheck={false}
          aria-label="API key"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="icon-button api-key-copy-button"
          aria-label={copied ? "API key copied" : "Copy API key"}
          title={copied ? "Copied" : "Copy"}
          onClick={copyApiKey}
        >
          {copied ? (
            <Check aria-hidden="true" size={17} strokeWidth={1.8} />
          ) : (
            <Copy aria-hidden="true" size={17} strokeWidth={1.8} />
          )}
        </button>
      </div>
    </details>
  );
}
