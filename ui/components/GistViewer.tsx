"use client";

import {
  Check,
  ChevronDown,
  Copy,
  FileCode,
  FileDiff,
  History,
  TextSearch
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getGistHeaderTitle } from "../lib/gist-title";
import {
  orderedGistFiles,
  type PublicGistFile,
  type PublicGistPayload,
  type RevisionHistoryItem
} from "../lib/gists";
import type { SiteChromeConfig } from "../lib/site-config";
import { LocalTimestamp } from "./LocalTimestamp";
import { RecentlyViewedRecorder } from "./RecentlyViewedRecorder";
import { ThemeToggle } from "./ThemeToggle";

type ViewMode = "files" | "raw" | "custom";

type GistViewerProps = {
  chrome: SiteChromeConfig;
  gist: PublicGistPayload;
  customContent?: ReactNode;
  customDiffFromRevisionNumber?: number;
  customView?: "diff";
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const GITHUB_LOGIN_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const ETH_ENTITY_ID_CLASS_RE = /^eth-id-[a-f0-9]{12}$/;
const ETH_ENTITY_GROUP_HOVER_CLASS = "eth-entity-group-hover";

function fallbackAuthorAvatarUrl(authorName: string) {
  return GITHUB_LOGIN_RE.test(authorName)
    ? `https://github.com/${authorName}.png?size=64`
    : null;
}

function authorAvatarInitial(authorName: string) {
  return authorName.trim().charAt(0).toUpperCase() || "?";
}

function latestRevisionCreatedAt(gist: PublicGistPayload) {
  return gist.history.find((item) => item.is_latest)?.created_at ?? gist.updated_at;
}

function pluralize(value: number, singular: string) {
  return `${value} ${singular}${value === 1 ? "" : "s"} ago`;
}

function formatRelativeDate(value: string, now: number) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  const elapsed = Math.max(0, now - date.valueOf());
  if (elapsed < MINUTE_MS) {
    return "just now";
  }
  if (elapsed < HOUR_MS) {
    return pluralize(Math.floor(elapsed / MINUTE_MS), "min");
  }
  if (elapsed < DAY_MS) {
    return pluralize(Math.floor(elapsed / HOUR_MS), "hour");
  }
  if (elapsed < MONTH_MS) {
    return pluralize(Math.floor(elapsed / DAY_MS), "day");
  }
  if (elapsed < YEAR_MS) {
    return pluralize(Math.floor(elapsed / MONTH_MS), "month");
  }
  return pluralize(Math.floor(elapsed / YEAR_MS), "year");
}

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

function sourceLineNumbers(content: string) {
  return Array.from(
    { length: sourceLineCount(content) },
    (_, index) => index + 1
  ).join("\n");
}

function GistFilePanel({
  file,
  collapsed,
  copied,
  onCollapseToggle,
  onCopy
}: {
  file: PublicGistFile;
  collapsed: boolean;
  copied: boolean;
  onCollapseToggle: () => void;
  onCopy: () => void;
}) {
  const headingId = useId();
  const bodyId = useId();
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
          <button
            type="button"
            className="gist-file-action gist-file-copy"
            aria-label={copied ? `${file.filename} copied` : `Copy ${file.filename}`}
            onClick={onCopy}
          >
            {copied ? (
              <Check aria-hidden="true" size={14} strokeWidth={1.9} />
            ) : (
              <Copy aria-hidden="true" size={14} strokeWidth={1.9} />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
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
          <div className="gist-code-view">
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

export function GistViewer({
  chrome,
  gist,
  customContent = null,
  customDiffFromRevisionNumber,
  customView
}: GistViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(
    customContent ? "custom" : "files"
  );
  const [collapsedFilenames, setCollapsedFilenames] = useState<Set<string>>(
    () => new Set()
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedFilename, setCopiedFilename] = useState<string | null>(null);
  const [relativeDateNow, setRelativeDateNow] = useState(() => Date.now());
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const historyControlRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const files = orderedGistFiles(gist);
  const singleFile = files.length === 1 ? files[0] : null;

  useEffect(() => {
    if (!copiedFilename) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setCopiedFilename(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copiedFilename]);

  useEffect(() => {
    if (!historyOpen) {
      return undefined;
    }
    setRelativeDateNow(Date.now());
    const interval = window.setInterval(() => {
      setRelativeDateNow(Date.now());
    }, MINUTE_MS);
    return () => window.clearInterval(interval);
  }, [historyOpen]);

  useEffect(() => {
    if (!historyOpen) {
      return undefined;
    }

    function handleDocumentPointerDown(event: PointerEvent) {
      const historyControl = historyControlRef.current;
      if (
        historyControl &&
        event.target instanceof Node &&
        !historyControl.contains(event.target)
      ) {
        setHistoryOpen(false);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setHistoryOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [historyOpen]);

  useEffect(() => {
    if (viewMode === "custom" && !customContent) {
      setViewMode("files");
    }
  }, [customContent, viewMode]);

  useEffect(() => {
    setCollapsedFilenames((current) =>
      current.size === 0 ? current : new Set()
    );
  }, [gist.id, gist.revision_number]);

  useEffect(() => {
    if (viewMode !== "files") {
      return undefined;
    }

    const contentRoot = contentRef.current;
    if (!contentRoot) {
      return undefined;
    }
    const root: HTMLDivElement = contentRoot;

    let activeEntityId: string | null = null;

    function entityIdForTarget(target: EventTarget | null) {
      if (!(target instanceof Element)) {
        return null;
      }
      const entity = target.closest(".eth-entity");
      if (!entity || !root.contains(entity)) {
        return null;
      }
      return (
        Array.from(entity.classList).find((className) =>
          ETH_ENTITY_ID_CLASS_RE.test(className)
        ) ?? null
      );
    }

    function clearGroupHover() {
      if (!activeEntityId) {
        return;
      }
      root.querySelectorAll(`.${activeEntityId}`).forEach((element) => {
        element.classList.remove(ETH_ENTITY_GROUP_HOVER_CLASS);
      });
      activeEntityId = null;
    }

    function setGroupHover(entityId: string | null) {
      if (!entityId || entityId === activeEntityId) {
        return;
      }
      clearGroupHover();
      activeEntityId = entityId;
      root.querySelectorAll(`.${entityId}`).forEach((element) => {
        element.classList.add(ETH_ENTITY_GROUP_HOVER_CLASS);
      });
    }

    function relatedTargetHasEntityId(
      relatedTarget: EventTarget | null,
      entityId: string
    ) {
      return (
        relatedTarget instanceof Element &&
        root.contains(relatedTarget) &&
        Boolean(relatedTarget.closest(`.${entityId}`))
      );
    }

    function handlePointerOver(event: PointerEvent) {
      setGroupHover(entityIdForTarget(event.target));
    }

    function handlePointerOut(event: PointerEvent) {
      if (
        activeEntityId &&
        entityIdForTarget(event.target) === activeEntityId &&
        !relatedTargetHasEntityId(event.relatedTarget, activeEntityId)
      ) {
        clearGroupHover();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      setGroupHover(entityIdForTarget(event.target));
    }

    function handleFocusOut(event: FocusEvent) {
      if (
        activeEntityId &&
        entityIdForTarget(event.target) === activeEntityId &&
        !relatedTargetHasEntityId(event.relatedTarget, activeEntityId)
      ) {
        clearGroupHover();
      }
    }

    root.addEventListener("pointerover", handlePointerOver);
    root.addEventListener("pointerout", handlePointerOut);
    root.addEventListener("focusin", handleFocusIn);
    root.addEventListener("focusout", handleFocusOut);

    return () => {
      clearGroupHover();
      root.removeEventListener("pointerover", handlePointerOver);
      root.removeEventListener("pointerout", handlePointerOut);
      root.removeEventListener("focusin", handleFocusIn);
      root.removeEventListener("focusout", handleFocusOut);
    };
  }, [gist.snapshot_sha256, viewMode]);

  async function copyFile(file: PublicGistFile) {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedFilename(file.filename);
    } catch {
      setCopiedFilename(null);
    }
  }

  function toggleRawMode() {
    setViewMode((current) => (current === "raw" ? "files" : "raw"));
    setCopiedFilename(null);
  }

  function toggleFile(filename: string) {
    setCollapsedFilenames((current) => {
      const next = new Set(current);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  }

  const headerTitle = getGistHeaderTitle(gist);
  const avatarUrl =
    gist.author_avatar_url ?? fallbackAuthorAvatarUrl(gist.author_name);
  const visibleAvatarUrl =
    avatarUrl && avatarUrl !== failedAvatarUrl ? avatarUrl : null;
  const lastEditedAt =
    gist.latest_revision_number > 1 ? latestRevisionCreatedAt(gist) : null;
  const dateTooltipRows = lastEditedAt
    ? [
        { label: "created", value: gist.created_at },
        { label: "edited", value: lastEditedAt }
      ]
    : [{ label: "created", value: gist.created_at }];
  const dateTooltip = (
    <span className="gist-date-tooltip" aria-hidden="true">
      {dateTooltipRows.map((row) => (
        <span className="gist-date-tooltip-row" key={row.label}>
          {row.label}: <LocalTimestamp value={row.value} />
        </span>
      ))}
    </span>
  );
  const customDiffIsCurrent = viewMode === "custom" && customView === "diff";
  const rawIsVisible = viewMode === "raw" && Boolean(singleFile);

  function historyDiffUrl(item: RevisionHistoryItem) {
    const gistUrl = item.url
      .replace(/\/revisions\/[1-9][0-9]*\/?$/, "")
      .replace(/\/$/, "");
    const revisionNumber = item.revision_number;
    return `${gistUrl}/diff/${revisionNumber - 1}..${revisionNumber}`;
  }

  return (
    <>
      <RecentlyViewedRecorder gist={gist} />
      <header
        className={
          chrome.showBrandMark ? "page-header" : "page-header page-header-no-brand"
        }
      >
        {chrome.showBrandMark ? (
          <div className="brand-mark" aria-label={`${chrome.brandName} gist`}>
            <span className="brand-mark-strong">{chrome.brandName}</span>
            <span className="brand-mark-light">gist</span>
          </div>
        ) : null}
        <div className="gist-heading">
          {headerTitle ? <h1 className="gist-title">{headerTitle}</h1> : null}
          <div className="gist-meta">
            <div className="gist-date-row">
              <span className="gist-date-line gist-date-line-with-tooltip">
                <span className="gist-date-label">
                  {lastEditedAt ? "edited:" : "created:"}
                </span>{" "}
                <LocalTimestamp value={lastEditedAt ?? gist.created_at} />
                {dateTooltip}
              </span>
            </div>
            <div className="gist-author-row">
              <span className="gist-author-line">
                {visibleAvatarUrl ? (
                  <img
                    className="gist-author-avatar"
                    src={visibleAvatarUrl}
                    alt=""
                    width={18}
                    height={18}
                    onError={() => setFailedAvatarUrl(visibleAvatarUrl)}
                  />
                ) : (
                  <span
                    className="gist-author-avatar gist-author-avatar-placeholder"
                    aria-hidden="true"
                  >
                    {authorAvatarInitial(gist.author_name)}
                  </span>
                )}
                by <span className="gist-author-name">{gist.author_name}</span>
              </span>
              {gist.revision_number < gist.latest_revision_number ? (
                <span>Revision {gist.revision_number}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="toolbar" aria-label="Display controls">
          {customContent ? (
            <button
              type="button"
              className="icon-button"
              aria-label={viewMode === "custom" ? "View files" : "View diff"}
              title={viewMode === "custom" ? "Files" : "Diff"}
              onClick={() =>
                setViewMode((current) => (current === "custom" ? "files" : "custom"))
              }
            >
              {viewMode === "custom" ? (
                <FileCode aria-hidden="true" size={18} strokeWidth={1.8} />
              ) : (
                <FileDiff aria-hidden="true" size={18} strokeWidth={1.8} />
              )}
            </button>
          ) : singleFile ? (
            <button
              type="button"
              className="icon-button"
              aria-label={rawIsVisible ? "View rendered file" : "View raw file"}
              title={rawIsVisible ? "Rendered" : "Raw"}
              onClick={toggleRawMode}
            >
              {rawIsVisible ? (
                <TextSearch aria-hidden="true" size={18} strokeWidth={1.8} />
              ) : (
                <FileCode aria-hidden="true" size={18} strokeWidth={1.8} />
              )}
            </button>
          ) : null}
          <div className="history-control" ref={historyControlRef}>
            <button
              type="button"
              className="icon-button"
              aria-label="View revision history"
              aria-expanded={historyOpen}
              aria-controls="revision-history"
              title="History"
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History aria-hidden="true" size={18} strokeWidth={1.8} />
            </button>
            {historyOpen ? (
              <div
                id="revision-history"
                className="history-menu"
                role="menu"
                aria-label="Revision history"
              >
                {gist.history.map((item) => {
                  const revisionIsCurrent =
                    !customDiffIsCurrent &&
                    item.revision_number === gist.revision_number;
                  const diffIsCurrent =
                    customDiffIsCurrent &&
                    item.revision_number === gist.revision_number &&
                    customDiffFromRevisionNumber === item.revision_number - 1;

                  return (
                    <div
                      key={item.revision_number}
                      className="history-item-row"
                      role="none"
                    >
                      <a
                        className="history-item"
                        href={item.url}
                        aria-current={revisionIsCurrent ? "page" : undefined}
                        role="menuitem"
                      >
                        <span className="history-item-title">
                          Revision {item.revision_number}
                        </span>
                        <span className="history-item-meta">
                          {item.author_name}
                          <span className="history-item-date">
                            {" "}·{" "}
                            <time dateTime={item.created_at}>
                              {formatRelativeDate(item.created_at, relativeDateNow)}
                            </time>
                          </span>
                          {item.is_latest ? (
                            <span className="history-item-latest"> · latest</span>
                          ) : null}
                        </span>
                      </a>
                      {item.revision_number > 1 ? (
                        <a
                          className="history-diff-link"
                          href={historyDiffUrl(item)}
                          aria-label={`Compare revision ${item.revision_number} with previous revision`}
                          aria-current={diffIsCurrent ? "page" : undefined}
                          title="Diff"
                          role="menuitem"
                        >
                          <FileDiff
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.8}
                          />
                        </a>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          <ThemeToggle />
        </div>
      </header>

      {viewMode === "custom" && customContent ? (
        customContent
      ) : rawIsVisible && singleFile ? (
        <div className="raw-viewer gist-single-file">
          <button
            type="button"
            className="icon-button raw-copy-button"
            aria-label={
              copiedFilename === singleFile.filename
                ? `${singleFile.filename} copied`
                : `Copy ${singleFile.filename}`
            }
            title={copiedFilename === singleFile.filename ? "Copied" : "Copy"}
            onClick={() => void copyFile(singleFile)}
          >
            {copiedFilename === singleFile.filename ? (
              <Check aria-hidden="true" size={17} strokeWidth={1.8} />
            ) : (
              <Copy aria-hidden="true" size={17} strokeWidth={1.8} />
            )}
          </button>
          <pre className="raw-markdown" aria-label="Raw file">
            <code>{singleFile.content}</code>
          </pre>
        </div>
      ) : singleFile?.kind === "markdown" ? (
        <div ref={contentRef} className="gist-single-file">
          <article
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: singleFile.rendered_html }}
          />
        </div>
      ) : singleFile ? (
        <div ref={contentRef} className="gist-single-file">
          <div className="gist-code-view">
            <pre className="gist-line-numbers" aria-hidden="true">
              {sourceLineNumbers(singleFile.content)}
            </pre>
            <div
              className="markdown-body gist-code-content"
              dangerouslySetInnerHTML={{ __html: singleFile.rendered_html }}
            />
          </div>
        </div>
      ) : (
        <div className="gist-files" ref={contentRef}>
          {files.map((file) => (
            <GistFilePanel
              key={file.filename}
              file={file}
              collapsed={collapsedFilenames.has(file.filename)}
              copied={copiedFilename === file.filename}
              onCollapseToggle={() => toggleFile(file.filename)}
              onCopy={() => void copyFile(file)}
            />
          ))}
        </div>
      )}
    </>
  );
}
