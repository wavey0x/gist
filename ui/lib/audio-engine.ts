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
  currentTime: number;
  duration: number;
  playbackRate: number;
  message: string;
  sleepEndsAt: number | null;
  sleepMinutes: number | null;
};

type SourceSwap = {
  position: number | null;
  resume: boolean;
};

type NavigatorWithAudioSession = Navigator & {
  audioSession?: {
    type: string;
  };
};

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const SLEEP_MINUTES = [15, 30, 60] as const;
export const POSITION_KEY_PREFIX = "waveygist:audio-position:v1:";

const PLAYBACK_RATE_STORAGE_KEY = "waveygist:audio-rate:v1";
const POSITION_SAVE_INTERVAL_SECONDS = 5;
const POSITION_END_THRESHOLD_SECONDS = 10;

const INITIAL_STATE: AudioEngineState = {
  track: null,
  opened: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  message: "",
  sleepEndsAt: null,
  sleepMinutes: null
};

let state = INITIAL_STATE;
let audio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();

let lastSavedTime = 0;
let positionRestored = false;
let sourceSwap: SourceSwap | null = null;
let resumeOnLocalCopy = false;
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

export function trackKey(gistId: string, revisionNumber: number) {
  return `${gistId}:${revisionNumber}`;
}

export function isTrack(track: AudioTrack | null, gistId: string, revisionNumber: number) {
  return track?.gistId === gistId && track.revisionNumber === revisionNumber;
}

export function positionStorageKey(gistId: string, revisionNumber: number) {
  return `${POSITION_KEY_PREFIX}${gistId}:${revisionNumber}`;
}

export function audioIsLoadedFor(gistId: string, revisionNumber: number) {
  return (
    isTrack(state.track, gistId, revisionNumber) && (audio?.readyState ?? 0) > 0
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
  if (!audio || !track || !Number.isFinite(audio.currentTime) || sourceSwap) {
    return;
  }
  if (audio.currentTime <= 0.5) {
    if (positionRestored) {
      clearStoredPosition();
    }
    lastSavedTime = 0;
    return;
  }
  if (
    Number.isFinite(audio.duration) &&
    audio.duration - audio.currentTime <= POSITION_END_THRESHOLD_SECONDS
  ) {
    clearStoredPosition();
    return;
  }
  if (
    !force &&
    Math.abs(audio.currentTime - lastSavedTime) < POSITION_SAVE_INTERVAL_SECONDS
  ) {
    return;
  }
  try {
    window.localStorage.setItem(
      positionStorageKey(track.gistId, track.revisionNumber),
      JSON.stringify({
        position: Math.round(audio.currentTime * 10) / 10,
        duration: Number.isFinite(audio.duration)
          ? Math.round(audio.duration)
          : undefined,
        saved_at: new Date().toISOString()
      })
    );
    lastSavedTime = audio.currentTime;
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
  if (!track) {
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
  try {
    // iOS swaps the lock screen's 10-second skip buttons for track buttons
    // whenever a track handler exists, so leave them unset. The playlist
    // still advances on its own when a recording ends.
    session.setActionHandler("nexttrack", null);
    session.setActionHandler("previoustrack", null);
  } catch {
    // Media Session actions vary by Safari release.
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
        audio?.pause();
        persistPosition(true);
      }
    ],
    ["seekbackward", (details) => skip(-(details.seekOffset ?? 10))],
    ["seekforward", (details) => skip(details.seekOffset ?? 10)],
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
    update({
      duration: Number.isFinite(created.duration) ? created.duration : 0
    });
    syncMediaPosition();
  });
  created.addEventListener("timeupdate", handleTimeUpdate);
  created.addEventListener("seeked", syncMediaPosition);
  created.addEventListener("error", handleAudioError);
  created.addEventListener("waiting", adoptLocalCopy);
  created.addEventListener("stalled", adoptLocalCopy);
  created.addEventListener("play", () => {
    update({ playing: true });
    syncMediaState();
    if (state.track) {
      void markNarrationPlayed(state.track.gistId, state.track.revisionNumber);
    }
  });
  created.addEventListener("pause", () => {
    if (sourceSwap) {
      return;
    }
    update({ playing: false });
    syncMediaState();
    adoptLocalCopy();
  });
  created.addEventListener("ended", handleEnded);
  document.body.append(created);
  audio = created;
  installMediaSessionActions();
  subscribeListenQueue(() => {
    syncMediaMetadata();
    refreshCachedQueueTracks();
  });
  refreshCachedQueueTracks();
  window.addEventListener("pagehide", () => persistPosition(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      adoptLocalCopy();
    } else {
      persistPosition(true);
    }
  });
  return created;
}

function syncMediaState() {
  if ("mediaSession" in navigator && state.track) {
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
  if (swap?.resume) {
    void playAudio();
  }
  syncMediaPosition();
}

function handleTimeUpdate() {
  if (!audio || sourceSwap) {
    return;
  }
  update({ currentTime: audio.currentTime });
  persistPosition();
  if (state.sleepEndsAt !== null && Date.now() >= state.sleepEndsAt) {
    update({ sleepEndsAt: null, sleepMinutes: null });
    audio.pause();
    persistPosition(true);
  }
}

function handleEnded() {
  update({ playing: false });
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
  resumeOnLocalCopy = false;
}

async function downloadNarrationBlob(url: string) {
  const response = await fetch(url, { headers: { Accept: "audio/mpeg" } });
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
      adoptLocalCopy();
    }
  })();
  copy.loading = loading;
  return loading;
}

function adoptLocalCopy() {
  const copy = localCopy;
  if (!copy.pendingUrl || !audio) {
    return;
  }
  const interrupted = !audio.paused;
  // A hidden page may not be allowed to restart, so keep a healthy stream
  // running until it stalls, pauses, or the page returns.
  if (
    interrupted &&
    document.visibilityState !== "visible" &&
    audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
  ) {
    return;
  }
  sourceSwap = {
    position:
      audio.readyState >= HTMLMediaElement.HAVE_METADATA ? audio.currentTime : null,
    resume: interrupted || resumeOnLocalCopy
  };
  resumeOnLocalCopy = false;
  copy.url = copy.pendingUrl;
  copy.pendingUrl = null;
  audio.src = copy.url;
}

function handleAudioError() {
  const copy = localCopy;
  if (!audio || !copy.url || !state.track) {
    return;
  }
  URL.revokeObjectURL(copy.url);
  copy.url = null;
  copy.failed = true;
  sourceSwap = {
    position: audio.currentTime > 0 ? audio.currentTime : null,
    resume: state.playing || (sourceSwap?.resume ?? false)
  };
  audio.src = state.track.url;
}

function setSource(track: AudioTrack) {
  const target = element();
  persistPosition(true);
  releaseLocalCopy();
  lastSavedTime = 0;
  positionRestored = false;
  update({ track, currentTime: 0, duration: 0, message: "" });
  target.src = track.url;
  syncMediaMetadata();
}

async function playAudio(failureMessage = "Audio could not be played.") {
  if (!audio) {
    return;
  }
  requestPlaybackAudioSession();
  audio.playbackRate = state.playbackRate;
  try {
    await audio.play();
    update({ message: "" });
  } catch (error) {
    // Swapping the source aborts this attempt and resumes on the new one.
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      update({ message: failureMessage });
    }
  }
}

async function startFromCachedCopy() {
  if (!audio) {
    return;
  }
  // The cached body loads after this tap, so bless the element for a later
  // play instead of restarting the stream a moment after it begins.
  requestPlaybackAudioSession();
  resumeOnLocalCopy = true;
  void audio.play().catch(() => undefined);
  audio.pause();
  await ensureLocalCopy(true);
  if (resumeOnLocalCopy) {
    resumeOnLocalCopy = false;
    await playAudio();
  }
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
  audio?.pause();
  audio?.removeAttribute("src");
  audio?.load();
  releaseLocalCopy();
  update({ track: null, currentTime: 0, duration: 0, playing: false, message: "" });
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
  if (localCopy.url) {
    void playAudio();
  } else if (track.cached) {
    void startFromCachedCopy();
  } else {
    void playAudio();
    void ensureLocalCopy(true);
  }
}

export function closePlayer() {
  audio?.pause();
  persistPosition(true);
  if (audio) {
    audio.preload = "metadata";
  }
  update({ opened: false, sleepEndsAt: null, sleepMinutes: null });
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
  if (!audio.paused) {
    audio.pause();
    persistPosition(true);
    return;
  }
  void playAudio();
}

export function seek(value: number) {
  if (!audio || !Number.isFinite(value)) {
    return;
  }
  audio.currentTime = value;
  update({ currentTime: value });
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
  seek(Math.min(maximum, Math.max(0, audio.currentTime + seconds)));
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

export function cycleSleepTimer() {
  const index = SLEEP_MINUTES.findIndex((minutes) => minutes === state.sleepMinutes);
  const minutes = SLEEP_MINUTES[index + 1] ?? null;
  update({
    sleepMinutes: minutes,
    sleepEndsAt: minutes === null ? null : Date.now() + minutes * 60 * 1000
  });
}
