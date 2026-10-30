"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { orderedGistFiles, type PublicGistPayload } from "../lib/gists";
import { readSavedGist } from "../lib/offline-library";

const GIST_ROUTE_RE = /^\/([A-Za-z0-9]{16,64})(?:\/revisions\/([1-9][0-9]*))?\/?$/;

// Paints the saved copy the moment a gist is opened; the server page replaces
// it when it arrives, so a slow connection never shows an empty screen.
export function SavedGistPreview() {
  const pathname = usePathname();
  const [gist, setGist] = useState<PublicGistPayload | null>(null);

  useEffect(() => {
    const match = GIST_ROUTE_RE.exec(pathname);
    if (!match) {
      return undefined;
    }
    let disposed = false;
    void readSavedGist(match[1], match[2] ? Number(match[2]) : null)
      .then((saved) => {
        if (!disposed) setGist(saved);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [pathname]);

  const file = gist ? orderedGistFiles(gist)[0] : null;
  return (
    <main className="page-shell" aria-busy="true" aria-label="Loading">
      {gist && file ? (
        <>
          <header className="page-header">
            <h1 className="saved-preview-title">{gist.display_title}</h1>
          </header>
          <div className="gist-single-file">
            <article
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: file.rendered_html }}
            />
          </div>
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
