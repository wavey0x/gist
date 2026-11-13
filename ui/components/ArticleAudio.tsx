"use client";

import { refreshListenQueue } from "../lib/listen-queue";
import {
  Check,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  audioIsAvailableFor,
  closePlayer,
  isTrack,
  noteTrackCached,
  openTrack,
  persistPosition,
  PLAYBACK_RATES,
  prepareTrack,
  releaseTrack,
  seek,
  selectPlaybackRate,
  skip,
  togglePlayback,
  useAudioEngine,
  type AudioTrack
} from "../lib/audio-engine";
import { formatPlaybackRate, formatPlaybackTime } from "../lib/audio-format";
import {
  narrationIsCached,
  OFFLINE_LIBRARY_EVENT,
  reconcileOfflineLibrary
} from "../lib/offline-library";
import { ListenFromHere } from "./ListenFromHere";

type NarrationStatus = "pending" | "ready" | "failed";

type NarrationPayload = {
  status: NarrationStatus;
  retryable: boolean;
  audio_url?: string;
};

type ArticleAudioProps = {
  active: boolean;
  articleTitle: string | null;
  authorName: string;
  children: ReactNode;
  gistId: string;
  revisionNumber: number;
};

type ViewState = "checking" | "unavailable" | "idle" | "preparing" | "ready" | "failed";

const POLL_DELAYS_MS = [1500, 2500, 4000, 6000, 8000];
const PLAYER_DOCK_TOP_PX = 10;

function isNarrationPayload(value: unknown): value is NarrationPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Partial<NarrationPayload>;
  return (
    (payload.status === "pending" ||
      payload.status === "ready" ||
      payload.status === "failed") &&
    typeof payload.retryable === "boolean" &&
    (payload.audio_url === undefined || typeof payload.audio_url === "string") &&
    (payload.status !== "ready" || typeof payload.audio_url === "string")
  );
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function ArticleAudio({
  active,
  articleTitle,
  authorName,
  children,
  gistId,
  revisionNumber
}: ArticleAudioProps) {
  const engine = useAudioEngine();
  const [viewState, setViewState] = useState<ViewState>("checking");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [cachedAvailable, setCachedAvailable] = useState(false);
  const [message, setMessage] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const speedControlRef = useRef<HTMLDivElement | null>(null);
  const speedButtonRef = useRef<HTMLButtonElement | null>(null);
  const dockSentinelRef = useRef<HTMLSpanElement | null>(null);
  const dockTopProbeRef = useRef<HTMLSpanElement | null>(null);
  const playerId = useId();
  const speedOptionsId = useId();
  const endpoint = `/api/gists/${encodeURIComponent(gistId)}/revisions/${revisionNumber}/narration`;
  const isCurrentTrack = isTrack(engine.track, gistId, revisionNumber);
  const playerOpen = isCurrentTrack && engine.opened;
  const { currentTime, duration, playbackRate, playing } = isCurrentTrack
    ? engine
    : { currentTime: 0, duration: 0, playbackRate: engine.playbackRate, playing: false };
  const track = useMemo<AudioTrack | null>(
    () =>
      audioUrl
        ? {
            gistId,
            revisionNumber,
            title: articleTitle?.trim() || "Article audio",
            author: authorName,
            url: audioUrl,
            cached: cachedAvailable
          }
        : null,
    [articleTitle, audioUrl, authorName, cachedAvailable, gistId, revisionNumber]
  );

  function cancelRequest() {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }

  function reset() {
    cancelRequest();
    setViewState("checking");
    setAudioUrl(null);
    setCachedAvailable(false);
    setMessage("");
    setRetryable(false);
    setSpeedMenuOpen(false);
    setDocked(false);
  }

  useEffect(() => {
    reset();
    return () => {
      cancelRequest();
      releaseTrack(gistId, revisionNumber);
    };
    // Reset only when the immutable article identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gistId, revisionNumber]);

  useEffect(() => {
    if (!active) {
      reset();
      releaseTrack(gistId, revisionNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (active) {
      void refreshListenQueue();
    }
  }, [active]);

  useEffect(() => {
    if (active && track) {
      prepareTrack(track);
    }
  }, [active, track]);

  useEffect(() => {
    if (!speedMenuOpen) {
      return;
    }
    const closeFromPointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !speedControlRef.current?.contains(event.target)
      ) {
        setSpeedMenuOpen(false);
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSpeedMenuOpen(false);
        speedButtonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", closeFromPointer);
    window.addEventListener("keydown", closeFromKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeFromPointer);
      window.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [speedMenuOpen]);

  useEffect(() => {
    const surfaceVisible =
      active && viewState === "ready" && playerOpen && Boolean(audioUrl);
    if (!surfaceVisible) {
      setDocked(false);
      return;
    }
    let frame: number | null = null;
    const updateDocked = () => {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const sentinel = dockSentinelRef.current;
        if (sentinel) {
          const dockTop =
            dockTopProbeRef.current?.getBoundingClientRect().top ??
            PLAYER_DOCK_TOP_PX;
          setDocked(
            sentinel.getBoundingClientRect().top <= dockTop
          );
        }
      });
    };
    updateDocked();
    window.addEventListener("scroll", updateDocked, { passive: true });
    window.addEventListener("resize", updateDocked);
    window.visualViewport?.addEventListener("scroll", updateDocked, {
      passive: true
    });
    window.visualViewport?.addEventListener("resize", updateDocked);
    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", updateDocked);
      window.removeEventListener("resize", updateDocked);
      window.visualViewport?.removeEventListener("scroll", updateDocked);
      window.visualViewport?.removeEventListener("resize", updateDocked);
    };
  }, [active, audioUrl, playerOpen, viewState]);

  async function readPayload(response: Response) {
    const payload: unknown = await response.json().catch(() => null);
    return isNarrationPayload(payload) ? payload : null;
  }

  function showReady(payload: NarrationPayload) {
    setAudioUrl(payload.audio_url ?? null);
    setViewState("ready");
    setMessage("");
    setRetryable(false);
    void reconcileOfflineLibrary();
  }

  function showFailure(response: Response | null, payload?: NarrationPayload | null) {
    setViewState("failed");
    setRetryable(Boolean(payload?.retryable));
    if (response?.status === 401) {
      setMessage("Your session expired. Log in again to listen.");
    } else if (response?.status === 403) {
      setMessage("Article audio is not enabled for this account.");
    } else if (response?.status === 422) {
      setMessage("This article cannot be narrated.");
    } else if (response?.status === 429) {
      setMessage("The audio generation limit has been reached.");
    } else {
      setMessage(
        payload?.retryable
          ? "Audio generation failed. You can retry once."
          : "Audio generation failed."
      );
    }
  }

  async function syncNarration(method: "GET" | "POST" = "GET") {
    if (!active || controllerRef.current) return;
    // A revision's recording is immutable, and a wake-up status failure must
    // never take down the open player, including during a source swap.
    if (method === "GET" && audioIsAvailableFor(gistId, revisionNumber)) {
      setAudioUrl(`${endpoint}/audio`);
      setViewState("ready");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    let pending = method === "POST";
    let attempt = 0;
    if (pending) {
      setViewState("preparing");
      setMessage("");
      setRetryable(false);
    } else {
      setViewState((state) => state === "unavailable" ? "checking" : state);
    }
    try {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(endpoint, {
            method,
            cache: "no-store",
            headers: {
              Accept: "application/json",
              ...(method === "POST" ? { "Content-Type": "application/json" } : {})
            },
            ...(method === "POST" ? { body: "{}" } : {}),
            signal: controller.signal
          });
          const payload = await readPayload(response);
          controller.signal.throwIfAborted();
          if (method === "GET" && audioIsAvailableFor(gistId, revisionNumber)) {
            setAudioUrl(`${endpoint}/audio`);
            setViewState("ready");
            return;
          }
          if (method === "POST" && response.ok) {
            // Requesting audio queues the gist on the server.
            void refreshListenQueue();
          }
          if (method === "GET" && response.status === 404) {
            const cached = await narrationIsCached(gistId, revisionNumber);
            controller.signal.throwIfAborted();
            if (!cached) setViewState("idle");
            setMessage("");
            setRetryable(false);
            return;
          }
          if (response.status >= 500 || (method === "GET" && response.status === 429)) {
            throw new Error("Audio status temporarily unavailable");
          }
          if (!response.ok || payload?.status === "failed") {
            // A cached recording remains playable when the server cannot provide it.
            if (!(await narrationIsCached(gistId, revisionNumber))) {
              controller.signal.throwIfAborted();
              showFailure(response, payload);
            }
            return;
          }
          if (!payload) throw new Error("Invalid audio status");
          if (payload.status === "ready") {
            showReady(payload);
            return;
          }
          pending = true;
          setViewState("preparing");
          setMessage("");
          setRetryable(false);
        } catch {
          controller.signal.throwIfAborted();
          setMessage(
            pending
              ? "Connection interrupted. Checking again…"
              : "Audio status is unavailable. Try again."
          );
          if (!pending) {
            setViewState((state) => state === "checking" ? "unavailable" : state);
            return;
          }
        }
        // After an uncertain POST, only read status; never resubmit automatically.
        method = "GET";
        await wait(
          POLL_DELAYS_MS[Math.min(attempt++, POLL_DELAYS_MS.length - 1)],
          controller.signal
        );
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        throw error;
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    async function refreshCache() {
      const cached = await narrationIsCached(gistId, revisionNumber).catch(() => false);
      if (disposed) return;
      setCachedAvailable(cached);
      if (cached) {
        setAudioUrl(`${endpoint}/audio`);
        setViewState("ready");
        setRetryable(false);
        setMessage("");
        noteTrackCached(gistId, revisionNumber);
      }
    }
    const refresh = () => { void syncNarration(); };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshCache();
        refresh();
      }
    };
    void refreshCache().then(() => {
      if (!disposed) {
        void syncNarration();
      }
    });
    window.addEventListener(OFFLINE_LIBRARY_EVENT, refreshCache);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      cancelRequest();
      window.removeEventListener(OFFLINE_LIBRARY_EVENT, refreshCache);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Each subscription belongs to this immutable article and account capability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, endpoint]);

  function togglePlayer() {
    if (viewState !== "ready" || !track) {
      void syncNarration(viewState === "unavailable" ? "GET" : "POST");
      return;
    }
    if (playerOpen) {
      closePlayer();
      setSpeedMenuOpen(false);
      return;
    }
    setMessage("");
    openTrack(track);
  }

  function choosePlaybackRate(rate: number) {
    selectPlaybackRate(rate);
    setSpeedMenuOpen(false);
    window.requestAnimationFrame(() => speedButtonRef.current?.focus());
  }

  const seekProgress =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const seekStyle = {
    "--audio-progress": `${seekProgress}%`
  } as CSSProperties;

  const waiting = viewState === "checking" || viewState === "preparing";
  let buttonLabel = "Listen to article";
  let buttonTitle = "Listen";
  if (viewState === "checking") {
    buttonLabel = "Checking article audio";
    buttonTitle = "Checking audio";
  } else if (viewState === "unavailable") {
    buttonLabel = "Check article audio";
    buttonTitle = "Check audio status";
  } else if (viewState === "preparing") {
    buttonLabel = "Preparing article audio";
    buttonTitle = "Preparing audio";
  } else if (retryable) {
    buttonLabel = "Retry article audio";
    buttonTitle = "Retry audio";
  } else if (viewState === "failed") {
    buttonLabel = "Article audio unavailable";
    buttonTitle = "Audio unavailable";
  } else if (viewState === "ready") {
    buttonLabel = playerOpen ? "Hide article audio player" : "Play article audio";
    buttonTitle = playerOpen ? "Hide audio player" : "Play article audio";
    if (cachedAvailable) buttonTitle += " (available offline)";
  }

  return (
    <>
      <div className="article-audio-toolbar-group">
        <div className="toolbar" aria-label="Display controls">
          {active ? (
            <button
              type="button"
              className={
                viewState === "ready"
                  ? "icon-button article-audio-button article-audio-button-ready"
                  : "icon-button article-audio-button"
              }
              aria-busy={waiting}
              aria-controls={viewState === "ready" ? playerId : undefined}
              aria-expanded={viewState === "ready" ? playerOpen : undefined}
              aria-label={buttonLabel}
              aria-pressed={viewState === "ready" ? playerOpen : undefined}
              title={buttonTitle}
              disabled={waiting || (viewState === "failed" && !retryable)}
              onClick={togglePlayer}
            >
              {waiting ? (
                <span className="article-audio-spinner" aria-hidden="true" />
              ) : (
                <Volume2 aria-hidden="true" size={18} strokeWidth={1.8} />
              )}
            </button>
          ) : null}
          {children}
        </div>
        <span
          ref={dockSentinelRef}
          className="article-audio-dock-sentinel"
          aria-hidden="true"
        />
        <span
          ref={dockTopProbeRef}
          className="article-audio-dock-top-probe"
          aria-hidden="true"
        />
        {active ? <span className="sr-only" role="status">{buttonLabel}</span> : null}
        {active && viewState === "ready" && audioUrl && playerOpen ? (
          <div
            id={playerId}
            className={`article-audio-overlay${
              docked ? " article-audio-overlay-docked" : ""
            }`}
            role="group"
            aria-label="Article audio player"
          >
            <div className="article-audio-transport">
              <button
                type="button"
                className="article-audio-skip-button"
                aria-label="Skip back 10 seconds"
                disabled={duration <= 0}
                onClick={() => skip(-10)}
              >
                <RotateCcw aria-hidden="true" size={19} strokeWidth={1.8} />
                <span className="article-audio-skip-label" aria-hidden="true">
                  10
                </span>
              </button>
              <button
                type="button"
                className="article-audio-play-button"
                aria-label={
                  playing ? "Pause article audio" : "Play article audio"
                }
                aria-busy={engine.buffering}
                onClick={togglePlayback}
              >
                {playing ? (
                  <Pause aria-hidden="true" size={16} strokeWidth={2} />
                ) : (
                  <Play aria-hidden="true" size={16} strokeWidth={2} />
                )}
              </button>
              <button
                type="button"
                className="article-audio-skip-button"
                aria-label="Skip forward 10 seconds"
                disabled={duration <= 0}
                onClick={() => skip(10)}
              >
                <RotateCw aria-hidden="true" size={19} strokeWidth={1.8} />
                <span className="article-audio-skip-label" aria-hidden="true">
                  10
                </span>
              </button>
            </div>
            <div className="article-audio-speed-control" ref={speedControlRef}>
              <button
                ref={speedButtonRef}
                type="button"
                className="article-audio-speed-button"
                aria-label={`Playback speed ${formatPlaybackRate(playbackRate)}`}
                aria-controls={speedMenuOpen ? speedOptionsId : undefined}
                aria-expanded={speedMenuOpen}
                onClick={() => setSpeedMenuOpen((open) => !open)}
              >
                {formatPlaybackRate(playbackRate)}
              </button>
              {speedMenuOpen ? (
                <div
                  id={speedOptionsId}
                  className="article-audio-speed-menu"
                  role="group"
                  aria-label="Playback speed"
                >
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      type="button"
                      className="article-audio-speed-option"
                      aria-pressed={rate === playbackRate}
                      key={rate}
                      onClick={() => choosePlaybackRate(rate)}
                    >
                      <span>{formatPlaybackRate(rate)}</span>
                      {rate === playbackRate ? (
                        <Check aria-hidden="true" size={13} strokeWidth={2} />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="article-audio-timeline">
              <span className="article-audio-time" aria-hidden="true">
                {formatPlaybackTime(currentTime)}
              </span>
              <input
                className="article-audio-seek"
                type="range"
                min="0"
                max={duration > 0 ? duration : 0}
                step="0.1"
                value={duration > 0 ? Math.min(currentTime, duration) : 0}
                disabled={duration <= 0}
                aria-label="Article audio position"
                aria-valuetext={`${formatPlaybackTime(currentTime)} of ${formatPlaybackTime(duration)}`}
                style={seekStyle}
                onChange={(event) => seek(Number(event.currentTarget.value))}
                onBlur={() => persistPosition(true)}
                onPointerUp={() => persistPosition(true)}
              />
              <span
                className="article-audio-time article-audio-duration"
                aria-hidden="true"
              >
                {formatPlaybackTime(duration)}
              </span>
            </div>
            {engine.message || engine.buffering ? (
              <span className="article-audio-playback-error" role="status">
                {engine.message || "Loading audio…"}
              </span>
            ) : null}
          </div>
        ) : null}
        {playerOpen ? <ListenFromHere /> : null}
      </div>
      {active && (viewState === "failed" || viewState === "unavailable" || viewState === "preparing") && message ? (
        <div className="article-audio-row" aria-live="polite">
          <span className="article-audio-message">{message}</span>
        </div>
      ) : null}
    </>
  );
}
