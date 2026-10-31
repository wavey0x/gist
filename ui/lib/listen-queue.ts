"use client";

import { useSyncExternalStore } from "react";

// The listening queue is a list of gists, not revisions. The server resolves
// each entry to the newest revision with ready audio, so older recordings are
// always superseded by newer ones.
export type QueueStatus = "ready" | "pending" | "none";

export type QueueItem = {
  gist_id: string;
  title: string;
  author_name: string;
  author_avatar_url?: string;
  latest_revision_number: number;
  status: QueueStatus;
  revision_number: number | null;
  duration_ms: number | null;
  audio_url: string | null;
  updating: boolean;
  added_at: string;
};

export type QueueHint = {
  title: string;
  author_name: string;
  revision_number: number;
  audio_url: string;
};

export type ListenQueueState = {
  items: QueueItem[];
  loaded: boolean;
  available: boolean;
};

const STORAGE_KEY = "waveygist:listen-queue:v1";
const DIRTY_KEY = "waveygist:listen-queue-dirty:v1";
const ENDPOINT = "/api/me/listen-queue";

const SERVER_STATE: ListenQueueState = { items: [], loaded: false, available: false };

let state: ListenQueueState = SERVER_STATE;
let hydrated = false;
let version = 0;
let writeChain: Promise<void> = Promise.resolve();
let refreshing: Promise<void> | null = null;
const listeners = new Set<() => void>();

function isQueueItem(value: unknown): value is QueueItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<QueueItem>;
  return (
    typeof item.gist_id === "string" &&
    typeof item.title === "string" &&
    typeof item.author_name === "string" &&
    typeof item.latest_revision_number === "number" &&
    (item.status === "ready" || item.status === "pending" || item.status === "none") &&
    (item.revision_number === null || typeof item.revision_number === "number") &&
    (item.duration_ms === null || typeof item.duration_ms === "number") &&
    (item.audio_url === null || typeof item.audio_url === "string") &&
    typeof item.updating === "boolean" &&
    typeof item.added_at === "string"
  );
}

function parseItems(value: unknown) {
  const items = (value as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items.filter(isQueueItem) : null;
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setState(next: Partial<ListenQueueState>) {
  state = { ...state, ...next };
  if (next.items) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items }));
    } catch {
      // The cached copy only speeds up the first paint and offline use.
    }
  }
  emit();
}

function markDirty(dirty: boolean) {
  try {
    if (dirty) {
      window.localStorage.setItem(DIRTY_KEY, "1");
    } else {
      window.localStorage.removeItem(DIRTY_KEY);
    }
  } catch {
    // Best effort.
  }
}

function isDirty() {
  try {
    return window.localStorage.getItem(DIRTY_KEY) === "1";
  } catch {
    return false;
  }
}

function hydrateFromCache() {
  if (hydrated || typeof window === "undefined") {
    return;
  }
  hydrated = true;
  try {
    const items = parseItems(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
    if (items) {
      state = { items, loaded: false, available: true };
    }
  } catch {
    // Ignore a corrupt cache; the server copy replaces it.
  }
}

export function subscribeListenQueue(listener: () => void) {
  hydrateFromCache();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getListenQueue() {
  hydrateFromCache();
  return state;
}

export function useListenQueue() {
  return useSyncExternalStore(subscribeListenQueue, getListenQueue, () => SERVER_STATE);
}

function handleUnavailable(status: number) {
  if (status === 401 || status === 403) {
    setState({ items: [], loaded: true, available: false });
    markDirty(false);
    return true;
  }
  return false;
}

async function putOrder(gistIds: string[], startedAt: number) {
  try {
    const response = await fetch(ENDPOINT, {
      method: "PUT",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ gist_ids: gistIds })
    });
    if (handleUnavailable(response.status)) {
      return;
    }
    if (!response.ok) {
      throw new Error(`Queue update failed: ${response.status}`);
    }
    const items = parseItems(await response.json());
    if (version === startedAt) {
      markDirty(false);
      if (items) {
        setState({ items, loaded: true, available: true });
      }
    }
  } catch {
    // Offline or failing: keep the local order and send it on the next refresh.
    markDirty(true);
  }
}

function commit(items: QueueItem[]) {
  version += 1;
  const startedAt = version;
  setState({ items, available: true });
  markDirty(true);
  const gistIds = items.map((item) => item.gist_id);
  writeChain = writeChain.then(() => putOrder(gistIds, startedAt));
  return writeChain;
}

export function refreshListenQueue() {
  hydrateFromCache();
  if (refreshing) {
    return refreshing;
  }
  refreshing = (async () => {
    await writeChain;
    if (isDirty() && state.available) {
      await commit(state.items);
      return;
    }
    const startedAt = version;
    try {
      const response = await fetch(ENDPOINT, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (handleUnavailable(response.status)) {
        return;
      }
      if (!response.ok) {
        throw new Error(`Queue read failed: ${response.status}`);
      }
      const items = parseItems(await response.json());
      if (items && version === startedAt) {
        setState({ items, loaded: true, available: true });
      }
    } catch {
      setState({ loaded: true });
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function placeholder(gistId: string, hint: QueueHint): QueueItem {
  return {
    gist_id: gistId,
    title: hint.title,
    author_name: hint.author_name,
    latest_revision_number: hint.revision_number,
    status: "ready",
    revision_number: hint.revision_number,
    duration_ms: null,
    audio_url: hint.audio_url,
    updating: false,
    added_at: new Date().toISOString()
  };
}

export function isQueued(gistId: string) {
  return getListenQueue().items.some((item) => item.gist_id === gistId);
}

export function addToQueue(gistId: string, hint: QueueHint) {
  const { items } = getListenQueue();
  if (items.some((item) => item.gist_id === gistId)) {
    return;
  }
  void commit([...items, placeholder(gistId, hint)]);
}

// Playing something makes it the head of the queue.
export function moveToFront(gistId: string, hint: QueueHint) {
  const { items } = getListenQueue();
  if (items[0]?.gist_id === gistId) {
    return;
  }
  const existing = items.find((item) => item.gist_id === gistId);
  void commit([
    existing ?? placeholder(gistId, hint),
    ...items.filter((item) => item.gist_id !== gistId)
  ]);
}

export function removeFromQueue(gistId: string) {
  const { items } = getListenQueue();
  if (!items.some((item) => item.gist_id === gistId)) {
    return;
  }
  void commit(items.filter((item) => item.gist_id !== gistId));
}

export function restoreQueueItem(item: QueueItem, index: number) {
  const items = getListenQueue().items.filter((queued) => queued.gist_id !== item.gist_id);
  const next = [...items];
  next.splice(Math.min(Math.max(0, index), next.length), 0, item);
  void commit(next);
}

export function moveQueueItem(gistId: string, toIndex: number) {
  const { items } = getListenQueue();
  const fromIndex = items.findIndex((item) => item.gist_id === gistId);
  if (fromIndex < 0 || fromIndex === toIndex) {
    return;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(Math.min(Math.max(0, toIndex), next.length), 0, moved);
  void commit(next);
}

// The next playable recording after the one that is playing now.
export function nextQueueItem(currentGistId: string | null) {
  return (
    getListenQueue().items.find(
      (item) => item.status === "ready" && item.audio_url && item.gist_id !== currentGistId
    ) ?? null
  );
}

export function countUpNext(items: QueueItem[], currentGistId: string | null) {
  return items.filter(
    (item) => item.status === "ready" && item.gist_id !== currentGistId
  ).length;
}
