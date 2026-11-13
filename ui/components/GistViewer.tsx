"use client";

import {
  FileCode,
  FileDiff,
  History,
  TextSearch
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { mountGallery } from "../public/gallery-viewer.mjs";
import { addMarkdownWrapControls } from "../lib/code-wrap";
import { getGistHeaderTitle, getTopLevelHeading } from "../lib/gist-title";
import {
  orderedGistFiles,
  type PublicGistPayload,
  type RevisionHistoryItem
} from "../lib/gists";
import type { SiteChromeConfig } from "../lib/site-config";
import { ArticleAudio } from "./ArticleAudio";
import { CodeCopyButton } from "./CodeCopyButton";
import { CodeWrapToggle } from "./CodeWrapToggle";
import { LocalTimestamp } from "./LocalTimestamp";
import { GistHeading } from "./GistHeading";
import { GistFilePanel, sourceLineNumbers } from "./GistFilePanel";
import { ReadingProgress } from "./ReadingProgress";
import { RecentlyViewedRecorder } from "./RecentlyViewedRecorder";
import { refreshJson, usePageRefresh, useRefreshRoute } from "../lib/page-refresh";
import { getAudioEngineState } from "../lib/audio-engine";

type ViewMode = "files" | "raw" | "custom";

type GistViewerProps = {
  chrome: SiteChromeConfig;
  gist: PublicGistPayload;
  customContent?: ReactNode;
  customDiffFromRevisionNumber?: number;
  customView?: "diff";
  canUseNarration?: boolean;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const ETH_ENTITY_ID_CLASS_RE = /^eth-id-[a-f0-9]{12}$/;
const ETH_ENTITY_GROUP_HOVER_CLASS = "eth-entity-group-hover";

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
  canUseNarration = false,
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
  const [relativeDateNow, setRelativeDateNow] = useState(() => Date.now());
  const [singleFileWrapped, setSingleFileWrapped] = useState(false);
  const historyControlRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const files = orderedGistFiles(gist);
  const singleFile = files.length === 1 ? files[0] : null;
  const primaryFile = gist.files[gist.primary_file];
  const refreshRoute = useRefreshRoute();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => setUpdateAvailable(false), [gist.id, gist.revision_number]);

  usePageRefresh(async (signal) => {
    const payload = await refreshJson(
      `/api/gists/${gist.id}/revisions/${gist.revision_number}/render`, signal
    ) as PublicGistPayload;
    const audio = getAudioEngineState();
    if (location.pathname === `/${gist.id}` && payload.latest_revision_number > gist.revision_number &&
        audio.opened && audio.track?.gistId === gist.id) {
      setUpdateAvailable(true);
      return "New revision available";
    }
    await refreshRoute(signal);
  });

  useEffect(() => {
    if (viewMode !== "files" || !contentRef.current) return;
    addMarkdownWrapControls(contentRef.current);
    return mountGallery(contentRef.current.querySelectorAll<HTMLElement>("article.markdown-body"));
  }, [gist.id, gist.revision_number, gist.snapshot_sha256, viewMode, collapsedFilenames]);

  useEffect(() => {
    setSingleFileWrapped(false);
  }, [gist.id, gist.revision_number]);

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

  function toggleRawMode() {
    setViewMode((current) => (current === "raw" ? "files" : "raw"));
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
  const articleAudioTitle =
    getTopLevelHeading(gist) ?? headerTitle ?? gist.display_title;
  const customDiffIsCurrent = viewMode === "custom" && customView === "diff";
  const rawIsVisible = viewMode === "raw" && Boolean(singleFile);
  const narrationIsActive =
    canUseNarration &&
    !customContent &&
    (viewMode === "files" || rawIsVisible) &&
    primaryFile?.kind === "markdown";

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
        <GistHeading gist={gist}>
          {updateAvailable ? <button className="gist-update-action" type="button"
            onClick={() => void refreshRoute(new AbortController().signal)}>View updated gist</button> : null}
        </GistHeading>
        <ArticleAudio
          active={narrationIsActive}
          articleTitle={articleAudioTitle}
          authorName={gist.author_name}
          gistId={gist.id}
          revisionNumber={gist.revision_number}
        >
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
        </ArticleAudio>
      </header>

      {viewMode === "files" && singleFile?.kind === "markdown" && !rawIsVisible ? (
        <ReadingProgress gistId={gist.id} revisionNumber={gist.revision_number} />
      ) : null}

      {viewMode === "custom" && customContent ? (
        customContent
      ) : rawIsVisible && singleFile ? (
        <div className="raw-viewer gist-single-file" data-code-wrap={singleFileWrapped}>
          <div className="code-block-actions">
            <CodeWrapToggle wrapped={singleFileWrapped}
              onToggle={() => setSingleFileWrapped((current) => !current)}
              label={`Wrap lines in ${singleFile.filename}`} />
            <CodeCopyButton key={`${gist.snapshot_sha256}:raw`} content={singleFile.content}
              label={`Copy ${singleFile.filename}`} />
          </div>
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
        <div ref={contentRef} className="gist-single-file gist-code-container">
          <div className="code-block-actions">
            <CodeWrapToggle wrapped={singleFileWrapped}
              onToggle={() => setSingleFileWrapped((current) => !current)}
              label={`Wrap lines in ${singleFile.filename}`} />
            <CodeCopyButton key={`${gist.snapshot_sha256}:source`} content={singleFile.content}
              label={`Copy ${singleFile.filename}`} />
          </div>
          <div className="gist-code-view" data-code-wrap={singleFileWrapped}>
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
              key={`${gist.id}:${gist.revision_number}:${file.filename}`}
              file={file}
              collapsed={collapsedFilenames.has(file.filename)}
              onCollapseToggle={() => toggleFile(file.filename)}
            />
          ))}
        </div>
      )}
    </>
  );
}
