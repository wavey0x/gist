"use client";

import { useMemo } from "react";
import { codeLinesHtml, plainLinesHtml } from "../public/code-lines.mjs";

// A code file as numbered lines. `slug` is the file's anchor in a gist with
// several files. A block that cannot be split is shown as stored, unnumbered.
export function CodeLines({ html, slug = "" }: { html: string; slug?: string }) {
  const lines = useMemo(() => codeLinesHtml(html, slug), [html, slug]);
  return (
    <div
      className="markdown-body gist-code-content"
      data-code-lines={lines ? "true" : "false"}
      dangerouslySetInnerHTML={{ __html: lines ?? html }}
    />
  );
}

// A file's source text as the same numbered lines, uncoloured. Used for the
// raw view, which is how a Markdown file gets line links.
export function PlainLines({ text }: { text: string }) {
  const lines = useMemo(() => plainLinesHtml(text), [text]);
  return (
    <div
      className="markdown-body gist-code-content"
      data-code-lines="true"
      aria-label="Raw file"
      dangerouslySetInnerHTML={{ __html: lines }}
    />
  );
}
