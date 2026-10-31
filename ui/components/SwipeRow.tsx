"use client";

import type { PointerEvent, ReactNode } from "react";
import { useRef, useState } from "react";

type SwipeRowProps = {
  children: ReactNode;
  actionLabel: string;
  onAction: () => void;
  className?: string;
  style?: React.CSSProperties;
};

const START_DISTANCE = 10;
const MIN_TRIGGER = 72;

// Swipe left to reveal and trigger a destructive action. Vertical scrolling is
// left to the browser; only clearly horizontal drags are claimed.
export function SwipeRow({
  children,
  actionLabel,
  onAction,
  className,
  style
}: SwipeRowProps) {
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    swiping: boolean;
    width: number;
  } | null>(null);
  const suppressClick = useRef(false);

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
      swiping: false,
      width: event.currentTarget.getBoundingClientRect().width
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
      if (dx > -START_DISTANCE || Math.abs(dx) < Math.abs(dy)) {
        return;
      }
      current.swiping = true;
      suppressClick.current = true;
      setSettling(false);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety; the gesture still works without it.
      }
    }
    setOffset(Math.min(0, dx));
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = gesture.current;
    gesture.current = null;
    if (!current || current.id !== event.pointerId || !current.swiping) {
      return;
    }
    const trigger = Math.max(MIN_TRIGGER, current.width * 0.3);
    const fire = !cancelled && -offset >= trigger;
    setSettling(true);
    setOffset(0);
    if (fire) {
      onAction();
    }
  }

  return (
    <div
      className={`swipe-row${className ? ` ${className}` : ""}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <div
        className="swipe-row-action"
        aria-hidden="true"
        style={{ opacity: offset < 0 ? Math.min(1, -offset / MIN_TRIGGER) : 0 }}
      >
        {actionLabel}
      </div>
      <div
        className={`swipe-row-content${settling ? " swipe-row-settling" : ""}`}
        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
        onTransitionEnd={() => setSettling(false)}
      >
        {children}
      </div>
    </div>
  );
}
