"use client";

import type { PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, GripVertical, Pause, Play, X } from "lucide-react";
import {
  POSITION_KEY_PREFIX,
  openTrack,
  positionStorageKey,
  queueItemTrack,
  togglePlayback,
  useAudioEngine
} from "../lib/audio-engine";
import { formatPlaybackTime } from "../lib/audio-format";
import {
  addToQueue,
  getListenQueue,
  moveQueueItem,
  refreshListenQueue,
  removeFromQueue,
  restoreQueueItem,
  useListenQueue,
  type QueueItem
} from "../lib/listen-queue";
import { readRecentlyViewedGists } from "../lib/recent-viewed";
import { SwipeRow } from "./SwipeRow";

const COLLAPSED_COUNT = 4;
const ROW_HEIGHT = 50;
const UNDO_MS = 5000;
const SEED_KEY = "waveygist:listen-queue-seeded:v1";

type StoredPosition = { position: number; duration?: number };

function readPosition(gistId: string, revisionNumber: number): StoredPosition | null {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(positionStorageKey(gistId, revisionNumber)) ?? "null"
    ) as { position?: unknown; duration?: unknown } | null;
    return typeof stored?.position === "number"
      ? {
          position: stored.position,
          duration: typeof stored.duration === "number" ? stored.duration : undefined
        }
      : null;
  } catch {
    return null;
  }
}

// True when this device was partway through an older revision's recording.
function heardOlderRevision(gistId: string, revisionNumber: number) {
  const prefix = `${POSITION_KEY_PREFIX}${gistId}:`;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix) && Number(key.slice(prefix.length)) < revisionNumber) {
        return true;
      }
    }
  } catch {
    // Best effort.
  }
  return false;
}

// One-time carry-over of the old "Continue" list: audio this device had
// started becomes the first entries of the saved queue.
function seedFromLocalProgress() {
  try {
    if (window.localStorage.getItem(SEED_KEY)) {
      return;
    }
    window.localStorage.setItem(SEED_KEY, "1");
  } catch {
    return;
  }
  const started = readRecentlyViewedGists()
    .map((gist) => ({ gist, position: readPosition(gist.id, gist.revision_number) }))
    .filter((entry) => entry.position && entry.position.position > 0)
    .slice(0, 10);
  for (const { gist } of started) {
    addToQueue(gist.id, {
      title: gist.title?.trim() || gist.id,
      author_name: gist.author_name,
      revision_number: gist.revision_number,
      audio_url: `/api/gists/${gist.id}/revisions/${gist.revision_number}/narration/audio`
    });
  }
}

type Remaining = { seconds: number | null; fraction: number };

function remainingFor(
  item: QueueItem,
  live: { gistId: string; revisionNumber: number; currentTime: number; duration: number } | null
): Remaining {
  if (item.status !== "ready" || item.revision_number === null) {
    return { seconds: null, fraction: 0 };
  }
  const total = item.duration_ms ? item.duration_ms / 1000 : null;
  if (live && live.gistId === item.gist_id && live.revisionNumber === item.revision_number) {
    const duration = live.duration || total || 0;
    return {
      seconds: duration ? Math.max(0, duration - live.currentTime) : total,
      fraction: duration ? live.currentTime / duration : 0
    };
  }
  const stored = readPosition(item.gist_id, item.revision_number);
  const duration = total ?? stored?.duration ?? null;
  if (stored && duration) {
    return {
      seconds: Math.max(0, duration - stored.position),
      fraction: stored.position / duration
    };
  }
  return { seconds: duration, fraction: 0 };
}

function formatTotal(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function UpNext() {
  const queue = useListenQueue();
  const engine = useAudioEngine();
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [undo, setUndo] = useState<{ item: QueueItem; index: number } | null>(null);
  const [drag, setDrag] = useState<{
    gistId: string;
    pointerId: number;
    from: number;
    startY: number;
    offset: number;
  } | null>(null);
  const undoTimer = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
    void refreshListenQueue().then(() => {
      if (getListenQueue().available) {
        seedFromLocalProgress();
      }
    });
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        void refreshListenQueue();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    };
  }, []);

  const live = engine.track
    ? {
        gistId: engine.track.gistId,
        revisionNumber: engine.track.revisionNumber,
        currentTime: engine.currentTime,
        duration: engine.duration
      }
    : null;

  const rows = useMemo(
    () =>
      mounted
        ? queue.items.map((item) => ({
            item,
            remaining: remainingFor(item, live),
            updated:
              item.revision_number !== null &&
              item.revision_number > 1 &&
              !readPosition(item.gist_id, item.revision_number) &&
              heardOlderRevision(item.gist_id, item.revision_number)
          }))
        : [],
    // live changes every tick while playing; recompute with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, queue.items, live?.gistId, live?.revisionNumber, live?.currentTime, live?.duration]
  );

  // Hidden only when this account has no audio access at all.
  if (!mounted || (queue.loaded && !queue.available && !queue.error)) {
    return null;
  }

  const totalSeconds = rows.reduce((sum, row) => sum + (row.remaining.seconds ?? 0), 0);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);
  const hiddenCount = rows.length - visible.length;

  function remove(item: QueueItem) {
    const index = getListenQueue().items.findIndex((queued) => queued.gist_id === item.gist_id);
    removeFromQueue(item.gist_id);
    setUndo({ item, index });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
  }

  function play(item: QueueItem) {
    const isCurrent = engine.track?.gistId === item.gist_id && engine.opened;
    if (isCurrent && engine.track?.revisionNumber === item.revision_number) {
      togglePlayback();
      return;
    }
    const track = queueItemTrack(item);
    if (track) {
      openTrack(track);
    }
  }

  // Drag to reorder: the handle claims the pointer; rows have a fixed height,
  // so the target slot follows from the vertical distance travelled.
  const dragTarget = drag
    ? Math.min(
        visible.length - 1,
        Math.max(0, drag.from + Math.round(drag.offset / ROW_HEIGHT))
      )
    : -1;

  function startDrag(event: PointerEvent<HTMLButtonElement>, gistId: string, index: number) {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the drag ends when the pointer leaves the handle.
    }
    setDrag({ gistId, pointerId: event.pointerId, from: index, startY: event.clientY, offset: 0 });
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDrag({ ...drag, offset: event.clientY - drag.startY });
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!cancelled && dragTarget !== drag.from) {
      moveQueueItem(drag.gistId, dragTarget);
    }
    setDrag(null);
  }

  function shiftFor(index: number) {
    if (!drag || index === drag.from) return 0;
    if (drag.from < dragTarget && index > drag.from && index <= dragTarget) return -ROW_HEIGHT;
    if (drag.from > dragTarget && index < drag.from && index >= dragTarget) return ROW_HEIGHT;
    return 0;
  }

  return (
    <section className="up-next" aria-labelledby="up-next-heading">
      <header className="home-section-header">
        <h2 id="up-next-heading" className="home-section-title">
          Playlist
        </h2>
        {rows.length ? (
          <span className="home-section-meta">
            {rows.length}
            {totalSeconds > 0 ? ` · ${formatTotal(totalSeconds)}` : ""}
          </span>
        ) : null}
      </header>
      {rows.length ? (
        <ol className={`up-next-list${drag ? " up-next-list-dragging" : ""}`}>
          {visible.map(({ item, remaining, updated }, index) => {
            const isCurrent =
              engine.opened &&
              engine.track?.gistId === item.gist_id &&
              engine.track.revisionNumber === item.revision_number;
            const isPlaying = isCurrent && engine.playing;
            const dragging = drag?.gistId === item.gist_id;
            const transform = dragging
              ? `translateY(${drag.offset}px)`
              : shiftFor(index)
                ? `translateY(${shiftFor(index)}px)`
                : undefined;
            let detail: string;
            if (item.status === "pending") {
              detail = "Generating audio…";
            } else if (item.status === "none") {
              detail = "No audio";
            } else if (remaining.seconds !== null) {
              detail =
                remaining.fraction > 0
                  ? `${formatPlaybackTime(remaining.seconds)} left`
                  : formatPlaybackTime(remaining.seconds);
            } else {
              detail = "Ready";
            }
            return (
              <li
                key={item.gist_id}
                className={`up-next-item${dragging ? " up-next-item-dragging" : ""}${
                  isCurrent ? " up-next-item-current" : ""
                }`}
                style={transform ? { transform } : undefined}
              >
                <SwipeRow actionLabel="Remove" onAction={() => remove(item)}>
                  <div className="up-next-row">
                    <button
                      type="button"
                      className="up-next-play"
                      onClick={() => play(item)}
                      disabled={item.status !== "ready"}
                      aria-label={`${isPlaying ? "Pause" : "Play"} ${item.title}`}
                    >
                      <span className="up-next-play-icon" aria-hidden="true">
                        {isPlaying ? (
                          <Pause size={14} strokeWidth={2.2} />
                        ) : (
                          <Play size={14} strokeWidth={2.2} />
                        )}
                      </span>
                      <span className="up-next-text">
                        <span className="up-next-title">{item.title}</span>
                        <span className="up-next-detail">
                          {detail}
                          {updated ? <span className="up-next-tag">New version</span> : null}
                          {item.updating ? (
                            <span className="up-next-tag up-next-tag-muted">Update generating</span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <Link
                      className="up-next-open"
                      href={`/${item.gist_id}`}
                      prefetch={false}
                      aria-label={`Open ${item.title}`}
                      data-no-swipe
                    >
                      <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
                    </Link>
                    <button
                      type="button"
                      className="up-next-remove"
                      aria-label={`Remove ${item.title} from Playlist`}
                      onClick={() => remove(item)}
                      data-no-swipe
                    >
                      <X aria-hidden="true" size={15} strokeWidth={1.8} />
                    </button>
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        className="up-next-grip"
                        aria-label={`Reorder ${item.title}`}
                        data-no-swipe
                        onPointerDown={(event) => startDrag(event, item.gist_id, index)}
                        onPointerMove={moveDrag}
                        onPointerUp={(event) => endDrag(event, false)}
                        onPointerCancel={(event) => endDrag(event, true)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowUp" && index > 0) {
                            event.preventDefault();
                            moveQueueItem(item.gist_id, index - 1);
                          } else if (event.key === "ArrowDown" && index < rows.length - 1) {
                            event.preventDefault();
                            moveQueueItem(item.gist_id, index + 1);
                          }
                        }}
                      >
                        <GripVertical aria-hidden="true" size={16} strokeWidth={1.8} />
                      </button>
                    ) : null}
                  </div>
                  {remaining.fraction > 0 ? (
                    <span
                      className="up-next-progress"
                      style={{ width: `${Math.min(100, remaining.fraction * 100)}%` }}
                    />
                  ) : null}
                </SwipeRow>
              </li>
            );
          })}
        </ol>
      ) : null}
      {!rows.length && !undo ? (
        <p className="up-next-empty">
          {queue.error
            ? "Couldn't load your playlist."
            : queue.loaded || queue.available
              ? "Empty. Add audio from any article with the + list button."
              : "Loading…"}
        </p>
      ) : null}
      {hiddenCount > 0 || expanded ? (
        <button
          type="button"
          className="home-more-button"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show all ${rows.length}`}
        </button>
      ) : null}
      {undo ? (
        <div className="up-next-undo" role="status">
          <span>Removed “{undo.item.title}”</span>
          <button
            type="button"
            onClick={() => {
              restoreQueueItem(undo.item, undo.index);
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </section>
  );
}
