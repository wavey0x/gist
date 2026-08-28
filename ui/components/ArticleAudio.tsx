"use client";

import { Check, Pause, Play, Volume2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

type NarrationStatus = "pending" | "processing" | "ready" | "failed";

type NarrationPayload = {
  status: NarrationStatus;
  retryable: boolean;
  audio_url?: string;
};

type ArticleAudioProps = {
  active: boolean;
  children: ReactNode;
  gistId: string;
  revisionNumber: number;
};

type ViewState = "idle" | "preparing" | "ready" | "failed";

const POLL_DELAYS_MS = [1500, 2500, 4000, 6000, 8000];
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const PLAYBACK_RATE_STORAGE_KEY = "waveygist:audio-rate:v1";
const POSITION_SAVE_INTERVAL_SECONDS = 5;
const POSITION_END_THRESHOLD_SECONDS = 10;
const PLAYER_DOCK_TOP_PX = 10;

function positionStorageKey(gistId: string, revisionNumber: number) {
  return `waveygist:audio-position:v1:${gistId}:${revisionNumber}`;
}

function isPlaybackRate(value: number): value is (typeof PLAYBACK_RATES)[number] {
  return PLAYBACK_RATES.some((rate) => rate === value);
}

function formatPlaybackRate(rate: number) {
  return `${rate.toFixed(rate % 1 === 0 ? 0 : 2).replace(/0$/, "")}×`;
}

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function readStoredPlaybackRate() {
  try {
    const value = Number(window.localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY));
    return isPlaybackRate(value) ? value : 1;
  } catch {
    return 1;
  }
}

function isNarrationPayload(value: unknown): value is NarrationPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Partial<NarrationPayload>;
  return (
    (payload.status === "pending" ||
      payload.status === "processing" ||
      payload.status === "ready" ||
      payload.status === "failed") &&
    typeof payload.retryable === "boolean" &&
    (payload.audio_url === undefined || typeof payload.audio_url === "string") &&
    (payload.status !== "ready" || typeof payload.audio_url === "string")
  );
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

export function ArticleAudio({
  active,
  children,
  gistId,
  revisionNumber
}: ArticleAudioProps) {
  const [viewState, setViewState] = useState<ViewState>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [cachedAvailable, setCachedAvailable] = useState(false);
  const [message, setMessage] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSavedTimeRef = useRef(0);
  const restoredPositionKeyRef = useRef<string | null>(null);
  const speedControlRef = useRef<HTMLDivElement | null>(null);
  const speedButtonRef = useRef<HTMLButtonElement | null>(null);
  const dockSentinelRef = useRef<HTMLSpanElement | null>(null);
  const dockTopProbeRef = useRef<HTMLSpanElement | null>(null);
  const playerId = useId();
  const speedOptionsId = useId();
  const endpoint = `/api/gists/${encodeURIComponent(gistId)}/revisions/${revisionNumber}/narration`;
  const positionKey = positionStorageKey(gistId, revisionNumber);

  function cancelRequest() {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }

  function clearStoredPosition() {
    try {
      window.localStorage.removeItem(positionKey);
    } catch {
      // Playback bookmarks are best effort.
    }
  }

  function persistPosition(force = false) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.currentTime)) {
      return;
    }
    if (audio.currentTime <= 0.5) {
      clearStoredPosition();
      lastSavedTimeRef.current = 0;
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
      Math.abs(audio.currentTime - lastSavedTimeRef.current) <
        POSITION_SAVE_INTERVAL_SECONDS
    ) {
      return;
    }
    try {
      window.localStorage.setItem(
        positionKey,
        JSON.stringify({
          position: Math.round(audio.currentTime * 10) / 10
        })
      );
      lastSavedTimeRef.current = audio.currentTime;
    } catch {
      // Playback bookmarks are best effort.
    }
  }

  function restorePosition(audio: HTMLAudioElement) {
    if (restoredPositionKeyRef.current === positionKey) {
      return;
    }
    restoredPositionKeyRef.current = positionKey;
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(positionKey) ?? "null"
      ) as { position?: unknown } | null;
      const position = Number(stored?.position);
      if (
        Number.isFinite(position) &&
        position > 0 &&
        position < audio.duration - POSITION_END_THRESHOLD_SECONDS
      ) {
        audio.currentTime = position;
        setCurrentTime(position);
        lastSavedTimeRef.current = position;
      } else if (stored) {
        clearStoredPosition();
      }
    } catch {
      clearStoredPosition();
    }
  }

  function reset() {
    cancelRequest();
    audioRef.current?.pause();
    audioRef.current?.removeAttribute("src");
    audioRef.current?.load();
    setViewState("idle");
    setAudioUrl(null);
    setCachedAvailable(false);
    setMessage("");
    setRetryable(false);
    setPlayerOpen(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setSpeedMenuOpen(false);
    setDocked(false);
    lastSavedTimeRef.current = 0;
    restoredPositionKeyRef.current = null;
  }

  useEffect(() => {
    reset();
    return cancelRequest;
    // Reset only when the immutable article identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gistId, revisionNumber]);

  useEffect(() => {
    if (!active) {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    setPlaybackRate(readStoredPlaybackRate());
  }, []);

  useEffect(() => {
    const savePosition = () => persistPosition(true);
    window.addEventListener("pagehide", savePosition);
    return () => {
      savePosition();
      window.removeEventListener("pagehide", savePosition);
    };
    // Persist against the immutable revision key captured by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionKey]);

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
      active &&
      (viewState === "preparing" ||
        (viewState === "ready" && playerOpen && Boolean(audioUrl)));
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
    setCachedAvailable(true);
    setAudioUrl(payload.audio_url ?? null);
    setViewState("ready");
    setPlayerOpen(true);
    setMessage("");
    setRetryable(false);
  }

  function showFailure(response: Response | null, payload?: NarrationPayload | null) {
    setViewState("failed");
    setPlayerOpen(false);
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

  async function poll(controller: AbortController) {
    let attempt = 0;
    while (!controller.signal.aborted) {
      await wait(
        POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)],
        controller.signal
      );
      const response = await fetch(endpoint, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload) {
        showFailure(response, payload);
        return;
      }
      if (payload.status === "ready") {
        showReady(payload);
        return;
      }
      if (payload.status === "failed") {
        showFailure(response, payload);
        return;
      }
      attempt += 1;
    }
  }

  async function start() {
    if (!active || controllerRef.current) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setViewState("preparing");
    setPlayerOpen(false);
    setMessage("Preparing article audio…");
    setRetryable(false);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: "{}",
        signal: controller.signal
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload) {
        showFailure(response, payload);
        return;
      }
      if (payload.status === "ready") {
        showReady(payload);
        return;
      }
      if (payload.status === "failed") {
        showFailure(response, payload);
        return;
      }
      await poll(controller);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        showFailure(null);
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }

  useEffect(() => {
    if (!active || typeof window === "undefined") {
      return;
    }
    const revealPlayer =
      new URL(window.location.href).searchParams.get("audio") === "ready";
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        const payload = await readPayload(response);
        if (response.ok && payload?.status === "ready") {
          setCachedAvailable(true);
          if (revealPlayer) {
            showReady(payload);
          } else {
            setAudioUrl(payload.audio_url ?? null);
            setViewState("ready");
            setMessage("");
            setRetryable(false);
          }
        }
      } catch (error) {
        if (
          revealPlayer &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setMessage("");
        }
      }
    })();
    return () => controller.abort();
    // The exact article identity is represented by endpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, endpoint]);

  function togglePlayer() {
    if (viewState !== "ready" || !audioUrl) {
      void start();
      return;
    }
    if (playerOpen) {
      audioRef.current?.pause();
      persistPosition(true);
      setSpeedMenuOpen(false);
      setPlayerOpen(false);
      return;
    }
    setMessage("");
    setPlayerOpen(true);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (!audio.paused) {
      audio.pause();
      persistPosition(true);
      return;
    }
    audio.playbackRate = playbackRate;
    try {
      await audio.play();
      setMessage("");
    } catch {
      setMessage("Audio could not be played.");
    }
  }

  function handleLoadedMetadata(audio: HTMLAudioElement) {
    const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
    setDuration(nextDuration);
    audio.playbackRate = playbackRate;
    restorePosition(audio);
  }

  function handleTimeUpdate(audio: HTMLAudioElement) {
    setCurrentTime(audio.currentTime);
    persistPosition();
  }

  function seek(value: string) {
    const audio = audioRef.current;
    const nextTime = Number(value);
    if (!audio || !Number.isFinite(nextTime)) {
      return;
    }
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function selectPlaybackRate(rate: (typeof PLAYBACK_RATES)[number]) {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
    try {
      window.localStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, String(rate));
    } catch {
      // Playback preferences are best effort.
    }
    setSpeedMenuOpen(false);
    window.requestAnimationFrame(() => speedButtonRef.current?.focus());
  }

  const seekProgress =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const seekStyle = {
    "--audio-progress": `${seekProgress}%`
  } as CSSProperties;

  const showButton =
    active &&
    (viewState === "idle" ||
      viewState === "preparing" ||
      viewState === "ready" ||
      retryable);
  let buttonLabel = "Listen to article";
  let buttonTitle = "Listen";
  if (viewState === "preparing") {
    buttonLabel = "Preparing article audio";
    buttonTitle = "Preparing audio";
  } else if (retryable) {
    buttonLabel = "Retry article audio";
    buttonTitle = "Retry audio";
  } else if (cachedAvailable) {
    buttonLabel = playerOpen ? "Hide article audio player" : "Show article audio player";
    buttonTitle = playerOpen ? "Hide audio player" : "Audio ready — show player";
  }

  return (
    <>
      <div className="article-audio-toolbar-group">
        <div className="toolbar" aria-label="Display controls">
          {showButton ? (
            <button
              type="button"
              className={
                cachedAvailable && viewState === "ready" && !playerOpen
                  ? "icon-button article-audio-button-ready"
                  : "icon-button"
              }
              aria-busy={viewState === "preparing"}
              aria-controls={viewState === "ready" ? playerId : undefined}
              aria-expanded={viewState === "ready" ? playerOpen : undefined}
              aria-label={buttonLabel}
              aria-pressed={viewState === "ready" ? playerOpen : undefined}
              title={buttonTitle}
              disabled={viewState === "preparing"}
              onClick={togglePlayer}
            >
              {viewState === "preparing" ? (
                <span className="article-audio-spinner" aria-hidden="true" />
              ) : (
                <Volume2 aria-hidden="true" size={18} strokeWidth={1.8} />
              )}
            </button>
          ) : null}
          {children}
        </div>
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
      {active && viewState === "preparing" && message ? (
        <div
          className={`article-audio-overlay article-audio-preparing-overlay${
            docked ? " article-audio-overlay-docked" : ""
          }`}
          role="status"
        >
          {message}
        </div>
      ) : null}
      {active && audioUrl ? (
        <audio
          ref={audioRef}
          className="article-audio-engine"
          preload="metadata"
          src={audioUrl}
          onLoadedMetadata={(event) => handleLoadedMetadata(event.currentTarget)}
          onDurationChange={(event) =>
            setDuration(
              Number.isFinite(event.currentTarget.duration)
                ? event.currentTarget.duration
                : 0
            )
          }
          onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            clearStoredPosition();
          }}
          aria-hidden="true"
        />
      ) : null}
      {active && viewState === "ready" && audioUrl && playerOpen ? (
        <div
          id={playerId}
          className={`article-audio-overlay${
            docked ? " article-audio-overlay-docked" : ""
          }`}
          role="group"
          aria-label="Article audio player"
        >
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
            onChange={(event) => seek(event.currentTarget.value)}
            onBlur={() => persistPosition(true)}
            onPointerUp={() => persistPosition(true)}
          />
          <span className="article-audio-time article-audio-duration" aria-hidden="true">
            {formatPlaybackTime(duration)}
          </span>
          <button
            type="button"
            className="article-audio-play-button"
            aria-label={playing ? "Pause article audio" : "Play article audio"}
            title={playing ? "Pause" : "Play"}
            onClick={() => void togglePlayback()}
          >
            {playing ? (
              <Pause aria-hidden="true" size={15} strokeWidth={2} />
            ) : (
              <Play aria-hidden="true" size={15} strokeWidth={2} />
            )}
          </button>
          <div className="article-audio-speed-control" ref={speedControlRef}>
            <button
              ref={speedButtonRef}
              type="button"
              className="article-audio-speed-button"
              aria-label={`Playback speed ${formatPlaybackRate(playbackRate)}`}
              aria-controls={speedMenuOpen ? speedOptionsId : undefined}
              aria-expanded={speedMenuOpen}
              title="Playback speed"
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
                    onClick={() => selectPlaybackRate(rate)}
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
          {message ? (
            <span className="article-audio-playback-error" role="status">
              {message}
            </span>
          ) : null}
        </div>
      ) : null}
      {active && viewState === "failed" && message ? (
        <div className="article-audio-row" aria-live="polite">
          <span className="article-audio-message">{message}</span>
        </div>
      ) : null}
    </>
  );
}
