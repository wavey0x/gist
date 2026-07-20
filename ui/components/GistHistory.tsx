"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import type { MyGistItem } from "../lib/auth";
import {
  readRecentlyViewedGists,
  RECENTLY_VIEWED_STORAGE_KEY,
  type RecentGistItem
} from "../lib/recent-viewed";
import { DeleteGistButton } from "./DeleteGistButton";
import { LocalTimestamp } from "./LocalTimestamp";

const ITEMS_PER_PAGE = 20;
const GITHUB_LOGIN_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

type TabId = "recent" | "mine";
type MyGistSort = "updated" | "created";

type GistHistoryTabsProps = {
  myGists: MyGistItem[];
  isAuthenticated: boolean;
};

type OwnedGistListProps = {
  myGists: MyGistItem[];
};

type ListItem = {
  id: string;
  url: string;
  revisionUrl: string;
  title: string | null;
  displayTitle?: string | null;
  authorName: string;
  authorAvatarUrl?: string;
  revisionNumber: number;
  dateTime: string;
  dateLabel: "viewed" | "updated" | "created";
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

function revisionUrl(baseUrl: string, revisionNumber: number) {
  return `${baseUrl.replace(/\/$/, "")}/revisions/${revisionNumber}`;
}

function fallbackAuthorAvatarUrl(authorName: string) {
  return GITHUB_LOGIN_RE.test(authorName)
    ? `https://github.com/${authorName}.png?size=40`
    : null;
}

function authorAvatarInitial(authorName: string) {
  return authorName.trim().charAt(0).toUpperCase() || "?";
}

function GistListAuthor({
  authorName,
  authorAvatarUrl
}: {
  authorName: string;
  authorAvatarUrl?: string;
}) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const avatarUrl = authorAvatarUrl ?? fallbackAuthorAvatarUrl(authorName);
  const visibleAvatarUrl =
    avatarUrl && avatarUrl !== failedAvatarUrl ? avatarUrl : null;

  return (
    <span className="gist-list-author">
      {visibleAvatarUrl ? (
        <img
          className="gist-list-avatar"
          src={visibleAvatarUrl}
          alt=""
          width={16}
          height={16}
          loading="lazy"
          onError={() => setFailedAvatarUrl(visibleAvatarUrl)}
        />
      ) : (
        <span
          className="gist-list-avatar gist-list-avatar-placeholder"
          aria-hidden="true"
        >
          {authorAvatarInitial(authorName)}
        </span>
      )}
      <span className="gist-list-author-name">{authorName}</span>
    </span>
  );
}

function myGistToListItem(gist: MyGistItem, sort: MyGistSort): ListItem {
  const title = displayTitle(gist.display_title, gist.title, gist.id);
  return {
    id: gist.id,
    url: gist.url,
    revisionUrl: revisionUrl(gist.url, gist.revision_number),
    title: gist.title,
    displayTitle: gist.display_title,
    authorName: gist.author_name,
    authorAvatarUrl: gist.author_avatar_url,
    revisionNumber: gist.revision_number,
    dateTime: sort === "created" ? gist.created_at : gist.updated_at,
    dateLabel: sort,
    action: <DeleteGistButton gistId={gist.id} gistTitle={title} />
  };
}

function timestampValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortMyGists(gists: MyGistItem[], sort: MyGistSort) {
  const field = sort === "created" ? "created_at" : "updated_at";
  return [...gists].sort((left, right) => {
    const dateOrder =
      timestampValue(right[field]) - timestampValue(left[field]);
    return dateOrder || right.id.localeCompare(left.id);
  });
}

function recentGistToListItem(gist: RecentGistItem): ListItem {
  return {
    id: gist.id,
    url: `/${gist.id}`,
    revisionUrl: `/${gist.id}/revisions/${gist.revision_number}`,
    title: gist.title,
    authorName: gist.author_name,
    authorAvatarUrl: gist.author_avatar_url,
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
                    <GistListAuthor
                      authorName={item.authorName}
                      authorAvatarUrl={item.authorAvatarUrl}
                    /> -{" "}
                    <a
                      className="gist-list-meta-link"
                      href={item.revisionUrl}
                    >
                      revision {item.revisionNumber}
                    </a>{" "}
                    -{" "}
                    {item.dateLabel}{" "}
                    <LocalTimestamp value={item.dateTime} variant="compact" />
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

export function GistHistoryTabs({
  myGists,
  isAuthenticated
}: GistHistoryTabsProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [activeTab, setActiveTab] = useState<TabId>("recent");
  const [myGistSort, setMyGistSort] = useState<MyGistSort>("updated");
  const [recentGists, setRecentGists] = useState<RecentGistItem[] | null>(null);
  const [pages, setPages] = useState<Record<TabId, number>>({
    recent: 0,
    mine: 0
  });

  const refreshGists = useCallback(() => {
    setRecentGists(readRecentlyViewedGists());
    startRefresh(() => {
      router.refresh();
    });
  }, [router]);

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

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshGists();
      }
    }

    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshGists]);

  const recentItems = useMemo(
    () => (recentGists ?? []).map(recentGistToListItem),
    [recentGists]
  );
  const myItems = useMemo(
    () => sortMyGists(myGists, myGistSort).map((gist) =>
      myGistToListItem(gist, myGistSort)
    ),
    [myGists, myGistSort]
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

  function selectMyGistSort(sort: MyGistSort) {
    setMyGistSort(sort);
    setPages((current) => ({ ...current, mine: 0 }));
  }

  function selectTabFromKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    nextTab: TabId
  ) {
    event.preventDefault();
    setActiveTab(nextTab);
    document.getElementById(`gist-${nextTab}-tab`)?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      selectTabFromKeyboard(
        event,
        activeTab === "recent" ? "mine" : "recent"
      );
    } else if (event.key === "Home") {
      selectTabFromKeyboard(event, "recent");
    } else if (event.key === "End") {
      selectTabFromKeyboard(event, "mine");
    }
  }

  return (
    <section className="me-tabs-section" aria-label="Gists">
      <div className="me-tabs-header">
        {activeTab === "mine" && myGists.length > 1 ? (
          <div
            className="gist-sort-control"
            role="group"
            aria-label="Sort my gists"
          >
            <button
              type="button"
              className="gist-sort-button"
              aria-pressed={myGistSort === "updated"}
              onClick={() => selectMyGistSort("updated")}
            >
              UPDATED
            </button>
            <span className="gist-sort-separator" aria-hidden="true">
              |
            </span>
            <button
              type="button"
              className="gist-sort-button"
              aria-pressed={myGistSort === "created"}
              onClick={() => selectMyGistSort("created")}
            >
              CREATED
            </button>
          </div>
        ) : null}
        <div className="me-tabs" role="tablist" aria-label="Gist views">
          <button
            id="gist-recent-tab"
            type="button"
            className="me-tab-button"
            role="tab"
            aria-selected={activeTab === "recent"}
            aria-controls="gist-recent-panel"
            tabIndex={activeTab === "recent" ? 0 : -1}
            onClick={() => setActiveTab("recent")}
            onKeyDown={handleTabKeyDown}
          >
            RECENTLY VIEWED
          </button>
          <span className="me-tab-separator" aria-hidden="true">
            |
          </span>
          <button
            id="gist-mine-tab"
            type="button"
            className="me-tab-button"
            role="tab"
            aria-selected={activeTab === "mine"}
            aria-controls="gist-mine-panel"
            tabIndex={activeTab === "mine" ? 0 : -1}
            onClick={() => setActiveTab("mine")}
            onKeyDown={handleTabKeyDown}
          >
            MY GISTS
          </button>
        </div>
        <button
          type="button"
          className="icon-button gist-refresh-button"
          aria-label={isRefreshing ? "Refreshing gists" : "Refresh gists"}
          aria-busy={isRefreshing}
          title="Refresh"
          disabled={isRefreshing}
          onClick={refreshGists}
        >
          <RefreshCw aria-hidden="true" size={15} strokeWidth={1.9} />
        </button>
      </div>

      {activeTab === "recent" ? (
        <div
          id="gist-recent-panel"
          role="tabpanel"
          aria-labelledby="gist-recent-tab"
        >
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
        </div>
      ) : (
        <div
          id="gist-mine-panel"
          role="tabpanel"
          aria-labelledby="gist-mine-tab"
        >
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
        </div>
      )}
    </section>
  );
}

export function OwnedGistList({ myGists }: OwnedGistListProps) {
  const [page, setPage] = useState(0);
  const items = useMemo(
    () => myGists.map((gist) => myGistToListItem(gist, "updated")),
    [myGists]
  );

  return (
    <GistList
      items={items}
      emptyState="No gists yet."
      page={page}
      onPageChange={setPage}
    />
  );
}
