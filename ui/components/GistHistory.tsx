"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  normalizeMyGistsPayload,
  type MyGistItem,
  type MyGistsPayload
} from "../lib/my-gists";
import {
  readRecentlyViewedGists,
  RECENTLY_VIEWED_STORAGE_KEY,
  type RecentGistItem
} from "../lib/recent-viewed";
import { DeleteGistButton } from "./DeleteGistButton";
import { LocalTimestamp } from "./LocalTimestamp";

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 250;
const ACTIVE_TAB_STORAGE_KEY = "waveygist:home-tab:v1";
const GITHUB_LOGIN_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

type TabId = "recent" | "mine";
type MyGistDateSort = "updated" | "created";

type GistHistoryTabsProps = {
  initialMyGists: MyGistsPayload | null;
  isAuthenticated: boolean;
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

function readActiveTab(): TabId {
  if (typeof window === "undefined") {
    return "recent";
  }
  try {
    return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) === "mine"
      ? "mine"
      : "recent";
  } catch {
    return "recent";
  }
}

function saveActiveTab(tab: TabId) {
  try {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // Browsers can reject localStorage writes; this preference is best effort.
  }
}

function normalizeSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

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

function myGistToListItem(
  gist: MyGistItem,
  sort: MyGistDateSort,
  onDeleted: () => void
): ListItem {
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
    action: (
      <DeleteGistButton
        gistId={gist.id}
        gistTitle={title}
        onDeleted={onDeleted}
      />
    )
  };
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

function getPageCount(total: number) {
  return Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
}

function GistList({
  items,
  emptyState,
  page,
  totalItems = items.length,
  serverPaginated = false,
  onPageChange
}: {
  items: ListItem[];
  emptyState: ReactNode;
  page: number;
  totalItems?: number;
  serverPaginated?: boolean;
  onPageChange: (page: number) => void;
}) {
  if (items.length === 0) {
    return <div className="empty-list">{emptyState}</div>;
  }

  const pageCount = getPageCount(totalItems);
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = serverPaginated
    ? items
    : items.slice(
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
                    />{" "}
                    -{" "}
                    <a
                      className="gist-list-meta-link"
                      href={item.revisionUrl}
                    >
                      revision {item.revisionNumber}
                    </a>{" "}
                    - {item.dateLabel}{" "}
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
  initialMyGists,
  isAuthenticated
}: GistHistoryTabsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("recent");
  const [myGistSort, setMyGistSort] =
    useState<MyGistDateSort>("updated");
  const [recentGists, setRecentGists] = useState<RecentGistItem[] | null>(null);
  const [recentPage, setRecentPage] = useState(0);
  const [myPage, setMyPage] = useState(0);
  const [myGists, setMyGists] = useState<MyGistsPayload | null>(
    initialMyGists
  );
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchError, setSearchError] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const refreshGists = useCallback(() => {
    setRecentGists(readRecentlyViewedGists());
    setReloadToken((current) => current + 1);
    router.refresh();
  }, [router]);

  useEffect(() => {
    setActiveTab(readActiveTab());
    setRecentGists(readRecentlyViewedGists());

    function handleStorage(event: StorageEvent) {
      if (
        event.key === RECENTLY_VIEWED_STORAGE_KEY ||
        event.key === null
      ) {
        setRecentGists(readRecentlyViewedGists());
      }
      if (event.key === ACTIVE_TAB_STORAGE_KEY || event.key === null) {
        setActiveTab(readActiveTab());
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

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const normalized = normalizeSearchQuery(searchInput);
      setSearchQuery(normalized);
      setMyPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const controller = new AbortController();
    const parameters = new URLSearchParams({
      limit: String(ITEMS_PER_PAGE),
      offset: String(myPage * ITEMS_PER_PAGE),
      sort: searchQuery ? "relevance" : myGistSort
    });
    if (searchQuery) {
      parameters.set("q", searchQuery);
    }

    async function loadMyGists() {
      setSearchLoading(true);
      setSearchError(false);
      try {
        const response = await fetch(`/api/me/gists?${parameters}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!response.ok) {
          throw new Error(`Failed to load gists: ${response.status}`);
        }
        const payload = normalizeMyGistsPayload(await response.json());
        if (
          payload.pagination.total > 0 &&
          payload.gists.length === 0 &&
          myPage > 0
        ) {
          setMyPage(
            Math.max(0, getPageCount(payload.pagination.total) - 1)
          );
          return;
        }
        setMyGists(payload);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSearchError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearchLoading(false);
        }
      }
    }

    void loadMyGists();
    return () => controller.abort();
  }, [
    isAuthenticated,
    myGistSort,
    myPage,
    reloadToken,
    searchQuery
  ]);

  const recentItems = useMemo(
    () => (recentGists ?? []).map(recentGistToListItem),
    [recentGists]
  );
  const handleGistDeleted = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);
  const myDateSort: MyGistDateSort =
    searchQuery || myGistSort === "updated" ? "updated" : "created";
  const myItems = useMemo(
    () =>
      (myGists?.gists ?? []).map((gist) =>
        myGistToListItem(gist, myDateSort, handleGistDeleted)
      ),
    [handleGistDeleted, myDateSort, myGists]
  );

  function selectMyGistSort(sort: MyGistDateSort) {
    setMyGistSort(sort);
    setMyPage(0);
  }

  function selectTab(tab: TabId) {
    setActiveTab(tab);
    saveActiveTab(tab);
  }

  function selectTabFromKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    nextTab: TabId
  ) {
    event.preventDefault();
    selectTab(nextTab);
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

  const hasOwnedGists = (myGists?.stats.gist_count ?? 0) > 0;
  const myTotal = myGists?.pagination.total ?? 0;
  const normalizedSearchInput = normalizeSearchQuery(searchInput);
  const pendingSearch =
    Boolean(normalizedSearchInput || searchQuery) &&
    (searchLoading || normalizedSearchInput !== searchQuery);

  return (
    <section className="me-tabs-section" aria-label="Gists">
      <div className="me-tabs-header">
        {activeTab === "mine" &&
        !searchInput.trim() &&
        (myGists?.stats.gist_count ?? 0) > 1 ? (
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
            onClick={() => selectTab("recent")}
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
            onClick={() => selectTab("mine")}
            onKeyDown={handleTabKeyDown}
          >
            MY GISTS
          </button>
        </div>
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
            page={recentPage}
            onPageChange={setRecentPage}
          />
        </div>
      ) : (
        <div
          id="gist-mine-panel"
          className="gist-mine-panel"
          role="tabpanel"
          aria-labelledby="gist-mine-tab"
          aria-busy={searchLoading}
        >
          {isAuthenticated && hasOwnedGists ? (
            <div className="gist-search">
              <label className="sr-only" htmlFor="gist-search-input">
                Search my gists
              </label>
              <input
                id="gist-search-input"
                className="gist-search-input"
                type="search"
                value={searchInput}
                maxLength={200}
                placeholder="Search my gists"
                autoComplete="off"
                onChange={(event) => setSearchInput(event.target.value)}
              />
              <span className="gist-search-status" aria-live="polite">
                {searchError
                  ? "Search unavailable."
                  : pendingSearch
                    ? "Searching."
                  : searchQuery
                    ? `${myTotal} ${myTotal === 1 ? "result" : "results"}`
                    : ""}
              </span>
            </div>
          ) : null}
          <GistList
            items={myItems}
            emptyState={
              !isAuthenticated ? (
                <>
                  <a className="inline-link" href="/login">
                    Log in
                  </a>{" "}
                  to view your gists.
                </>
              ) : searchLoading ? (
                "Searching."
              ) : searchQuery ? (
                `No gists match “${searchQuery}”.`
              ) : (
                "No gists yet."
              )
            }
            page={myPage}
            totalItems={myTotal}
            serverPaginated
            onPageChange={setMyPage}
          />
        </div>
      )}
    </section>
  );
}
