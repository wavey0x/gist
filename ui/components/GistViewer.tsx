"use client";

import {
  Check,
  Copy,
  FileCode,
  FileDiff,
  History,
  TextSearch
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getGistHeaderTitle } from "../lib/gist-title";
import type { PublicGistPayload, RevisionHistoryItem } from "../lib/gists";
import type { SiteChromeConfig } from "../lib/site-config";
import { RecentlyViewedRecorder } from "./RecentlyViewedRecorder";
import { ThemeToggle } from "./ThemeToggle";

type ViewMode = "rendered" | "raw" | "custom";

type GistViewerProps = {
  chrome: SiteChromeConfig;
  gist: PublicGistPayload;
  customContent?: ReactNode;
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
const GIST_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
});
const GIST_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "UTC"
});

function fallbackAuthorAvatarUrl(authorName: string) {
  return GITHUB_LOGIN_RE.test(authorName)
    ? `https://github.com/${authorName}.png?size=64`
    : null;
}

function authorAvatarInitial(authorName: string) {
  return authorName.trim().charAt(0).toUpperCase() || "?";
}

function formatGistDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return GIST_DATE_FORMATTER.format(date);
}

function formatGistTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return `${GIST_DATE_FORMATTER.format(date)} ${GIST_TIME_FORMATTER.format(date)} UTC`;
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

export function GistViewer({
  chrome,
  gist,
  customContent = null,
  customView
}: GistViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(
    customContent ? "custom" : "rendered"
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rawCopied, setRawCopied] = useState(false);
  const [relativeDateNow, setRelativeDateNow] = useState(() => Date.now());
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const historyControlRef = useRef<HTMLDivElement | null>(null);
  const markdownRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!rawCopied) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setRawCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [rawCopied]);

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
      setViewMode("rendered");
    }
  }, [customContent, viewMode]);

  useEffect(() => {
    if (viewMode !== "rendered") {
      return undefined;
    }

    const markdownRoot = markdownRef.current;
    if (!markdownRoot) {
      return undefined;
    }
    const root: HTMLElement = markdownRoot;

    let activeEntityId: string | null = null;

    function entityIdForTarget(target: EventTarget | null) {
      if (!(target instanceof Element)) {
        return null;
      }
      const entity = target.closest(".eth-entity");
      if (!entity || !root.contains(entity)) {
        return null;
      }
      return Array.from(entity.classList).find((className) =>
        ETH_ENTITY_ID_CLASS_RE.test(className)
      ) ?? null;
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
  }, [gist.rendered_html, viewMode]);

  function applyViewMode(nextViewMode: ViewMode) {
    if (nextViewMode === "custom" && !customContent) {
      return;
    }
    setViewMode(nextViewMode);
    setRawCopied(false);
  }

  function toggleRawMode() {
    applyViewMode(viewMode === "raw" ? "rendered" : "raw");
  }

  async function copyRawMarkdown() {
    try {
      await navigator.clipboard.writeText(gist.markdown);
      setRawCopied(true);
    } catch {
      setRawCopied(false);
    }
  }

  const nextRawViewMode = viewMode === "raw" ? "rendered" : "raw";
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
          {row.label}: {formatGistTimestamp(row.value)}
        </span>
      ))}
    </span>
  );
  const customDiffIsCurrent = viewMode === "custom" && customView === "diff";

  function historyDiffUrl(item: RevisionHistoryItem) {
    return `${item.url.replace(/\/$/, "")}/diff`;
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
              {lastEditedAt ? (
                <span className="gist-date-line gist-date-line-with-tooltip">
                  <span className="gist-date-label">edited:</span>{" "}
                  <time dateTime={lastEditedAt}>{formatGistDate(lastEditedAt)}</time>
                  {dateTooltip}
                </span>
              ) : (
                <span className="gist-date-line gist-date-line-with-tooltip">
                  <span className="gist-date-label">created:</span>{" "}
                  <time dateTime={gist.created_at}>
                    {formatGistDate(gist.created_at)}
                  </time>
                  {dateTooltip}
                </span>
              )}
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
          <button
            type="button"
            className="icon-button"
            aria-label={
              nextRawViewMode === "raw"
                ? "View raw Markdown"
                : "View rendered Markdown"
            }
            title={nextRawViewMode === "raw" ? "Raw" : "Rendered"}
            onClick={toggleRawMode}
          >
            {nextRawViewMode === "raw" ? (
              <FileCode aria-hidden="true" size={18} strokeWidth={1.8} />
            ) : (
              <TextSearch aria-hidden="true" size={18} strokeWidth={1.8} />
            )}
          </button>
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
                    item.revision_number === gist.revision_number;

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
                            {" "}
                            ·{" "}
                            <time dateTime={item.created_at}>
                              {formatRelativeDate(
                                item.created_at,
                                relativeDateNow
                              )}
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

      {viewMode === "rendered" ? (
        <article
          ref={markdownRef}
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: gist.rendered_html }}
        />
      ) : viewMode === "custom" && customContent ? (
        customContent
      ) : (
        <div className="raw-viewer">
          <button
            type="button"
            className="icon-button raw-copy-button"
            aria-label={rawCopied ? "Raw Markdown copied" : "Copy raw Markdown"}
            title={rawCopied ? "Copied" : "Copy"}
            onClick={copyRawMarkdown}
          >
            {rawCopied ? (
              <Check aria-hidden="true" size={17} strokeWidth={1.8} />
            ) : (
              <Copy aria-hidden="true" size={17} strokeWidth={1.8} />
            )}
          </button>
          <pre className="raw-markdown" aria-label="Raw Markdown">
            <code>{gist.markdown}</code>
          </pre>
        </div>
      )}
    </>
  );
}
