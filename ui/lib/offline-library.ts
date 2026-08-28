"use client";

import {
  normalizePublicGistPayload,
  validateGistId,
  type PublicGistPayload
} from "./gists";

export const OFFLINE_DB_NAME = "waveygist-offline";
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_CONTENT_CACHE = "waveygist-content-v1";
export const OFFLINE_AUDIO_CACHE = "waveygist-audio-v1";
export const OFFLINE_LIBRARY_EVENT = "waveygist:offline-library-changed";
export const OFFLINE_CONNECTIVITY_EVENT = "waveygist:connectivity-changed";
export const OFFLINE_IDENTITY_STORAGE_KEY = "waveygist:offline-identity:v1";

export const OFFLINE_BYTE_LIMITS = [
  250 * 1024 * 1024,
  500 * 1024 * 1024,
  1024 * 1024 * 1024
] as const;
export const DEFAULT_OFFLINE_BYTE_LIMIT = OFFLINE_BYTE_LIMITS[1];

const SETTINGS_KEY = "library";
const STALE_RECONCILIATION_MS = 5 * 60 * 1000;
const IMAGE_PATH_RE = /^\/api\/v1\/images\/(img_[A-Za-z0-9_-]{16,64})$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

type OfflineEntryKind = "gist" | "image" | "audio";

export type OfflineSettingsRecord = {
  key: typeof SETTINGS_KEY;
  enabled: boolean;
  byteLimit: number;
  accountMarker: string | null;
  lastReconciledAt: string | null;
  targetCount: number;
};

export type OfflineEntry = {
  key: string;
  kind: OfflineEntryKind;
  cacheKey: string;
  gistId: string;
  revisionNumber: number;
  owned: boolean;
  recentlyViewed: boolean;
  accountRequested: boolean;
  identity: string;
  byteSize: number;
  displayTitle?: string;
  authorName?: string;
  authorAvatarUrl?: string;
  updatedAt?: string;
  lastViewedAt?: string;
  lastPlayedAt?: string;
  parents?: string[];
};

export type OfflineLibrarySummary = {
  supported: boolean;
  enabled: boolean;
  byteLimit: number;
  byteSize: number;
  availableCount: number;
  targetCount: number;
  lastReconciledAt: string | null;
  syncing: boolean;
  completed: number;
  total: number;
  storageFull: boolean;
  error: "update" | "clear" | null;
};

type ManifestNarration = {
  etag: string;
  byte_size: number;
};

type ManifestGist = {
  id: string;
  revision_number: number;
  owned: boolean;
  snapshot_sha256: string;
  display_title: string;
  author_name: string;
  author_avatar_url?: string;
  updated_at: string;
  narration: ManifestNarration | null;
};

type OfflineManifest = {
  account_marker: string;
  generated_at: string;
  gists: ManifestGist[];
};

type RuntimeState = {
  syncing: boolean;
  completed: number;
  total: number;
  storageFull: boolean;
  error: "update" | "clear" | null;
};

const runtimeState: RuntimeState = {
  syncing: false,
  completed: 0,
  total: 0,
  storageFull: false,
  error: null
};

let databasePromise: Promise<IDBDatabase> | null = null;
let reconciliationPromise: Promise<void> | null = null;
let reconciliationController: AbortController | null = null;

class OfflineStorageFullError extends Error {
  constructor() {
    super("Offline storage limit reached");
  }
}

function offlineSupported() {
  return (
    typeof window !== "undefined" &&
    "indexedDB" in window &&
    "caches" in window &&
    "serviceWorker" in navigator
  );
}

function defaultSettings(): OfflineSettingsRecord {
  return {
    key: SETTINGS_KEY,
    enabled: true,
    byteLimit: DEFAULT_OFFLINE_BYTE_LIMIT,
    accountMarker: null,
    lastReconciledAt: null,
    targetCount: 0
  };
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB error"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function openDatabase() {
  if (!offlineSupported()) {
    return Promise.reject(new Error("Offline storage is unsupported"));
  }
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("entries")) {
        database.createObjectStore("entries", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open offline storage"));
    request.onblocked = () =>
      reject(new Error("Offline storage upgrade is blocked"));
  });
  return databasePromise;
}

async function readSettings() {
  const database = await openDatabase();
  const transaction = database.transaction("settings", "readonly");
  const value = await requestValue(
    transaction.objectStore("settings").get(SETTINGS_KEY)
  );
  await transactionDone(transaction);
  if (!value || typeof value !== "object") {
    return defaultSettings();
  }
  const record = value as Partial<OfflineSettingsRecord>;
  return {
    key: SETTINGS_KEY,
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    byteLimit: OFFLINE_BYTE_LIMITS.includes(
      record.byteLimit as (typeof OFFLINE_BYTE_LIMITS)[number]
    )
      ? (record.byteLimit as number)
      : DEFAULT_OFFLINE_BYTE_LIMIT,
    accountMarker:
      typeof record.accountMarker === "string" ? record.accountMarker : null,
    lastReconciledAt:
      typeof record.lastReconciledAt === "string"
        ? record.lastReconciledAt
        : null,
    targetCount:
      typeof record.targetCount === "number" &&
      Number.isInteger(record.targetCount) &&
      record.targetCount >= 0
        ? record.targetCount
        : 0
  } satisfies OfflineSettingsRecord;
}

async function writeSettings(settings: OfflineSettingsRecord) {
  const database = await openDatabase();
  const transaction = database.transaction("settings", "readwrite");
  transaction.objectStore("settings").put(settings);
  await transactionDone(transaction);
}

async function readEntries() {
  const database = await openDatabase();
  const transaction = database.transaction("entries", "readonly");
  const values = await requestValue(transaction.objectStore("entries").getAll());
  await transactionDone(transaction);
  return values as OfflineEntry[];
}

async function readEntry(key: string) {
  const database = await openDatabase();
  const transaction = database.transaction("entries", "readonly");
  const value = await requestValue(transaction.objectStore("entries").get(key));
  await transactionDone(transaction);
  return (value as OfflineEntry | undefined) ?? null;
}

async function writeEntry(entry: OfflineEntry) {
  const database = await openDatabase();
  const transaction = database.transaction("entries", "readwrite");
  transaction.objectStore("entries").put(entry);
  await transactionDone(transaction);
}

async function removeEntryRow(key: string) {
  const database = await openDatabase();
  const transaction = database.transaction("entries", "readwrite");
  transaction.objectStore("entries").delete(key);
  await transactionDone(transaction);
}

async function clearEntryRows() {
  const database = await openDatabase();
  const transaction = database.transaction("entries", "readwrite");
  transaction.objectStore("entries").clear();
  await transactionDone(transaction);
}

function notifyLibraryChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OFFLINE_LIBRARY_EVENT));
  }
}

function setRuntimeState(value: Partial<RuntimeState>) {
  Object.assign(runtimeState, value);
  notifyLibraryChanged();
}

function markConnectivity(online: boolean) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(OFFLINE_CONNECTIVITY_EVENT, { detail: { online } })
    );
  }
}

function absoluteUrl(path: string) {
  return new URL(path, window.location.origin).href;
}

function gistEntryKey(gistId: string, revisionNumber: number) {
  return `gist:${gistId}:${revisionNumber}`;
}

function imageEntryKey(imageId: string) {
  return `image:${imageId}`;
}

function audioEntryKey(gistId: string, revisionNumber: number) {
  return `audio:${gistId}:${revisionNumber}`;
}

function gistCacheKey(gistId: string, revisionNumber: number) {
  return absoluteUrl(
    `/api/gists/${encodeURIComponent(gistId)}/revisions/${revisionNumber}/render`
  );
}

function imageCacheKey(imageId: string) {
  return absoluteUrl(`/api/images/${encodeURIComponent(imageId)}`);
}

function audioCacheKey(gistId: string, revisionNumber: number) {
  return absoluteUrl(
    `/api/gists/${encodeURIComponent(gistId)}/revisions/${revisionNumber}/narration/audio`
  );
}

function cacheNameForEntry(entry: OfflineEntry) {
  return entry.kind === "audio"
    ? OFFLINE_AUDIO_CACHE
    : OFFLINE_CONTENT_CACHE;
}

function entryPriority(entry: OfflineEntry) {
  if (entry.kind === "audio") {
    return 1;
  }
  if (entry.kind === "image") {
    return 2;
  }
  return entry.owned ? 4 : 3;
}

function entryAge(entry: OfflineEntry) {
  const value =
    entry.lastPlayedAt ??
    entry.lastViewedAt ??
    entry.updatedAt ??
    "1970-01-01T00:00:00.000Z";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function deleteEntry(entry: OfflineEntry) {
  const cache = await caches.open(cacheNameForEntry(entry));
  await cache.delete(entry.cacheKey);
  await removeEntryRow(entry.key);

  if (entry.kind !== "gist") {
    return;
  }
  const dependents = (await readEntries()).filter(
    (candidate) => candidate.parents?.includes(entry.key)
  );
  for (const dependent of dependents) {
    const parents = (dependent.parents ?? []).filter(
      (parent) => parent !== entry.key
    );
    if (parents.length === 0) {
      await deleteEntry(dependent);
    } else {
      await writeEntry({ ...dependent, parents });
    }
  }
}

async function ensureCapacity(
  byteSize: number,
  incomingKey: string,
  incomingPriority: number,
  byteLimit: number
) {
  const entries = await readEntries();
  const existing = entries.find((entry) => entry.key === incomingKey);
  let used = entries.reduce((total, entry) => total + entry.byteSize, 0);
  used -= existing?.byteSize ?? 0;
  if (used + byteSize <= byteLimit) {
    return;
  }

  const candidates = entries
    .filter(
      (entry) =>
        entry.key !== incomingKey && entryPriority(entry) <= incomingPriority
    )
    .sort(
      (left, right) =>
        entryPriority(left) - entryPriority(right) ||
        entryAge(left) - entryAge(right)
  );
  for (const candidate of candidates) {
    const current = await readEntry(candidate.key);
    if (current) {
      await deleteEntry(current);
    }
    const currentEntries = await readEntries();
    const currentIncoming = currentEntries.find(
      (entry) => entry.key === incomingKey
    );
    used =
      currentEntries.reduce((total, entry) => total + entry.byteSize, 0) -
      (currentIncoming?.byteSize ?? 0);
    if (used + byteSize <= byteLimit) {
      return;
    }
  }
  throw new OfflineStorageFullError();
}

function responseFromBytes(
  bytes: ArrayBuffer,
  headers: HeadersInit
) {
  return new Response(bytes, { status: 200, headers });
}

async function putResponse(
  cacheName: string,
  cacheKey: string,
  bytes: ArrayBuffer,
  headers: HeadersInit
) {
  const cache = await caches.open(cacheName);
  try {
    await cache.put(cacheKey, responseFromBytes(bytes, headers));
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "QuotaExceededError")) {
      throw error;
    }
    throw new OfflineStorageFullError();
  }
}

function isManifestNarration(value: unknown): value is ManifestNarration {
  if (!value || typeof value !== "object") {
    return false;
  }
  const narration = value as Partial<ManifestNarration>;
  return (
    typeof narration.etag === "string" &&
    SHA256_RE.test(narration.etag) &&
    typeof narration.byte_size === "number" &&
    Number.isInteger(narration.byte_size) &&
    narration.byte_size > 0
  );
}

function isManifestGist(value: unknown): value is ManifestGist {
  if (!value || typeof value !== "object") {
    return false;
  }
  const gist = value as Partial<ManifestGist>;
  return (
    typeof gist.id === "string" &&
    validateGistId(gist.id) &&
    typeof gist.revision_number === "number" &&
    Number.isInteger(gist.revision_number) &&
    gist.revision_number > 0 &&
    typeof gist.owned === "boolean" &&
    typeof gist.snapshot_sha256 === "string" &&
    SHA256_RE.test(gist.snapshot_sha256) &&
    typeof gist.display_title === "string" &&
    gist.display_title.length > 0 &&
    gist.display_title.length <= 500 &&
    typeof gist.author_name === "string" &&
    gist.author_name.length > 0 &&
    gist.author_name.length <= 200 &&
    (gist.author_avatar_url === undefined ||
      typeof gist.author_avatar_url === "string") &&
    typeof gist.updated_at === "string" &&
    (gist.narration === null || isManifestNarration(gist.narration))
  );
}

function normalizeManifest(value: unknown): OfflineManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid offline manifest");
  }
  const manifest = value as Partial<OfflineManifest>;
  if (
    typeof manifest.account_marker !== "string" ||
    !SHA256_RE.test(manifest.account_marker) ||
    typeof manifest.generated_at !== "string" ||
    !Array.isArray(manifest.gists) ||
    manifest.gists.length > 10000 ||
    !manifest.gists.every(isManifestGist)
  ) {
    throw new Error("Invalid offline manifest");
  }
  return manifest as OfflineManifest;
}

function offlineImageId(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    const match = IMAGE_PATH_RE.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function prepareOfflinePayload(gist: PublicGistPayload) {
  const payload = JSON.parse(JSON.stringify(gist)) as PublicGistPayload;
  const imageIds = new Set<string>();
  for (const file of Object.values(payload.files)) {
    if (file.kind !== "markdown" || !file.rendered_html.includes("<img")) {
      continue;
    }
    const document = new DOMParser().parseFromString(
      `<body>${file.rendered_html}</body>`,
      "text/html"
    );
    for (const image of Array.from(document.body.querySelectorAll("img[src]"))) {
      const imageId = offlineImageId(image.getAttribute("src") ?? "");
      if (!imageId) {
        continue;
      }
      imageIds.add(imageId);
      image.setAttribute("src", `/api/images/${imageId}`);
    }
    file.rendered_html = document.body.innerHTML;
  }
  return { payload, imageIds: [...imageIds] };
}

async function cacheImage(
  imageId: string,
  parentKey: string,
  byteLimit: number,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const entryKey = imageEntryKey(imageId);
  const existing = await readEntry(entryKey);
  if (existing) {
    const parents = Array.from(new Set([...(existing.parents ?? []), parentKey]));
    await writeEntry({
      ...existing,
      parents,
      lastViewedAt: new Date().toISOString()
    });
    return;
  }

  const cacheKey = imageCacheKey(imageId);
  const response = await fetch(cacheKey, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "image/*" },
    signal
  });
  if (!response.ok) {
    throw new Error(`Image request failed: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Invalid offline image response");
  }
  const bytes = await response.arrayBuffer();
  signal?.throwIfAborted();
  if (bytes.byteLength === 0) {
    throw new Error("Empty offline image response");
  }
  const entry: OfflineEntry = {
    key: entryKey,
    kind: "image",
    cacheKey,
    gistId: "",
    revisionNumber: 0,
    owned: false,
    recentlyViewed: false,
    accountRequested: false,
    identity: response.headers.get("etag") ?? `${imageId}:${bytes.byteLength}`,
    byteSize: bytes.byteLength,
    lastViewedAt: new Date().toISOString(),
    parents: [parentKey]
  };
  await ensureCapacity(
    entry.byteSize,
    entry.key,
    entryPriority(entry),
    byteLimit
  );
  await putResponse(OFFLINE_CONTENT_CACHE, cacheKey, bytes, {
    "Content-Type": contentType,
    ...(response.headers.get("etag")
      ? { ETag: response.headers.get("etag") as string }
      : {}),
    "Content-Length": String(bytes.byteLength)
  });
  try {
    await writeEntry(entry);
  } catch (error) {
    await (await caches.open(OFFLINE_CONTENT_CACHE)).delete(cacheKey);
    throw error;
  }
}

async function storeGist(
  gist: PublicGistPayload,
  flags: {
    owned: boolean;
    recentlyViewed: boolean;
    accountRequested?: boolean;
  },
  byteLimit: number,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const entryKey = gistEntryKey(gist.id, gist.revision_number);
  const existing = await readEntry(entryKey);
  const now = new Date().toISOString();
  if (existing?.identity === gist.snapshot_sha256) {
    await writeEntry({
      ...existing,
      owned: existing.owned || flags.owned,
      recentlyViewed: existing.recentlyViewed || flags.recentlyViewed,
      accountRequested:
        existing.accountRequested || Boolean(flags.accountRequested),
      displayTitle: gist.display_title,
      authorName: gist.author_name,
      authorAvatarUrl: gist.author_avatar_url,
      updatedAt: gist.updated_at,
      lastViewedAt: flags.recentlyViewed ? now : existing.lastViewedAt
    });
    return existing;
  }

  const prepared = prepareOfflinePayload(gist);
  const serialized = JSON.stringify(prepared.payload);
  const encoded = new TextEncoder().encode(serialized);
  const bytes = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength
  );
  const cacheKey = gistCacheKey(gist.id, gist.revision_number);
  const entry: OfflineEntry = {
    key: entryKey,
    kind: "gist",
    cacheKey,
    gistId: gist.id,
    revisionNumber: gist.revision_number,
    owned: flags.owned,
    recentlyViewed: flags.recentlyViewed,
    accountRequested: Boolean(flags.accountRequested),
    identity: gist.snapshot_sha256,
    byteSize: bytes.byteLength,
    displayTitle: gist.display_title,
    authorName: gist.author_name,
    authorAvatarUrl: gist.author_avatar_url,
    updatedAt: gist.updated_at,
    lastViewedAt: flags.recentlyViewed ? now : existing?.lastViewedAt
  };
  await ensureCapacity(
    entry.byteSize,
    entry.key,
    entryPriority(entry),
    byteLimit
  );
  await putResponse(OFFLINE_CONTENT_CACHE, cacheKey, bytes, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(bytes.byteLength),
    "X-Waveygist-Snapshot": gist.snapshot_sha256
  });
  signal?.throwIfAborted();
  try {
    await writeEntry(entry);
  } catch (error) {
    await (await caches.open(OFFLINE_CONTENT_CACHE)).delete(cacheKey);
    throw error;
  }

  for (const imageId of prepared.imageIds) {
    try {
      await cacheImage(imageId, entry.key, byteLimit, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (error instanceof OfflineStorageFullError) {
        runtimeState.storageFull = true;
        break;
      }
      // An image is optional; the article remains readable with alt text.
    }
  }
  return entry;
}

async function fetchAndStoreManifestGist(
  item: ManifestGist,
  byteLimit: number,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const entryKey = gistEntryKey(item.id, item.revision_number);
  const existing = await readEntry(entryKey);
  if (existing?.identity === item.snapshot_sha256) {
    await writeEntry({
      ...existing,
      owned: existing.owned || item.owned,
      accountRequested:
        existing.accountRequested || (!item.owned && Boolean(item.narration)),
      displayTitle: item.display_title,
      authorName: item.author_name,
      authorAvatarUrl: item.author_avatar_url,
      updatedAt: item.updated_at
    });
    return;
  }
  const response = await fetch(gistCacheKey(item.id, item.revision_number), {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal
  });
  if (!response.ok) {
    throw new Error(`Offline gist request failed: ${response.status}`);
  }
  const gist = normalizePublicGistPayload(item.id, await response.json());
  signal.throwIfAborted();
  if (
    gist.revision_number !== item.revision_number ||
    gist.snapshot_sha256 !== item.snapshot_sha256
  ) {
    throw new Error("Offline gist identity mismatch");
  }
  await storeGist(
    gist,
    {
      owned: item.owned,
      recentlyViewed: existing?.recentlyViewed ?? false,
      accountRequested: !item.owned && Boolean(item.narration)
    },
    byteLimit,
    signal
  );
}

async function cacheNarration(
  item: ManifestGist,
  byteLimit: number,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  if (!item.narration) {
    return;
  }
  const parentKey = gistEntryKey(item.id, item.revision_number);
  if (!(await readEntry(parentKey))) {
    return;
  }
  const entryKey = audioEntryKey(item.id, item.revision_number);
  const existing = await readEntry(entryKey);
  if (
    existing?.identity === item.narration.etag &&
    existing.byteSize === item.narration.byte_size
  ) {
    await writeEntry({ ...existing, accountRequested: true, parents: [parentKey] });
    return;
  }

  const cacheKey = audioCacheKey(item.id, item.revision_number);
  const response = await fetch(cacheKey, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "audio/mpeg" },
    signal
  });
  if (response.status !== 200) {
    throw new Error(`Offline audio request failed: ${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== "audio/mpeg") {
    throw new Error("Invalid offline audio response");
  }
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  if (bytes.byteLength !== item.narration.byte_size) {
    throw new Error("Offline audio size mismatch");
  }
  const entry: OfflineEntry = {
    key: entryKey,
    kind: "audio",
    cacheKey,
    gistId: item.id,
    revisionNumber: item.revision_number,
    owned: false,
    recentlyViewed: false,
    accountRequested: true,
    identity: item.narration.etag,
    byteSize: bytes.byteLength,
    lastPlayedAt: existing?.lastPlayedAt,
    parents: [parentKey]
  };
  await ensureCapacity(
    entry.byteSize,
    entry.key,
    entryPriority(entry),
    byteLimit
  );
  await putResponse(OFFLINE_AUDIO_CACHE, cacheKey, bytes, {
    "Accept-Ranges": "bytes",
    "Content-Length": String(bytes.byteLength),
    "Content-Type": "audio/mpeg",
    ...(response.headers.get("etag")
      ? { ETag: response.headers.get("etag") as string }
      : {})
  });
  try {
    await writeEntry(entry);
  } catch (error) {
    await (await caches.open(OFFLINE_AUDIO_CACHE)).delete(cacheKey);
    throw error;
  }
}

async function auditOfflineStorage() {
  const entries = await readEntries();
  const indexedCacheKeys = new Set(entries.map((entry) => entry.cacheKey));
  for (const entry of entries) {
    const cache = await caches.open(cacheNameForEntry(entry));
    if (!(await cache.match(entry.cacheKey))) {
      await removeEntryRow(entry.key);
    }
  }

  for (const cacheName of [OFFLINE_CONTENT_CACHE, OFFLINE_AUDIO_CACHE]) {
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      if (!indexedCacheKeys.has(request.url)) {
        await cache.delete(request);
      }
    }
  }
}

async function clearAccountScopedEntries() {
  const entries = await readEntries();
  for (const entry of entries) {
    if (entry.kind === "audio" && entry.accountRequested) {
      await deleteEntry(entry);
      continue;
    }
    if (
      entry.kind !== "gist" ||
      (!entry.owned && !entry.accountRequested)
    ) {
      continue;
    }
    if (entry.recentlyViewed) {
      await writeEntry({
        ...entry,
        owned: false,
        accountRequested: false
      });
    } else {
      await deleteEntry(entry);
    }
  }
  const settings = await readSettings();
  await writeSettings({ ...settings, accountMarker: null, targetCount: 0 });
}

async function removeSupersededAccountEntries(manifest: OfflineManifest) {
  const desiredGists = new Set(
    manifest.gists.map((item) => gistEntryKey(item.id, item.revision_number))
  );
  const desiredAudio = new Set(
    manifest.gists
      .filter((item) => item.narration)
      .map((item) => audioEntryKey(item.id, item.revision_number))
  );
  for (const entry of await readEntries()) {
    if (entry.kind === "audio" && entry.accountRequested) {
      if (!desiredAudio.has(entry.key)) {
        await deleteEntry(entry);
      }
      continue;
    }
    if (
      entry.kind !== "gist" ||
      (!entry.owned && !entry.accountRequested) ||
      desiredGists.has(entry.key)
    ) {
      continue;
    }
    if (entry.recentlyViewed) {
      await writeEntry({
        ...entry,
        owned: false,
        accountRequested: false
      });
    } else {
      await deleteEntry(entry);
    }
  }
}

function manifestTargetCount(
  manifest: OfflineManifest,
  entries: OfflineEntry[]
) {
  const targets = new Set(
    manifest.gists.map((item) => gistEntryKey(item.id, item.revision_number))
  );
  for (const entry of entries) {
    if (entry.kind === "gist" && entry.recentlyViewed) {
      targets.add(entry.key);
    }
  }
  return targets.size;
}

async function performReconciliation(signal: AbortSignal) {
  const settings = await readSettings();
  if (!settings.enabled || signal.aborted) {
    return;
  }

  setRuntimeState({
    syncing: true,
    completed: 0,
    total: 0,
    storageFull: false,
    error: null
  });
  let reachedServer = false;
  try {
    await auditOfflineStorage();
    signal.throwIfAborted();
    const response = await fetch("/api/me/offline-manifest", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal
    });
    reachedServer = true;
    markConnectivity(true);
    if (response.status === 401) {
      await clearAccountScopedEntries();
      await writeSettings({
        ...(await readSettings()),
        lastReconciledAt: new Date().toISOString(),
        targetCount: (await readEntries()).filter(
          (entry) => entry.kind === "gist" && entry.recentlyViewed
        ).length
      });
      return;
    }
    if (!response.ok) {
      throw new Error(`Offline manifest request failed: ${response.status}`);
    }
    const manifest = normalizeManifest(await response.json());
    signal.throwIfAborted();

    if (
      settings.accountMarker &&
      settings.accountMarker !== manifest.account_marker
    ) {
      await clearAccountScopedEntries();
    }
    signal.throwIfAborted();

    const refreshedSettings = await readSettings();
    const targetCount = manifestTargetCount(manifest, await readEntries());
    setRuntimeState({ total: manifest.gists.length });
    let completed = 0;
    let updateFailed = false;
    for (const item of manifest.gists) {
      signal.throwIfAborted();
      try {
        await fetchAndStoreManifestGist(
          item,
          refreshedSettings.byteLimit,
          signal
        );
        if (item.narration) {
          await cacheNarration(item, refreshedSettings.byteLimit, signal);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        if (error instanceof OfflineStorageFullError) {
          runtimeState.storageFull = true;
        } else {
          updateFailed = true;
        }
      }
      completed += 1;
      setRuntimeState({ completed });
    }

    signal.throwIfAborted();
    await removeSupersededAccountEntries(manifest);
    await auditOfflineStorage();
    signal.throwIfAborted();
    await writeSettings({
      ...(await readSettings()),
      accountMarker: manifest.account_marker,
      lastReconciledAt: manifest.generated_at,
      targetCount
    });
    setRuntimeState({ error: updateFailed ? "update" : null });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      if (!reachedServer) {
        markConnectivity(false);
      }
      setRuntimeState({ error: "update" });
    }
  } finally {
    setRuntimeState({ syncing: false });
  }
}

export function reconcileOfflineLibrary() {
  if (!offlineSupported()) {
    return Promise.resolve();
  }
  if (!reconciliationPromise) {
    const controller = new AbortController();
    reconciliationController = controller;
    reconciliationPromise = performReconciliation(controller.signal).finally(
      () => {
        if (reconciliationController === controller) {
          reconciliationController = null;
        }
        reconciliationPromise = null;
      }
    );
  }
  return reconciliationPromise;
}

async function stopActiveReconciliation() {
  reconciliationController?.abort();
  await reconciliationPromise?.catch(() => undefined);
}

export async function initializeOfflineLibrary() {
  if (!offlineSupported()) {
    return;
  }
  const settings = await readSettings();
  await writeSettings(settings);
  await auditOfflineStorage();
  notifyLibraryChanged();
  if (settings.enabled) {
    void navigator.storage?.persist?.().catch(() => false);
    await reconcileOfflineLibrary();
  }
}

export async function reconcileIfStale() {
  if (!offlineSupported()) {
    return;
  }
  const settings = await readSettings();
  const last = settings.lastReconciledAt
    ? Date.parse(settings.lastReconciledAt)
    : 0;
  if (
    settings.enabled &&
    (Number.isNaN(last) || Date.now() - last >= STALE_RECONCILIATION_MS)
  ) {
    await reconcileOfflineLibrary();
  }
}

export async function saveRecentlyViewedGist(gist: PublicGistPayload) {
  if (!offlineSupported()) {
    return;
  }
  const settings = await readSettings();
  if (!settings.enabled) {
    return;
  }
  try {
    await storeGist(
      gist,
      { owned: false, recentlyViewed: true },
      settings.byteLimit
    );
    notifyLibraryChanged();
  } catch (error) {
    if (error instanceof OfflineStorageFullError) {
      setRuntimeState({ storageFull: true });
    } else {
      setRuntimeState({ error: "update" });
    }
  }
}

export async function narrationIsCached(
  gistId: string,
  revisionNumber: number
) {
  if (!offlineSupported()) {
    return false;
  }
  const entry = await readEntry(audioEntryKey(gistId, revisionNumber));
  if (!entry) {
    return false;
  }
  return Boolean(
    await (await caches.open(OFFLINE_AUDIO_CACHE)).match(entry.cacheKey)
  );
}

export async function markNarrationPlayed(
  gistId: string,
  revisionNumber: number
) {
  if (!offlineSupported()) {
    return;
  }
  const entry = await readEntry(audioEntryKey(gistId, revisionNumber));
  if (entry) {
    await writeEntry({ ...entry, lastPlayedAt: new Date().toISOString() });
  }
}

export async function getOfflineLibrarySummary(): Promise<OfflineLibrarySummary> {
  if (!offlineSupported()) {
    return {
      supported: false,
      enabled: true,
      byteLimit: DEFAULT_OFFLINE_BYTE_LIMIT,
      byteSize: 0,
      availableCount: 0,
      targetCount: 0,
      lastReconciledAt: null,
      ...runtimeState
    };
  }
  const [settings, entries] = await Promise.all([readSettings(), readEntries()]);
  const gistEntries = entries.filter((entry) => entry.kind === "gist");
  return {
    supported: true,
    enabled: settings.enabled,
    byteLimit: settings.byteLimit,
    byteSize: entries.reduce((total, entry) => total + entry.byteSize, 0),
    availableCount: gistEntries.length,
    targetCount: Math.max(settings.targetCount, gistEntries.length),
    lastReconciledAt: settings.lastReconciledAt,
    ...runtimeState
  };
}

export async function setOfflineLibraryEnabled(enabled: boolean) {
  if (!offlineSupported()) {
    return;
  }
  const settings = await readSettings();
  await writeSettings({ ...settings, enabled });
  if (!enabled) {
    await stopActiveReconciliation();
  }
  notifyLibraryChanged();
  if (enabled) {
    void navigator.storage?.persist?.().catch(() => false);
    void reconcileOfflineLibrary();
  }
}

async function enforceCurrentLimit(byteLimit: number) {
  let entries = await readEntries();
  let used = entries.reduce((total, entry) => total + entry.byteSize, 0);
  const candidates = [...entries].sort(
    (left, right) =>
      entryPriority(left) - entryPriority(right) ||
      entryAge(left) - entryAge(right)
  );
  for (const candidate of candidates) {
    if (used <= byteLimit) {
      break;
    }
    await deleteEntry(candidate);
    used = (await readEntries()).reduce(
      (total, entry) => total + entry.byteSize,
      0
    );
  }
  entries = await readEntries();
  if (entries.reduce((total, entry) => total + entry.byteSize, 0) > byteLimit) {
    throw new OfflineStorageFullError();
  }
}

export async function setOfflineByteLimit(byteLimit: number) {
  if (
    !offlineSupported() ||
    !OFFLINE_BYTE_LIMITS.includes(
      byteLimit as (typeof OFFLINE_BYTE_LIMITS)[number]
    )
  ) {
    return;
  }
  await stopActiveReconciliation();
  const settings = await readSettings();
  await writeSettings({ ...settings, byteLimit });
  await enforceCurrentLimit(byteLimit);
  notifyLibraryChanged();
  if (settings.enabled) {
    void reconcileOfflineLibrary();
  }
}

export async function clearOfflineContent() {
  if (!offlineSupported()) {
    return;
  }
  setRuntimeState({ error: null });
  const settings = await readSettings();
  await writeSettings({
    ...settings,
    enabled: false,
    lastReconciledAt: null,
    targetCount: 0
  });
  await stopActiveReconciliation();
  try {
    await Promise.all([
      caches.delete(OFFLINE_CONTENT_CACHE),
      caches.delete(OFFLINE_AUDIO_CACHE)
    ]);
    await clearEntryRows();
    setRuntimeState({
      completed: 0,
      total: 0,
      storageFull: false,
      error: null
    });
  } catch (error) {
    setRuntimeState({ error: "clear" });
    throw error;
  } finally {
    notifyLibraryChanged();
  }
}

export async function clearOfflineAccountData() {
  if (!offlineSupported()) {
    return;
  }
  await stopActiveReconciliation();
  await clearAccountScopedEntries();
  await auditOfflineStorage();
  notifyLibraryChanged();
}
