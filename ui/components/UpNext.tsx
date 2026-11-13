"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GripVertical, Pause, Play, X } from "lucide-react";
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
// Must match .up-next-row in app.css.
const ROW_HEIGHT = 56;
// A press that moves less than this is a tap, which opens the reorder menu.
const TAP_SLOP = 5;
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
    moved: boolean;
  } | null>(null);
  // Dragging alone leaves some people unable to reorder, so a tap on the handle
  // offers the same moves as a menu.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const grips = useRef(new Map<string, HTMLButtonElement>());
  const suppressClick = useRef(false);
  const undoTimer = useRef<number | null>(null);

  function closeMenu(restoreFocus = false) {
    const gistId = menuFor;
    setMenuFor(null);
    if (restoreFocus && gistId) {
      grips.current.get(gistId)?.focus({ preventScroll: true });
    }
  }

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

  useEffect(() => {
    if (!menuFor) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    function close(event: globalThis.PointerEvent) {
      if (event.target instanceof Node &&
          !menuRef.current?.contains(event.target) &&
          !grips.current.get(menuFor!)?.contains(event.target)) {
        setMenuFor(null);
      }
    }
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
    };
  }, [menuFor]);

  function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      // Returning to the handle before the default Tab action keeps navigation
      // in the row rather than on a menu item that is about to be removed.
      closeMenu(true);
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)"
    ));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown": next = (index + 1) % items.length; break;
      case "ArrowUp": next = (index - 1 + items.length) % items.length; break;
      case "Home": next = 0; break;
      case "End": next = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

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

  // The playlist only takes up room when there is something in it. If the
  // server can't be reached, the saved copy on this device still shows.
  if (!mounted || (!rows.length && !undo)) {
    return null;
  }

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
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    suppressClick.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the drag ends when the pointer leaves the handle.
    }
    setDrag({ gistId, pointerId: event.pointerId, from: index, startY: event.clientY, offset: 0, moved: false });
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const offset = event.clientY - drag.startY;
    const moved = drag.moved || Math.abs(offset) >= TAP_SLOP;
    if (moved) setMenuFor(null);
    setDrag({ ...drag, offset, moved });
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClick.current = cancelled || drag.moved;
    if (!cancelled && drag.moved && dragTarget !== drag.from) {
      moveQueueItem(drag.gistId, dragTarget);
    }
    setDrag(null);
  }

  function moveFromMenu(gistId: string, target: number) {
    // Keep the moved row visible when moving past the collapsed list boundary.
    if (target >= visible.length) setExpanded(true);
    moveQueueItem(gistId, target);
    setMenuFor(null);
    requestAnimationFrame(() => grips.current.get(gistId)?.focus({ preventScroll: true }));
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
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        className="up-next-grip"
                        aria-label={`Reorder ${item.title}`}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === item.gist_id}
                        aria-controls={menuFor === item.gist_id ? `queue-reorder-${item.gist_id}` : undefined}
                        ref={(node) => {
                          if (node) grips.current.set(item.gist_id, node);
                          else grips.current.delete(item.gist_id);
                        }}
                        data-no-swipe
                        onPointerDown={(event) => startDrag(event, item.gist_id, index)}
                        onPointerMove={moveDrag}
                        onPointerUp={(event) => endDrag(event, false)}
                        onPointerCancel={(event) => endDrag(event, true)}
                        onClick={(event) => {
                          if (suppressClick.current && event.detail > 0) {
                            suppressClick.current = false;
                            return;
                          }
                          suppressClick.current = false;
                          if (menuFor === item.gist_id) closeMenu(true);
                          else setMenuFor(item.gist_id);
                        }}
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
                    </button>
                    <Link className="up-next-text" href={`/${item.gist_id}`} prefetch={false}>
                      <span className="up-next-title">{item.title}</span>
                      <span className="up-next-detail">
                        {detail}
                        {updated ? <span className="up-next-tag">New version</span> : null}
                        {item.updating ? (
                          <span className="up-next-tag up-next-tag-muted">Update generating</span>
                        ) : null}
                      </span>
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
                  </div>
                  {remaining.fraction > 0 ? (
                    <span
                      className="up-next-progress"
                      style={{ width: `${Math.min(100, remaining.fraction * 100)}%` }}
                    />
                  ) : null}
                </SwipeRow>
                {menuFor === item.gist_id ? (
                  <div
                    id={`queue-reorder-${item.gist_id}`}
                    ref={menuRef}
                    className="up-next-menu popover"
                    role="menu"
                    aria-label={`Move ${item.title}`}
                    onKeyDown={navigateMenu}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className="popover-item"
                      disabled={index === 0}
                      onClick={() => moveFromMenu(item.gist_id, 0)}
                    >
                      Move to top
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className="popover-item"
                      disabled={index === 0}
                      onClick={() => moveFromMenu(item.gist_id, index - 1)}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className="popover-item"
                      disabled={index === rows.length - 1}
                      onClick={() => moveFromMenu(item.gist_id, index + 1)}
                    >
                      Move down
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
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
