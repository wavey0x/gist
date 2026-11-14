"use client";

import { useMemo } from "react";
import { codeLinesHtml } from "../public/code-lines.mjs";

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
