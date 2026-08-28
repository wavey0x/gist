"use client";

import { Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

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
  const controllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playWhenReadyRef = useRef(false);
  const endpoint = `/api/gists/${encodeURIComponent(gistId)}/revisions/${revisionNumber}/narration`;

  function cancelRequest() {
    controllerRef.current?.abort();
    controllerRef.current = null;
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
    playWhenReadyRef.current = false;
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
    if (!audioUrl || !playWhenReadyRef.current) {
      return;
    }
    playWhenReadyRef.current = false;
    void audioRef.current?.play().catch(() => undefined);
  }, [audioUrl]);

  async function readPayload(response: Response) {
    const payload: unknown = await response.json().catch(() => null);
    return isNarrationPayload(payload) ? payload : null;
  }

  function showReady(payload: NarrationPayload, playNow: boolean) {
    playWhenReadyRef.current = playNow;
    setCachedAvailable(true);
    setAudioUrl(payload.audio_url ?? null);
    setViewState("ready");
    setMessage(playNow ? "" : "Ready — tap to play");
    setRetryable(false);
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
        showReady(payload, false);
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
        showReady(payload, true);
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
            showReady(payload, false);
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

  const showButton =
    active &&
    (viewState === "idle" || viewState === "preparing" || retryable);
  let buttonLabel = "Listen to article";
  let buttonTitle = "Listen";
  if (viewState === "preparing") {
    buttonLabel = "Preparing article audio";
    buttonTitle = "Preparing audio";
  } else if (retryable) {
    buttonLabel = "Retry article audio";
    buttonTitle = "Retry audio";
  } else if (cachedAvailable) {
    buttonLabel = "Listen to available article audio";
    buttonTitle = "Audio ready — listen";
  }

  return (
    <>
      <div className="article-audio-toolbar-group">
        <div className="toolbar" aria-label="Display controls">
          {showButton ? (
            <button
              type="button"
              className={
                cachedAvailable && viewState === "idle"
                  ? "icon-button article-audio-button-ready"
                  : "icon-button"
              }
              aria-busy={viewState === "preparing"}
              aria-label={buttonLabel}
              title={buttonTitle}
              disabled={viewState === "preparing"}
              onClick={() => void start()}
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
        {viewState === "preparing" && message ? (
          <span
            className="article-audio-preparing-message"
            role="status"
          >
            {message}
          </span>
        ) : null}
      </div>
      {active && viewState !== "idle" && viewState !== "preparing" ? (
        <div className="article-audio-row" aria-live="polite">
          {viewState === "ready" && audioUrl ? (
            <audio
              ref={audioRef}
              controls
              preload="metadata"
              src={audioUrl}
              aria-label="Article audio"
            />
          ) : null}
          {message ? <span className="article-audio-message">{message}</span> : null}
        </div>
      ) : null}
    </>
  );
}
