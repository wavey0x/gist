"use client";

import {
  Check,
  Copy,
  FileCode,
  History,
  Moon,
  Sun,
  TextSearch
} from "lucide-react";
import { useEffect, useState } from "react";
import { getGistHeaderTitle } from "../lib/gist-title";
import type { PublicGistPayload } from "../lib/gists";
import type { SiteChromeConfig } from "../lib/site-config";

type Theme = "light" | "dark";
type ViewMode = "rendered" | "raw";

type GistViewerProps = {
  chrome: SiteChromeConfig;
  gist: PublicGistPayload;
};

export function GistViewer({ chrome, gist }: GistViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("rendered");
  const [theme, setTheme] = useState<Theme>("light");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rawCopied, setRawCopied] = useState(false);

  useEffect(() => {
    const current =
      document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
  }, []);

  useEffect(() => {
    if (!rawCopied) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setRawCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [rawCopied]);

  function applyTheme(nextTheme: Theme) {
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  }

  function applyViewMode(nextViewMode: ViewMode) {
    setViewMode(nextViewMode);
    setRawCopied(false);
  }

  function toggleViewMode() {
    applyViewMode(viewMode === "rendered" ? "raw" : "rendered");
  }

  async function copyRawMarkdown() {
    try {
      await navigator.clipboard.writeText(gist.markdown);
      setRawCopied(true);
    } catch {
      setRawCopied(false);
    }
  }

  const nextTheme = theme === "dark" ? "light" : "dark";
  const nextViewMode = viewMode === "rendered" ? "raw" : "rendered";
  const headerTitle = getGistHeaderTitle(gist);

  return (
    <>
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
            <span>
              by <span className="gist-author-name">{gist.author_name}</span>
            </span>
            {gist.revision_number < gist.latest_revision_number ? (
              <span>Revision {gist.revision_number}</span>
            ) : null}
          </div>
        </div>
        <div className="toolbar" aria-label="Display controls">
          <button
            type="button"
            className="icon-button"
            aria-label={
              nextViewMode === "raw"
                ? "View raw Markdown"
                : "View rendered Markdown"
            }
            title={nextViewMode === "raw" ? "Raw" : "Rendered"}
            onClick={toggleViewMode}
          >
            {nextViewMode === "raw" ? (
              <FileCode aria-hidden="true" size={18} strokeWidth={1.8} />
            ) : (
              <TextSearch aria-hidden="true" size={18} strokeWidth={1.8} />
            )}
          </button>
          <div className="history-control">
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
                {gist.history.map((item) => (
                  <a
                    key={item.revision_number}
                    className="history-item"
                    href={item.url}
                    aria-current={
                      item.revision_number === gist.revision_number
                        ? "page"
                        : undefined
                    }
                    role="menuitem"
                  >
                    <span className="history-item-title">
                      Revision {item.revision_number}
                    </span>
                    <span className="history-item-meta">
                      {item.author_name}
                      {item.is_latest ? " - latest" : ""}
                    </span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={`Switch to ${nextTheme} mode`}
            title={nextTheme === "dark" ? "Dark" : "Light"}
            onClick={() => applyTheme(nextTheme)}
          >
            {theme === "dark" ? (
              <Sun aria-hidden="true" size={18} strokeWidth={1.8} />
            ) : (
              <Moon aria-hidden="true" size={18} strokeWidth={1.8} />
            )}
          </button>
        </div>
      </header>

      {viewMode === "rendered" ? (
        <article
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: gist.rendered_html }}
        />
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
