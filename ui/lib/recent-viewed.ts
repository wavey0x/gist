export const RECENTLY_VIEWED_STORAGE_KEY =
  "waveygist:recently-viewed:v1";

const MAX_RECENT_GISTS = 100;

export type RecentGistItem = {
  id: string;
  url: string;
  revision_url?: string | null;
  title: string | null;
  author_name: string;
  author_avatar_url?: string;
  revision_number: number;
  viewed_at: string;
};

function isRecentGistItem(value: unknown): value is RecentGistItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<RecentGistItem>;
  return (
    typeof item.id === "string" &&
    typeof item.url === "string" &&
    (item.revision_url === undefined ||
      item.revision_url === null ||
      typeof item.revision_url === "string") &&
    (item.title === null || typeof item.title === "string") &&
    typeof item.author_name === "string" &&
    (item.author_avatar_url === undefined ||
      typeof item.author_avatar_url === "string") &&
    typeof item.revision_number === "number" &&
    Number.isInteger(item.revision_number) &&
    item.revision_number > 0 &&
    typeof item.viewed_at === "string"
  );
}

function sortNewestFirst(items: RecentGistItem[]) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.viewed_at);
    const rightTime = Date.parse(right.viewed_at);
    return (Number.isNaN(rightTime) ? 0 : rightTime) -
      (Number.isNaN(leftTime) ? 0 : leftTime);
  });
}

export function readRecentlyViewedGists() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return sortNewestFirst(parsed.filter(isRecentGistItem)).slice(
      0,
      MAX_RECENT_GISTS
    );
  } catch {
    return [];
  }
}

export function recordRecentlyViewedGist(item: RecentGistItem) {
  if (typeof window === "undefined") {
    return;
  }

  const next = [
    item,
    ...readRecentlyViewedGists().filter((recent) => recent.id !== item.id)
  ].slice(0, MAX_RECENT_GISTS);

  try {
    window.localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(next)
    );
  } catch {
    // Browsers can reject localStorage writes; recent views are best effort.
  }
}
