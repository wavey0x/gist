"use client";

import type { PointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type SwipeRowProps = {
  children: ReactNode;
  actionLabel: string;
  actionAriaLabel?: string;
  onAction: () => void;
  className?: string;
  style?: React.CSSProperties;
};

const START_DISTANCE = 10;
const SETTLE_MS = 240;
const FLING_SPEED = 0.35; // px per ms
const OVERDRAG = 0.2;

// Swipe left to reveal a destructive action, then tap it to confirm. A swipe
// alone never runs the action. Vertical scrolling is left to the browser; only
// clearly horizontal drags are claimed. The row follows the finger by writing
// its transform directly, so a drag never waits on a React render.
export function SwipeRow({
  children,
  actionLabel,
  actionAriaLabel,
  onAction,
  className,
  style
}: SwipeRowProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const position = useRef(0);
  const openRef = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    base: number;
    reveal: number;
    swiping: boolean;
    lastX: number;
    lastTime: number;
    speed: number;
  } | null>(null);
  const suppressClick = useRef(false);

  const place = useCallback((x: number) => {
    position.current = x;
    const content = contentRef.current;
    if (content) {
      content.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
    }
  }, []);

  const settle = useCallback(
    (toOpen: boolean) => {
      const root = rootRef.current;
      const content = contentRef.current;
      if (!root || !content) {
        return;
      }
      const reveal = actionRef.current?.querySelector("span")?.offsetWidth ?? 88;
      if (settleTimer.current !== null) {
        window.clearTimeout(settleTimer.current);
      }
      root.classList.add("swipe-row-active");
      content.classList.remove("swipe-row-dragging");
      content.classList.add("swipe-row-settling");
      place(toOpen ? -reveal : 0);
      openRef.current = toOpen;
      setOpen(toOpen);
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = null;
        content.classList.remove("swipe-row-settling");
        if (!openRef.current) {
          root.classList.remove("swipe-row-active");
        }
      }, SETTLE_MS);
    },
    [place]
  );

  useEffect(
    () => () => {
      if (settleTimer.current !== null) {
        window.clearTimeout(settleTimer.current);
      }
    },
    []
  );

  // An open row closes as soon as attention moves anywhere else.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        settle(false);
      }
    };
    const close = () => settle(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        settle(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, settle]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest("[data-no-swipe]")) {
      return;
    }
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      base: position.current,
      reveal: actionRef.current?.querySelector("span")?.offsetWidth ?? 88,
      swiping: false,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      speed: 0
    };
    suppressClick.current = false;
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.swiping) {
      if (Math.abs(dy) > START_DISTANCE && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      if (Math.abs(dx) < START_DISTANCE || Math.abs(dx) < Math.abs(dy)) {
        return;
      }
      // A closed row only opens leftward; an open row can be pushed back.
      if (dx > 0 && current.base === 0) {
        return;
      }
      current.swiping = true;
      // Start from where the finger is now, so the row does not jump.
      current.x = event.clientX;
      suppressClick.current = true;
      if (settleTimer.current !== null) {
        window.clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
      rootRef.current?.classList.add("swipe-row-active");
      contentRef.current?.classList.remove("swipe-row-settling");
      contentRef.current?.classList.add("swipe-row-dragging");
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety; the gesture still works without it.
      }
    }
    const elapsed = event.timeStamp - current.lastTime;
    if (elapsed > 0) {
      const speed = (event.clientX - current.lastX) / elapsed;
      current.speed = current.speed * 0.4 + speed * 0.6;
      current.lastX = event.clientX;
      current.lastTime = event.timeStamp;
    }
    let x = Math.min(0, current.base + (event.clientX - current.x));
    if (x < -current.reveal) {
      // Past the button the row resists, so it reads as a firm stop.
      x = -current.reveal + (x + current.reveal) * OVERDRAG;
    }
    place(x);
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = gesture.current;
    gesture.current = null;
    if (!current || current.id !== event.pointerId || !current.swiping) {
      return;
    }
    if (cancelled) {
      settle(current.base !== 0);
      return;
    }
    const stale = event.timeStamp - current.lastTime > 80;
    const speed = stale ? 0 : current.speed;
    if (speed <= -FLING_SPEED) {
      settle(true);
    } else if (speed >= FLING_SPEED) {
      settle(false);
    } else {
      settle(-position.current > current.reveal / 2);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`swipe-row${className ? ` ${className}` : ""}`}
      style={style}
      data-swipe-open={open ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest(".swipe-row-action")) {
          return;
        }
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
          return;
        }
        // Tapping an open row puts it away instead of following its link.
        if (openRef.current) {
          event.preventDefault();
          event.stopPropagation();
          settle(false);
        }
      }}
    >
      <button
        ref={actionRef}
        type="button"
        className="swipe-row-action"
        aria-label={actionAriaLabel ?? actionLabel}
        aria-hidden={open ? undefined : true}
        tabIndex={open ? 0 : -1}
        data-no-swipe
        onClick={() => {
          settle(false);
          onAction();
        }}
      >
        <span>{actionLabel}</span>
      </button>
      <div ref={contentRef} className="swipe-row-content">
        {children}
      </div>
    </div>
  );
}
