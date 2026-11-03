"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Trash2, X } from "lucide-react";
import {
  normalizeMyGistsPayload,
  type MyGistItem,
  type MyGistsPayload
} from "../lib/my-gists";
import { fullTimestamp, rowTime, validTimeZone } from "../lib/date-groups";
import { readReadingPosition } from "../lib/reading-position";
import {
  readRecentlyViewedGists,
  removeRecentlyViewedGist,
  RECENTLY_VIEWED_STORAGE_KEY,
  type RecentGistItem
} from "../lib/recent-viewed";
import { ConfirmModal } from "./ConfirmModal";
import { SwipeRow } from "./SwipeRow";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;
// Shared with the offline shell, which still reads "recent" | "mine".
const ACTIVE_TAB_STORAGE_KEY = "waveygist:home-tab:v1";
const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

type TabId = "mine" | "recent";
type MineSort = "updated" | "created";

type LibraryProps = {
  initialMyGists: MyGistsPayload | null;
  isAuthenticated: boolean;
  userName?: string | null;
  // Rendered on the server with the visitor's saved time zone and the
  // server's clock, so the first client render matches it exactly.
  timeZone: string;
  serverNow: number;
};

function readStoredTab(): TabId {
  try {
    return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) === "recent"
      ? "recent"
      : "mine";
  } catch {
    return "mine";
  }
}

function saveTab(tab: TabId) {
  try {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // Best effort preference.
  }
}

function normalizeQuery(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function titleOf(preferred: string | null | undefined, title: string | null, id: string) {
  return preferred?.trim() || title?.trim() || id;
}

function Avatar({ name, url }: { name: string; url?: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  const source =
    url ?? (GITHUB_LOGIN_RE.test(name) ? `https://github.com/${name}.png?size=32` : null);
  return (
    <span className="library-avatar" aria-hidden="true">
      {state !== "loaded" ? (name.trim().charAt(0).toUpperCase() || "?") : null}
      {source && state !== "failed" ? (
        <img
          src={source}
          alt=""
          width={14}
          height={14}
          loading="lazy"
          data-loaded={state === "loaded"}
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
        />
      ) : null}
    </span>
  );
}

type RowData = {
  key: string;
  href: string;
  title: string;
  revision: number;
  date: string;
  byline?: { name: string; avatarUrl?: string };
  updated?: boolean;
  progress?: number;
  actionLabel: string;
  actionIcon: ReactNode;
  onAction: () => void;
};

function LibraryRow({ row, time, timestamp }: { row: RowData; time: string; timestamp: string }) {
  return (
    <li className="library-item">
      <SwipeRow actionLabel={row.actionLabel} onAction={row.onAction}>
        <div className="library-row">
          <Link className="library-link" href={row.href} prefetch={false}>
            {row.updated ? (
              <span
                className="library-dot"
                role="img"
                aria-label="Updated since you read it"
                title="Updated since you read it"
              />
            ) : null}
            <span className="library-title">{row.title}</span>
            <span className="library-aside">
              <time dateTime={row.date} title={timestamp}>
                {time}
              </time>
              {row.revision > 1 ? (
                <span className="library-revision" aria-label={`revision ${row.revision}`}>
                  r{row.revision}
                </span>
              ) : null}
            </span>
            {row.byline ? (
              <span className="library-byline">
                <Avatar name={row.byline.name} url={row.byline.avatarUrl} />
                {row.byline.name}
              </span>
            ) : null}
          </Link>
          <button
            type="button"
            className="library-row-action"
            aria-label={`${row.actionLabel} ${row.title}`}
            title={row.actionLabel}
            onClick={row.onAction}
            data-no-swipe
          >
            {row.actionIcon}
          </button>
        </div>
        {row.progress ? (
          <span
            className="library-progress"
            style={{ width: `${Math.min(100, row.progress * 100)}%` }}
          />
        ) : null}
      </SwipeRow>
    </li>
  );
}

function RowList({ rows, now, timeZone }: { rows: RowData[]; now: number; timeZone: string }) {
  return (
    <ul className="library-list">
      {rows.map((row) => (
        <LibraryRow
          key={row.key}
          row={row}
          time={rowTime(row.date, now, timeZone)}
          timestamp={fullTimestamp(row.date, timeZone)}
        />
      ))}
    </ul>
  );
}

export function Library({
  initialMyGists,
  isAuthenticated,
  userName,
  timeZone: initialTimeZone,
  serverNow
}: LibraryProps) {
  const [clock, setClock] = useState({ now: serverNow, timeZone: initialTimeZone });
  const router = useRouter();
  const [tab, setTab] = useState<TabId>(isAuthenticated ? "mine" : "recent");
  const [sort, setSort] = useState<MineSort>("updated");
  const [recent, setRecent] = useState<RecentGistItem[] | null>(null);
  const [recentCount, setRecentCount] = useState(PAGE_SIZE);
  const [mine, setMine] = useState<MyGistItem[]>(initialMyGists?.gists ?? []);
  const [mineTotal, setMineTotal] = useState(initialMyGists?.pagination.total ?? 0);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineError, setMineError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const firstLoad = useRef(true);
  const showTabs = isAuthenticated;
  const activeTab: TabId = isAuthenticated ? tab : "recent";

  const refresh = useCallback(() => {
    setRecent(readRecentlyViewedGists());
    setClock((current) => ({ ...current, now: Date.now() }));
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      setTab(readStoredTab());
    }
    setRecent(readRecentlyViewedGists());
    setClock({
      now: Date.now(),
      timeZone:
        validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? initialTimeZone
    });
    function handleStorage(event: StorageEvent) {
      if (event.key === RECENTLY_VIEWED_STORAGE_KEY || event.key === null) {
        setRecent(readRecentlyViewedGists());
      }
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isAuthenticated, refresh]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setQuery(normalizeQuery(searchInput));
      setRecentCount(PAGE_SIZE);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus();
    }
  }, [searchOpen]);

  const loadMine = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      const parameters = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: query ? "relevance" : sort
      });
      if (query) {
        parameters.set("q", query);
      }
      setMineLoading(true);
      setMineError(false);
      try {
        const response = await fetch(`/api/me/gists?${parameters}`, {
          cache: "no-store",
          signal
        });
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!response.ok) {
          throw new Error(`Failed to load gists: ${response.status}`);
        }
        const payload = normalizeMyGistsPayload(await response.json());
        setMine((current) => (offset === 0 ? payload.gists : [...current, ...payload.gists]));
        setMineTotal(payload.pagination.total);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMineError(true);
        }
      } finally {
        if (!signal?.aborted) {
          setMineLoading(false);
        }
      }
    },
    [query, sort]
  );

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    // The server already rendered the first page with the default view.
    if (firstLoad.current && !query && sort === "updated" && reloadToken === 0) {
      firstLoad.current = false;
      return;
    }
    firstLoad.current = false;
    const controller = new AbortController();
    void loadMine(0, controller.signal);
    return () => controller.abort();
  }, [isAuthenticated, loadMine, query, reloadToken, sort]);

  const latestOwnRevision = useMemo(() => {
    const map = new Map<string, number>();
    for (const gist of mine) {
      map.set(gist.id, gist.revision_number);
    }
    return map;
  }, [mine]);
  const lastReadRevision = useMemo(() => {
    const map = new Map<string, number>();
    for (const gist of recent ?? []) {
      map.set(gist.id, gist.revision_number);
    }
    return map;
  }, [recent]);

  const filteredRecent = useMemo(() => {
    const items = recent ?? [];
    if (!query) {
      return items;
    }
    const needle = query.toLowerCase();
    return items.filter((gist) =>
      `${gist.title ?? ""} ${gist.author_name} ${gist.id}`.toLowerCase().includes(needle)
    );
  }, [query, recent]);

  function selectTab(next: TabId) {
    setTab(next);
    saveTab(next);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = activeTab === "mine" ? "recent" : "mine";
      selectTab(next);
      document.getElementById(`library-tab-${next}`)?.focus();
    }
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchInput("");
    setQuery("");
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(
        `/api/me/gists/${encodeURIComponent(pendingDelete.id)}`,
        { method: "DELETE" }
      );
      if (response.status === 204) {
        setMine((current) => current.filter((gist) => gist.id !== pendingDelete.id));
        setMineTotal((total) => Math.max(0, total - 1));
        setPendingDelete(null);
        router.refresh();
        return;
      }
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      setDeleteError(
        response.status === 404
          ? "This gist could not be deleted."
          : "Delete is unavailable right now."
      );
    } catch {
      setDeleteError("Delete is unavailable right now.");
    } finally {
      setDeleting(false);
    }
  }

  let list: ReactNode;
  let more: ReactNode = null;
  if (activeTab === "mine") {
    if (!mine.length) {
      list = (
        <p className="library-empty">
          {mineError
            ? "Your gists could not be loaded."
            : mineLoading
              ? "Loading…"
              : query
                ? "No gists match."
                : "No gists yet."}
        </p>
      );
    } else {
      const byCreated = sort === "created" && !query;
      list = (
        <RowList
          now={clock.now}
          timeZone={clock.timeZone}
          rows={mine.map((gist) => {
            const title = titleOf(gist.display_title, gist.title, gist.id);
            const read = lastReadRevision.get(gist.id);
            return {
              key: gist.id,
              href: `/${gist.id}`,
              title,
              revision: gist.revision_number,
              date: byCreated ? gist.created_at : gist.updated_at,
              updated: read !== undefined && gist.revision_number > read,
              actionLabel: "Delete",
              actionIcon: <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />,
              onAction: () => {
                setDeleteError(null);
                setPendingDelete({ id: gist.id, title });
              }
            };
          })}
        />
      );
      if (mine.length < mineTotal) {
        more = (
          <button
            type="button"
            className="home-more-button"
            disabled={mineLoading}
            onClick={() => void loadMine(mine.length)}
          >
            {mineLoading ? "Loading…" : "Show more"}
          </button>
        );
      }
    }
  } else if (recent === null) {
    list = null;
  } else if (!filteredRecent.length) {
    list = (
      <p className="library-empty">
        {query ? "Nothing you've read matches." : "Gists you open will show up here."}
      </p>
    );
  } else {
    const me = userName?.trim().toLowerCase();
    list = (
      <RowList
        now={clock.now}
        timeZone={clock.timeZone}
        rows={filteredRecent.slice(0, recentCount).map((gist) => {
          const latest = latestOwnRevision.get(gist.id);
          return {
            key: gist.id,
            href: `/${gist.id}`,
            title: gist.title?.trim() || gist.id,
            revision: gist.revision_number,
            date: gist.viewed_at,
            byline:
              gist.author_name.trim().toLowerCase() === me
                ? undefined
                : { name: gist.author_name, avatarUrl: gist.author_avatar_url },
            updated: latest !== undefined && latest > gist.revision_number,
            progress: readReadingPosition(gist.id, gist.revision_number)?.fraction,
            actionLabel: "Remove",
            actionIcon: <X aria-hidden="true" size={15} strokeWidth={1.8} />,
            onAction: () => {
              removeRecentlyViewedGist(gist.id);
              setRecent(readRecentlyViewedGists());
            }
          };
        })}
      />
    );
    if (filteredRecent.length > recentCount) {
      more = (
        <button
          type="button"
          className="home-more-button"
          onClick={() => setRecentCount((count) => count + PAGE_SIZE)}
        >
          Show more
        </button>
      );
    }
  }

  return (
    <section className="library" aria-label="Library">
      <div className="library-bar">
        {showTabs ? (
          <div className="library-tabs" role="tablist" aria-label="Library">
            {(["mine", "recent"] as const).map((id) => (
              <button
                key={id}
                id={`library-tab-${id}`}
                type="button"
                role="tab"
                className="library-tab"
                aria-selected={activeTab === id}
                aria-controls="library-panel"
                tabIndex={activeTab === id ? 0 : -1}
                onClick={() => selectTab(id)}
                onKeyDown={onTabKeyDown}
              >
                {id === "mine" ? "My gists" : "Recently viewed"}
              </button>
            ))}
          </div>
        ) : (
          <span className="library-bar-label">Recently viewed</span>
        )}
        <button
          type="button"
          className="library-search-toggle"
          aria-label={searchOpen ? "Close search" : "Search"}
          aria-expanded={searchOpen}
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        >
          {searchOpen ? (
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          ) : (
            <Search aria-hidden="true" size={17} strokeWidth={1.8} />
          )}
        </button>
      </div>

      {searchOpen ? (
        <div className="library-search">
          <input
            ref={searchRef}
            className="library-search-input"
            type="search"
            value={searchInput}
            placeholder={activeTab === "mine" ? "Search my gists" : "Search recently viewed"}
            aria-label={activeTab === "mine" ? "Search my gists" : "Search recently viewed"}
            autoComplete="off"
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeSearch();
            }}
          />
          {activeTab === "mine" && !query ? (
            <div className="library-sort" role="group" aria-label="Sort">
              {(["updated", "created"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="library-sort-button"
                  aria-pressed={sort === value}
                  onClick={() => setSort(value)}
                >
                  {value === "updated" ? "Updated" : "Created"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        id="library-panel"
        role={showTabs ? "tabpanel" : undefined}
        aria-labelledby={showTabs ? `library-tab-${activeTab}` : undefined}
      >
        {list}
        {more}
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        title="Delete gist?"
        confirmLabel="Delete"
        confirmingLabel="Deleting..."
        confirming={deleting}
        confirmTone="danger"
        error={deleteError}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
        onConfirm={() => void confirmDelete()}
      >
        <p>Delete &quot;{pendingDelete?.title}&quot;?</p>
      </ConfirmModal>
    </section>
  );
}
