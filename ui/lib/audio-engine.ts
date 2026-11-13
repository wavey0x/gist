"use client";

import { useSyncExternalStore } from "react";
import {
  getListenQueue,
  moveToFront,
  nextQueueItem,
  removeFromQueue,
  subscribeListenQueue,
  type QueueItem
} from "./listen-queue";
import {
  cachedNarrationBlob,
  markNarrationPlayed,
  narrationIsCached
} from "./offline-library";

export type AudioTrack = {
  gistId: string;
  revisionNumber: number;
  title: string;
  author: string;
  url: string;
  cached: boolean;
};

export type AudioEngineState = {
  track: AudioTrack | null;
  opened: boolean;
  playing: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  message: string;
};

type SourceSwap = {
  position: number | null;
};

type NavigatorWithAudioSession = Navigator & {
  audioSession?: {
    type: string;
  };
};

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const POSITION_KEY_PREFIX = "waveygist:audio-position:v1:";

const PLAYBACK_RATE_STORAGE_KEY = "waveygist:audio-rate:v1";
const POSITION_SAVE_INTERVAL_SECONDS = 5;
const POSITION_END_THRESHOLD_SECONDS = 10;

const INITIAL_STATE: AudioEngineState = {
  track: null,
  opened: false,
  playing: false,
  buffering: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  message: ""
};

let state = INITIAL_STATE;
let audio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();

let lastSavedTime = 0;
let positionRestored = false;
let sourceSwap: SourceSwap | null = null;
let playbackWanted = false;
let playAttempt = 0;
let networkInterrupted = false;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryAttempts = 0;
let localCopy: {
  generation: number;
  loading: Promise<void> | null;
  url: string | null;
  pendingUrl: string | null;
  failed: boolean;
} = { generation: 0, loading: null, url: null, pendingUrl: null, failed: false };

function update(next: Partial<AudioEngineState>) {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAudioEngine() {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL_STATE);
}

export function getAudioEngineState() { return state; }

export function trackKey(gistId: string, revisionNumber: number) {
  return `${gistId}:${revisionNumber}`;
}

export function isTrack(track: AudioTrack | null, gistId: string, revisionNumber: number) {
  return track?.gistId === gistId && track.revisionNumber === revisionNumber;
}

export function positionStorageKey(gistId: string, revisionNumber: number) {
  return `${POSITION_KEY_PREFIX}${gistId}:${revisionNumber}`;
}

export function audioIsAvailableFor(gistId: string, revisionNumber: number) {
  return (
    isTrack(state.track, gistId, revisionNumber) &&
    (state.opened || (audio?.readyState ?? 0) > 0)
  );
}

function requestPlaybackAudioSession() {
  const audioSession = (navigator as NavigatorWithAudioSession).audioSession;
  if (!audioSession) {
    return;
  }
  try {
    audioSession.type = "playback";
  } catch {
    // The Audio Session API is still experimental outside WebKit.
  }
}

function isPlaybackRate(value: number): value is (typeof PLAYBACK_RATES)[number] {
  return PLAYBACK_RATES.some((rate) => rate === value);
}

function readStoredPlaybackRate() {
  try {
    const value = Number(window.localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY));
    return isPlaybackRate(value) ? value : 1;
  } catch {
    return 1;
  }
}

function clearStoredPosition(track: AudioTrack | null = state.track) {
  if (!track) {
    return;
  }
  try {
    window.localStorage.removeItem(
      positionStorageKey(track.gistId, track.revisionNumber)
    );
  } catch {
    // Playback bookmarks are best effort.
  }
}

export function persistPosition(force = false) {
  const { track } = state;
  if (!audio || !track || (!force && sourceSwap)) {
    return;
  }
  const position = sourceSwap?.position ?? audio.currentTime;
  const duration = sourceSwap ? state.duration : audio.duration;
  if (!Number.isFinite(position)) return;
  if (position <= 0.5) {
    if (positionRestored) {
      clearStoredPosition();
    }
    lastSavedTime = 0;
    return;
  }
  if (
    Number.isFinite(duration) && duration > 0 &&
    duration - position <= POSITION_END_THRESHOLD_SECONDS
  ) {
    clearStoredPosition();
    return;
  }
  if (
    !force &&
    Math.abs(position - lastSavedTime) < POSITION_SAVE_INTERVAL_SECONDS
  ) {
    return;
  }
  try {
    window.localStorage.setItem(
      positionStorageKey(track.gistId, track.revisionNumber),
      JSON.stringify({
        position: Math.round(position * 10) / 10,
        duration: Number.isFinite(duration)
          ? Math.round(duration)
          : undefined,
        saved_at: new Date().toISOString()
      })
    );
    lastSavedTime = position;
  } catch {
    // Playback bookmarks are best effort.
  }
}

function restorePosition(element: HTMLAudioElement) {
  if (positionRestored || !state.track) {
    return;
  }
  positionRestored = true;
  const { gistId, revisionNumber } = state.track;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(positionStorageKey(gistId, revisionNumber)) ?? "null"
    ) as { position?: unknown } | null;
    const position = Number(stored?.position);
    if (
      Number.isFinite(position) &&
      position > 0 &&
      position < element.duration - POSITION_END_THRESHOLD_SECONDS
    ) {
      element.currentTime = position;
      update({ currentTime: position });
      lastSavedTime = position;
    } else if (stored) {
      clearStoredPosition();
    }
  } catch {
    clearStoredPosition();
  }
}

function syncMediaPosition() {
  if (
    !audio ||
    !("mediaSession" in navigator) ||
    !Number.isFinite(audio.duration) ||
    audio.duration <= 0
  ) {
    return;
  }
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate,
      position: Math.min(audio.duration, Math.max(0, audio.currentTime))
    });
  } catch {
    // Position state is optional on older Safari releases.
  }
}

function syncMediaMetadata() {
  if (!("mediaSession" in navigator)) {
    return;
  }
  const session = navigator.mediaSession;
  const { track } = state;
  if (!track || !state.opened) {
    session.metadata = null;
    session.playbackState = "none";
  } else if ("MediaMetadata" in window) {
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: track.author,
      album: "waveygist",
      artwork: [
        {
          src: new URL("/icons/icon-192.png", window.location.origin).href,
          sizes: "192x192",
          type: "image/png"
        },
        {
          src: new URL("/icons/icon-512.png", window.location.origin).href,
          sizes: "512x512",
          type: "image/png"
        }
      ]
    });
  }
  // Prefer time seeking in system controls; the queue still advances on ended.
  for (const action of ["nexttrack", "previoustrack"] as const) {
    try {
      session.setActionHandler(action, null);
    } catch {
      // Media Session actions vary by Safari release.
    }
  }
}

function installMediaSessionActions() {
  if (!("mediaSession" in navigator)) {
    return;
  }
  const actionHandlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ["play", () => void playAudio("Audio playback was blocked. Tap play to continue.")],
    [
      "pause",
      () => {
        pausePlayback();
      }
    ],
    ["seekbackward", () => skip(-10)],
    ["seekforward", () => skip(10)],
    ["stop", closePlayer],
    [
      "seekto",
      (details) => {
        if (typeof details.seekTime === "number") {
          seek(details.seekTime);
          persistPosition(true);
        }
      }
    ]
  ];
  for (const [action, handler] of actionHandlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Media Session actions vary by Safari release.
    }
  }
}

function element() {
  if (audio) {
    return audio;
  }
  const created = document.createElement("audio");
  created.className = "article-audio-engine";
  created.preload = "metadata";
  created.crossOrigin = "anonymous";
  created.setAttribute("aria-hidden", "true");
  created.addEventListener("loadedmetadata", handleLoadedMetadata);
  created.addEventListener("durationchange", () => {
    if (sourceSwap && !Number.isFinite(created.duration)) return;
    update({
      duration: Number.isFinite(created.duration) ? created.duration : 0
    });
    syncMediaPosition();
  });
  created.addEventListener("timeupdate", handleTimeUpdate);
  created.addEventListener("seeked", syncMediaPosition);
  created.addEventListener("error", handleAudioError);
  created.addEventListener("waiting", () => {
    if (playbackWanted) update({ buffering: true });
    adoptLocalCopy();
  });
  created.addEventListener("stalled", () => adoptLocalCopy());
  created.addEventListener("play", () => {
    if (!playbackWanted) {
      created.pause();
      return;
    }
    update({ playing: true });
    syncMediaState();
    if (state.track) {
      void markNarrationPlayed(state.track.gistId, state.track.revisionNumber);
    }
  });
  created.addEventListener("playing", () => {
    networkInterrupted = false;
    clearNetworkRecovery();
    recoveryAttempts = 0;
    update({ buffering: false, message: "" });
    syncMediaState();
    void prepareNextRecording();
  });
  created.addEventListener("pause", () => {
    if (
      sourceSwap || !created.paused || networkInterrupted ||
      (playbackWanted && created.error?.code === MediaError.MEDIA_ERR_NETWORK)
    ) {
      return;
    }
    playbackWanted = false;
    update({ playing: false, buffering: false });
    persistPosition(true);
    syncMediaState();
    adoptLocalCopy();
  });
  created.addEventListener("ended", handleEnded);
  document.body.append(created);
  audio = created;
  installMediaSessionActions();
  subscribeListenQueue(() => {
    refreshCachedQueueTracks();
    void prepareNextRecording();
  });
  refreshCachedQueueTracks();
  window.addEventListener("pagehide", () => persistPosition(true));
  window.addEventListener("online", recoverNetworkPlayback);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      adoptLocalCopy();
      recoverNetworkPlayback();
      syncMediaState();
    } else {
      persistPosition(true);
    }
  });
  return created;
}

function syncMediaState() {
  if ("mediaSession" in navigator && state.track && state.opened) {
    navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
  }
  syncMediaPosition();
}

function handleLoadedMetadata() {
  if (!audio) {
    return;
  }
  update({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
  audio.playbackRate = state.playbackRate;
  const swap = sourceSwap;
  sourceSwap = null;
  if (swap && swap.position !== null) {
    audio.currentTime = swap.position;
    update({ currentTime: swap.position });
  } else {
    restorePosition(audio);
  }
  syncMediaPosition();
}

function handleTimeUpdate() {
  if (!audio || sourceSwap) {
    return;
  }
  update({ currentTime: audio.currentTime });
  persistPosition();
}

function handleEnded() {
  if (!state.opened || !audio?.ended) return;
  playbackWanted = false;
  update({ playing: false, buffering: false });
  syncMediaState();
  clearStoredPosition();
  const finished = state.track;
  if (finished) {
    removeFromQueue(finished.gistId);
  }
  playNext();
}

function releaseLocalCopy() {
  for (const url of [localCopy.url, localCopy.pendingUrl]) {
    if (url) URL.revokeObjectURL(url);
  }
  localCopy = {
    generation: localCopy.generation + 1,
    loading: null,
    url: null,
    pendingUrl: null,
    failed: false
  };
  sourceSwap = null;
}

async function downloadNarrationBlob(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { headers: { Accept: "audio/mpeg" }, signal });
  if (!response.ok) {
    return null;
  }
  const blob = await response.blob();
  const expectedSize = Number(response.headers.get("content-length"));
  return expectedSize > 0 && blob.size !== expectedSize ? null : blob;
}

// iOS can suspend the service worker and drop proxied range requests while
// locked, so playback must not need either once the recording is in memory.
function ensureLocalCopy(download: boolean) {
  const copy = localCopy;
  const { track } = state;
  if (!track || copy.url || copy.pendingUrl || copy.failed) {
    return Promise.resolve();
  }
  if (copy.loading) {
    return copy.loading;
  }
  const { generation } = copy;
  const loading = (async () => {
    let blob = await cachedNarrationBlob(track.gistId, track.revisionNumber).catch(
      () => null
    );
    if (!blob && download) {
      blob = await downloadNarrationBlob(track.url).catch(() => null);
    }
    if (generation !== localCopy.generation) {
      return;
    }
    localCopy.loading = null;
    if (blob) {
      localCopy.pendingUrl = URL.createObjectURL(
        blob.type ? blob : new Blob([blob], { type: "audio/mpeg" })
      );
      adoptLocalCopy(networkInterrupted && playbackWanted);
      void prepareNextRecording();
    }
  })();
  copy.loading = loading;
  return loading;
}

// force: the stream has failed, so the in-memory copy is the only way to keep
// playing, even from a hidden page.
function adoptLocalCopy(force = false) {
  const copy = localCopy;
  if (!copy.pendingUrl || !audio) {
    return;
  }
  // A hidden page may not be allowed to restart. Preserve healthy playback
  // and native pause/resume until the stream stalls or the page returns.
  if (
    !force &&
    document.visibilityState !== "visible" &&
    (audio.paused || audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)
  ) {
    return;
  }
  const known =
    audio.readyState >= HTMLMediaElement.HAVE_METADATA ? audio.currentTime : null;
  sourceSwap = {
    position: force && !known ? state.currentTime || null : known
  };
  copy.url = copy.pendingUrl;
  copy.pendingUrl = null;
  audio.src = copy.url;
  // Keep the play request in this turn. Waiting for loadedmetadata can lose
  // iOS's playback permission when the display locks during the source swap.
  if (playbackWanted) void playAudio();
}

function handleAudioError() {
  const copy = localCopy;
  if (!audio?.error || !state.track) {
    return;
  }
  if (!copy.url) {
    // A finished download beats waiting for the network to come back.
    if (copy.pendingUrl) {
      networkInterrupted = false;
      clearNetworkRecovery();
      adoptLocalCopy(true);
      return;
    }
    networkInterrupted = playbackWanted && audio.error?.code === MediaError.MEDIA_ERR_NETWORK;
    update({
      playing: networkInterrupted,
      buffering: networkInterrupted,
      message: networkInterrupted
        ? "Connection lost. Reconnecting…"
        : "Audio could not be played. Tap play to retry."
    });
    if (!networkInterrupted) playbackWanted = false;
    else scheduleNetworkRecovery();
    syncMediaState();
    return;
  }
  URL.revokeObjectURL(copy.url);
  copy.url = null;
  copy.failed = true;
  sourceSwap = {
    position: sourceSwap?.position ?? (audio.currentTime > 0 ? audio.currentTime : state.currentTime)
  };
  audio.src = state.track.url;
  if (playbackWanted) void playAudio();
}

function setSource(track: AudioTrack) {
  const target = element();
  persistPosition(true);
  playbackWanted = false;
  networkInterrupted = false;
  clearNetworkRecovery();
  recoveryAttempts = 0;
  ++playAttempt;
  releaseLocalCopy();
  lastSavedTime = 0;
  positionRestored = false;
  update({ track, currentTime: 0, duration: 0, playing: false, buffering: false, message: "" });
  const prepared = takePreparedRecording(track);
  if (prepared) localCopy.url = URL.createObjectURL(prepared);
  target.src = localCopy.url ?? track.url;
  syncMediaMetadata();
}

async function playAudio(failureMessage = "Audio could not be played.") {
  if (!audio || !state.opened) {
    return;
  }
  requestPlaybackAudioSession();
  clearNetworkRecovery();
  playbackWanted = true;
  networkInterrupted = false;
  const attempt = ++playAttempt;
  update({ playing: true, buffering: audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA, message: "" });
  if (audio.error) {
    sourceSwap = { position: state.currentTime };
    audio.load();
  }
  audio.playbackRate = state.playbackRate;
  syncMediaMetadata();
  syncMediaState();
  try {
    await audio.play();
    if (attempt === playAttempt && playbackWanted) {
      update({ buffering: false, message: "" });
    }
  } catch (error) {
    // Swapping the source aborts this attempt and resumes on the new one.
    if (
      attempt === playAttempt && playbackWanted &&
      !(error instanceof DOMException && error.name === "AbortError")
    ) {
      // WebKit can reject play() before dispatching error. Let the same
      // source-recovery path handle both without discarding the play intent.
      if (audio.error) {
        handleAudioError();
        return;
      }
      playbackWanted = false;
      update({ playing: false, buffering: false, message: failureMessage });
      syncMediaState();
    }
  }
}

function pausePlayback() {
  playbackWanted = false;
  networkInterrupted = false;
  clearNetworkRecovery();
  ++playAttempt;
  audio?.pause();
  update({ playing: false, buffering: false, message: "" });
  persistPosition(true);
  syncMediaState();
}

function recoverNetworkPlayback() {
  if (networkInterrupted && playbackWanted) {
    void playAudio();
    void ensureLocalCopy(true);
  }
}

function clearNetworkRecovery() {
  if (recoveryTimer !== null) clearTimeout(recoveryTimer);
  recoveryTimer = null;
}

function scheduleNetworkRecovery() {
  clearNetworkRecovery();
  // Retain the user's play intent through a dropped connection, with bounded
  // backoff. Pause/close/track changes cancel recovery, including stale timers.
  if (!navigator.onLine) return;
  const delay = Math.min(30_000, 2_000 * 2 ** Math.min(recoveryAttempts++, 4));
  recoveryTimer = setTimeout(recoverNetworkPlayback, delay);
}

// Load a track's metadata for its page unless the listener has something open.
export function prepareTrack(track: AudioTrack) {
  if (isTrack(state.track, track.gistId, track.revisionNumber)) {
    update({ track });
    syncMediaMetadata();
    return;
  }
  if (!state.opened) {
    setSource(track);
  }
}

export function releaseTrack(gistId: string, revisionNumber: number) {
  if (state.opened || !isTrack(state.track, gistId, revisionNumber)) {
    return;
  }
  persistPosition(true);
  pausePlayback();
  audio?.removeAttribute("src");
  audio?.load();
  releaseLocalCopy();
  update({ track: null, currentTime: 0, duration: 0, playing: false, buffering: false, message: "" });
  syncMediaMetadata();
}

export function openTrack(track: AudioTrack) {
  if (!isTrack(state.track, track.gistId, track.revisionNumber)) {
    setSource(track);
  }
  const target = element();
  target.preload = "auto";
  update({ track, opened: true, message: "" });
  moveToFront(track.gistId, {
    title: track.title,
    author_name: track.author,
    revision_number: track.revisionNumber,
    audio_url: track.url
  });
  syncMediaMetadata();
  void playAudio();
  void ensureLocalCopy(true);
}

export function closePlayer() {
  pausePlayback();
  releasePreparedRecording();
  if (audio) {
    audio.preload = "metadata";
  }
  update({ opened: false });
  syncMediaMetadata();
}

export function noteTrackCached(gistId: string, revisionNumber: number) {
  if (isTrack(state.track, gistId, revisionNumber)) {
    update({ track: { ...state.track!, cached: true } });
    if (state.opened) {
      void ensureLocalCopy(false);
    }
  }
}

export function togglePlayback() {
  if (!audio) {
    return;
  }
  if (playbackWanted || !audio.paused) {
    pausePlayback();
    return;
  }
  void playAudio();
}

export function seek(value: number) {
  if (!audio || !Number.isFinite(value)) {
    return;
  }
  const maximum = sourceSwap && state.duration > 0
    ? state.duration
    : Number.isFinite(audio.duration) ? audio.duration : Infinity;
  const position = Math.min(maximum, Math.max(0, value));
  if (sourceSwap) sourceSwap.position = position;
  audio.currentTime = position;
  update({ currentTime: position });
  syncMediaPosition();
}

export function seekToFraction(fraction: number) {
  if (state.duration > 0) {
    seek(Math.min(1, Math.max(0, fraction)) * state.duration);
    persistPosition(true);
  }
}

export function skip(seconds: number) {
  if (!audio || !Number.isFinite(audio.currentTime)) {
    return;
  }
  const maximum = Number.isFinite(audio.duration) ? audio.duration : Infinity;
  seek(Math.min(maximum, Math.max(0, (sourceSwap?.position ?? audio.currentTime) + seconds)));
  persistPosition(true);
}

export function selectPlaybackRate(rate: number) {
  update({ playbackRate: rate });
  if (audio) {
    audio.playbackRate = rate;
    syncMediaPosition();
  }
  try {
    window.localStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, String(rate));
  } catch {
    // Playback preferences are best effort.
  }
}

export function hydratePlaybackRate() {
  update({ playbackRate: readStoredPlaybackRate() });
}

export function trackForQueueItem(item: QueueItem): AudioTrack | null {
  if (item.status !== "ready" || !item.audio_url || item.revision_number === null) {
    return null;
  }
  return {
    gistId: item.gist_id,
    revisionNumber: item.revision_number,
    title: item.title,
    author: item.author_name,
    url: item.audio_url,
    cached: false
  };
}

// Offline availability of queued recordings, resolved ahead of time so that
// auto-advance can start the next track synchronously from the ended event.
const cachedQueueTracks = new Set<string>();

// Prepare only the next recording. Starting it must not wait for JavaScript
// fetch/Cache Storage after iOS backgrounds the page at the end of a track.
let preparedRecording: {
  key: string;
  blob: Blob | null;
  controller: AbortController;
  loading: Promise<void> | null;
} | null = null;

function releasePreparedRecording() {
  preparedRecording?.controller.abort();
  preparedRecording = null;
}

function takePreparedRecording(track: AudioTrack) {
  const blob = preparedRecording?.key === trackKey(track.gistId, track.revisionNumber)
    ? preparedRecording.blob : null;
  releasePreparedRecording();
  return blob;
}

async function prepareNextRecording() {
  if (!state.opened || !state.track || (!localCopy.url && !localCopy.pendingUrl)) return;
  const item = nextQueueItem(state.track.gistId);
  const next = item ? trackForQueueItem(item) : null;
  if (!next) {
    releasePreparedRecording();
    return;
  }
  const key = trackKey(next.gistId, next.revisionNumber);
  if (preparedRecording?.key === key) return preparedRecording.loading;
  releasePreparedRecording();
  const prepared = {
    key,
    blob: null as Blob | null,
    controller: new AbortController(),
    loading: null as Promise<void> | null
  };
  preparedRecording = prepared;
  prepared.loading = (async () => {
    let blob = await cachedNarrationBlob(next.gistId, next.revisionNumber).catch(() => null);
    if (prepared.controller.signal.aborted) return;
    if (!blob) blob = await downloadNarrationBlob(next.url, prepared.controller.signal).catch(() => null);
    if (preparedRecording !== prepared) return;
    prepared.blob = blob?.type ? blob : blob ? new Blob([blob], { type: "audio/mpeg" }) : null;
    prepared.loading = null;
  })();
  return prepared.loading;
}

function refreshCachedQueueTracks() {
  for (const item of getListenQueue().items) {
    const track = trackForQueueItem(item);
    if (!track) {
      continue;
    }
    const key = trackKey(track.gistId, track.revisionNumber);
    if (cachedQueueTracks.has(key)) {
      continue;
    }
    void narrationIsCached(track.gistId, track.revisionNumber)
      .then((cached) => {
        if (cached) {
          cachedQueueTracks.add(key);
        }
      })
      .catch(() => undefined);
  }
}

export function queueItemTrack(item: QueueItem) {
  const track = trackForQueueItem(item);
  return track
    ? {
        ...track,
        cached: cachedQueueTracks.has(trackKey(track.gistId, track.revisionNumber))
      }
    : null;
}

export function playNext() {
  const next = nextQueueItem(state.track?.gistId ?? null);
  const track = next ? queueItemTrack(next) : null;
  if (track) {
    openTrack(track);
  }
}
