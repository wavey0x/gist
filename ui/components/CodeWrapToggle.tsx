"use client";

import { TextWrap } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "waveygist:code-wrap:v1";

export function CodeWrapToggle() {
  const [wrapped, setWrapped] = useState(false);

  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      // Storage may be unavailable in private browsing.
    }
    document.documentElement.dataset.codeWrap = String(saved);
    setWrapped(saved);
  }, []);

  function toggle() {
    const next = !wrapped;
    document.documentElement.dataset.codeWrap = String(next);
    setWrapped(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // The current page still responds when storage is unavailable.
    }
  }

  return (
    <button
      type="button"
      className="icon-button code-wrap-toggle-button"
      aria-label="Wrap code lines"
      aria-pressed={wrapped}
      title={wrapped ? "Stop wrapping code lines" : "Wrap code lines"}
      onClick={toggle}
    >
      <TextWrap aria-hidden="true" size={16} strokeWidth={1.8} />
    </button>
  );
}
