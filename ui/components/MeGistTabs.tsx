"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { MyGistItem } from "../lib/auth";
import {
  readRecentlyViewedGists,
  RECENTLY_VIEWED_STORAGE_KEY,
  type RecentGistItem
} from "../lib/recent-viewed";
import { DeleteGistButton } from "./DeleteGistButton";

const ITEMS_PER_PAGE = 20;

type TabId = "recent" | "mine";

type MeGistTabsProps = {
  myGists: MyGistItem[];
  isAuthenticated: boolean;
};

type ListItem = {
  id: string;
  url: string;
  revisionUrl?: string | null;
  title: string | null;
  displayTitle?: string | null;
  authorName: string;
  revisionNumber: number;
  dateTime: string;
  dateLabel: "viewed" | "updated";
  action?: ReactNode;
};

function displayTitle(
  preferredTitle: string | null | undefined,
  title: string | null,
  id: string
) {
  const trimmedPreferred = preferredTitle?.trim();
  if (trimmedPreferred) {
    return trimmedPreferred;
  }
  const trimmed = title?.trim();
  if (trimmed) {
    return trimmed;
  }
  return id;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function revisionUrl(baseUrl: string, revisionNumber: number) {
  return `${baseUrl.replace(/\/$/, "")}/revisions/${revisionNumber}`;
}

function myGistToListItem(gist: MyGistItem): ListItem {
  const title = displayTitle(gist.display_title, gist.title, gist.id);
  return {
    id: gist.id,
    url: gist.url,
    revisionUrl: revisionUrl(gist.url, gist.revision_number),
    title: gist.title,
    displayTitle: gist.display_title,
    authorName: gist.author_name,
    revisionNumber: gist.revision_number,
    dateTime: gist.updated_at,
    dateLabel: "updated",
    action: <DeleteGistButton gistId={gist.id} gistTitle={title} />
  };
}

function recentGistToListItem(gist: RecentGistItem): ListItem {
  return {
    id: gist.id,
    url: `/${gist.id}`,
    revisionUrl: `/${gist.id}/revisions/${gist.revision_number}`,
    title: gist.title,
    authorName: gist.author_name,
    revisionNumber: gist.revision_number,
    dateTime: gist.viewed_at,
    dateLabel: "viewed"
  };
}

function getPageCount(items: ListItem[]) {
  return Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
}

function GistList({
  items,
  emptyState,
  page,
  onPageChange
}: {
  items: ListItem[];
  emptyState: ReactNode;
  page: number;
  onPageChange: (page: number) => void;
}) {
  if (items.length === 0) {
    return <div className="empty-list">{emptyState}</div>;
  }

  const pageCount = getPageCount(items);
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(
    currentPage * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE + ITEMS_PER_PAGE
  );
  const hasPreviousPage = currentPage > 0;
  const hasNextPage = currentPage < pageCount - 1;

  return (
    <>
      <ul className="gist-list">
        {pageItems.map((item) => {
          const title = displayTitle(item.displayTitle, item.title, item.id);
          return (
            <li className="gist-list-item" key={item.id}>
              <div className="gist-list-row">
                <div className="gist-list-content">
                  <a className="gist-list-title-link" href={item.url}>
                    <span className="gist-list-title">{title}</span>
                  </a>
                  <span className="gist-list-meta">
                    {item.authorName} -{" "}
                    {item.revisionUrl ? (
                      <a
                        className="gist-list-meta-link"
                        href={item.revisionUrl}
                      >
                        revision {item.revisionNumber}
                      </a>
                    ) : (
                      <>revision {item.revisionNumber}</>
                    )}{" "}
                    -{" "}
                    {item.dateLabel}{" "}
                    <time dateTime={item.dateTime}>
                      {formatTimestamp(item.dateTime)}
                    </time>
                  </span>
                </div>
                {item.action ? (
                  <div className="gist-list-action">{item.action}</div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="gist-pagination" aria-label="Pagination">
        <button
          type="button"
          className="gist-pagination-button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!hasPreviousPage}
        >
          Prev
        </button>
        <span className="gist-pagination-status">
          Page {currentPage + 1} of {pageCount}
        </span>
        <button
          type="button"
          className="gist-pagination-button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!hasNextPage}
        >
          Next
        </button>
      </div>
    </>
  );
}

export function MeGistTabs({
  myGists,
  isAuthenticated
}: MeGistTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("recent");
  const [recentGists, setRecentGists] = useState<RecentGistItem[] | null>(null);
  const [pages, setPages] = useState<Record<TabId, number>>({
    recent: 0,
    mine: 0
  });

  useEffect(() => {
    setRecentGists(readRecentlyViewedGists());

    function handleStorage(event: StorageEvent) {
      if (
        event.key === RECENTLY_VIEWED_STORAGE_KEY ||
        event.key === null
      ) {
        setRecentGists(readRecentlyViewedGists());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setActiveTab("recent");
    }
  }, [isAuthenticated]);

  const recentItems = useMemo(
    () => (recentGists ?? []).map(recentGistToListItem),
    [recentGists]
  );
  const myItems = useMemo(
    () => myGists.map(myGistToListItem),
    [myGists]
  );

  const activeItems = activeTab === "recent" ? recentItems : myItems;
  const activePage = Math.min(
    pages[activeTab],
    getPageCount(activeItems) - 1
  );

  function setActivePage(page: number) {
    setPages((current) => ({
      ...current,
      [activeTab]: Math.max(0, Math.min(page, getPageCount(activeItems) - 1))
    }));
  }

  return (
    <section className="me-tabs-section" aria-label="Gists">
      <div className="me-tabs" role="tablist" aria-label="Gist views">
        <button
          type="button"
          className="me-tab-button"
          role="tab"
          aria-selected={activeTab === "recent"}
          onClick={() => setActiveTab("recent")}
        >
          RECENTLY VIEWED
        </button>
        {isAuthenticated ? (
          <>
            <span className="me-tab-separator" aria-hidden="true">
              |
            </span>
            <button
              type="button"
              className="me-tab-button"
              role="tab"
              aria-selected={activeTab === "mine"}
              onClick={() => setActiveTab("mine")}
            >
              MY GISTS
            </button>
          </>
        ) : null}
      </div>

      {activeTab === "recent" ? (
        <GistList
          items={recentItems}
          emptyState={
            recentGists === null ? (
              "Loading recent views."
            ) : (
              "No recently viewed gists."
            )
          }
          page={activePage}
          onPageChange={setActivePage}
        />
      ) : (
        <GistList
          items={myItems}
          emptyState={
            isAuthenticated ? (
              "No gists yet."
            ) : (
              <>
                <a className="inline-link" href="/login">
                  Log in
                </a>{" "}
                to view your gists.
              </>
            )
          }
          page={activePage}
          onPageChange={setActivePage}
        />
      )}
    </section>
  );
}
