"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { addMarkdownWrapControls } from "../lib/code-wrap";
import { orderedGistFiles, type PublicGistPayload } from "../lib/gists";
import { readSavedGist } from "../lib/offline-library";
import type { SiteChromeConfig } from "../lib/site-config";
import { fileSlugs } from "../public/code-lines.mjs";
import { CodeLines } from "./CodeLines";
import { GistFilePanel } from "./GistFilePanel";
import { GistHeading } from "./GistHeading";

const GIST_ROUTE_RE = /^\/([A-Za-z0-9]{16,64})(?:\/revisions\/([1-9][0-9]*))?\/?$/;

// Paints the saved copy the moment a gist is opened; the server page replaces
// it when it arrives, so a slow connection never shows an empty screen.
export function SavedGistPreview({ chrome }: { chrome: SiteChromeConfig }) {
  const pathname = usePathname();
  const contentRef = useRef<HTMLElement | null>(null);
  const [saved, setSaved] = useState<{ pathname: string; gist: PublicGistPayload | null } | null>(null);
  const gist = saved?.pathname === pathname ? saved.gist : null;

  useLayoutEffect(() => {
    if (gist && contentRef.current) addMarkdownWrapControls(contentRef.current);
  }, [gist]);

  useEffect(() => {
    const match = GIST_ROUTE_RE.exec(pathname);
    if (!match) {
      return undefined;
    }
    let disposed = false;
    void readSavedGist(match[1], match[2] ? Number(match[2]) : null)
      .then((gist) => {
        if (!disposed) setSaved({ pathname, gist });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [pathname]);

  const files = gist ? orderedGistFiles(gist) : [];
  const file = files.length === 1 ? files[0] : null;
  const slugs = fileSlugs(files.map((item) => item.filename));
  return (
    <main ref={contentRef} className={files.length > 1 ? "page-shell page-shell-gist" : "page-shell"}
      aria-busy="true" aria-label="Loading" inert>
      {gist ? (
        <>
          <header className={chrome.showBrandMark ? "page-header" : "page-header page-header-no-brand"}>
            {chrome.showBrandMark ? (
              <div className="brand-mark">
                <span className="brand-mark-strong">{chrome.brandName}</span>
                <span className="brand-mark-light">gist</span>
              </div>
            ) : null}
            <GistHeading gist={gist} />
            <div className="article-audio-toolbar-group saved-preview-controls" aria-hidden="true">
              <div className="toolbar">
                {file ? <span className="icon-button" /> : null}
                <span className="icon-button" />
              </div>
            </div>
          </header>
          {file?.kind === "markdown" ? <div className="gist-single-file">
            <article
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: file.rendered_html }}
            />
          </div> : file ? (
            <div className="gist-single-file gist-code-container">
              <div className="gist-code-view" data-code-wrap="false">
                <CodeLines html={file.rendered_html} />
              </div>
            </div>
          ) : (
            <div className="gist-files">
              {files.map((file) => (
                <GistFilePanel key={file.filename} file={file} slug={slugs[file.filename]} collapsed={false} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="loading-skeleton" aria-hidden="true">
          <span className="loading-line loading-line-title" />
          <span className="loading-line" />
          <span className="loading-line" />
          <span className="loading-line loading-line-short" />
        </div>
      )}
    </main>
  );
}
