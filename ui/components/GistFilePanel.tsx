"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { PublicGistFile } from "../lib/gists";
import { CodeCopyButton } from "./CodeCopyButton";
import { CodeWrapToggle } from "./CodeWrapToggle";

function formatByteSize(byteSize: number) {
  if (byteSize < 1024) {
    return `${byteSize} B`;
  }
  return `${(byteSize / 1024).toFixed(byteSize < 10 * 1024 ? 1 : 0)} KB`;
}

function sourceLineCount(content: string) {
  if (!content) {
    return 1;
  }
  const count = content.split("\n").length;
  return content.endsWith("\n") ? Math.max(1, count - 1) : count;
}

export function sourceLineNumbers(content: string) {
  return Array.from(
    { length: sourceLineCount(content) },
    (_, index) => index + 1
  ).join("\n");
}

export function GistFilePanel({
  file,
  collapsed,
  onCollapseToggle
}: {
  file: PublicGistFile;
  collapsed: boolean;
  onCollapseToggle?: () => void;
}) {
  const headingId = useId();
  const bodyId = useId();
  const [wrapped, setWrapped] = useState(false);
  const metadata = [file.language, formatByteSize(file.byte_size)]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className="gist-file-panel"
      data-gist-filename={file.filename}
      data-collapsed={collapsed ? "true" : "false"}
      aria-labelledby={headingId}
    >
      <header className="gist-file-header">
        <button
          type="button"
          className="gist-file-disclosure"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${file.filename}`}
          onClick={onCollapseToggle}
        >
          <ChevronDown
            className="gist-file-chevron"
            aria-hidden="true"
            size={15}
            strokeWidth={1.9}
          />
          <span className="gist-file-identity">
            <span className="gist-file-name" id={headingId}>
              {file.filename}
            </span>
            <span className="gist-file-meta">{metadata}</span>
          </span>
        </button>
        <div className="gist-file-actions">
          <a className="gist-file-action" href={file.raw_url}>
            Raw
          </a>
          {!collapsed && file.kind !== "markdown" ? (
            <CodeWrapToggle
              wrapped={wrapped}
              onToggle={() => setWrapped((current) => !current)}
              className="gist-file-action gist-file-wrap"
              label={`Wrap lines in ${file.filename}`}
            />
          ) : null}
          <CodeCopyButton content={file.content} label={`Copy ${file.filename}`}
            className="gist-file-action gist-file-copy" />
        </div>
      </header>
      <div className="gist-file-body" id={bodyId} hidden={collapsed}>
        {!collapsed && file.kind === "markdown" ? (
          <article
            className="markdown-body gist-file-markdown"
            dangerouslySetInnerHTML={{ __html: file.rendered_html }}
          />
        ) : null}
        {!collapsed && file.kind !== "markdown" ? (
          <div className="gist-code-view" data-code-wrap={wrapped}>
            <pre className="gist-line-numbers" aria-hidden="true">
              {sourceLineNumbers(file.content)}
            </pre>
            <div
              className="markdown-body gist-code-content"
              dangerouslySetInnerHTML={{ __html: file.rendered_html }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

