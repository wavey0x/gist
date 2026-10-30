"use client";

import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { seekToFraction } from "../lib/audio-engine";

type Prompt = {
  fraction: number;
  top: number;
  left: number;
};

const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote";
const PROMPT_DURATION_MS = 3500;

// Narration has no timestamps, so a passage's place in the text estimates its
// place in the recording.
function articleFraction(block: Element, article: Element) {
  const range = document.createRange();
  range.selectNodeContents(article);
  range.setEndBefore(block);
  const total = article.textContent?.length ?? 0;
  return total > 0 ? range.toString().length / total : 0;
}

export function ListenFromHere() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest("a, button, input, img, pre, table, .mermaid-panzoom") ||
        !window.getSelection()?.isCollapsed
      ) {
        return;
      }
      const article = target.closest(".gist-single-file .markdown-body");
      const block = target.closest(BLOCK_SELECTOR);
      if (!article || !block || !article.contains(block)) {
        return;
      }
      const rect = block.getBoundingClientRect();
      setPrompt({
        fraction: articleFraction(block, article),
        top: rect.top + window.scrollY,
        left: Math.min(event.pageX, window.innerWidth - 150)
      });
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!prompt) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setPrompt(null), PROMPT_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [prompt]);

  if (!prompt) {
    return null;
  }
  return (
    <button
      type="button"
      className="listen-from-here"
      style={{ top: prompt.top, left: prompt.left }}
      onClick={() => {
        seekToFraction(prompt.fraction);
        setPrompt(null);
      }}
    >
      <Play aria-hidden="true" size={12} strokeWidth={2} />
      Listen from here
    </button>
  );
}
