"use client";

import { Check, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isStandaloneDisplay } from "../lib/web-push";

const PULL_START_SLOP_PX = 8;
const PULL_VERTICAL_BIAS = 1.25;
const PULL_REFRESH_THRESHOLD_PX = 58;
const PULL_MAX_DISTANCE_PX = 96;
const PULL_RESISTANCE_PX = 104;
const NOTICE_DURATION_MS = 1600;
const PULL_EXCLUDED_TARGETS = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable='true']",
  "[data-pull-refresh='ignore']",
  ".history-menu",
  ".mermaid-panzoom",
  ".raw-markdown",
  ".diff-table-scroll"
].join(",");

type PullIndicatorState =
  | "idle"
  | "pulling"
  | "ready"
  | "settling"
  | "refreshing";

type PullGesture = {
  identifier: number;
  startX: number;
  startY: number;
  isPulling: boolean;
};

function trackedTouch(touches: TouchList, identifier: number) {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === identifier) {
      return touch;
    }
  }
  return null;
}

function pullDistance(deltaY: number) {
  const positiveDelta = Math.max(0, deltaY);
  return (
    PULL_MAX_DISTANCE_PX *
    (1 - Math.exp(-positiveDelta / PULL_RESISTANCE_PX))
  );
}

function pullTargetIsExcluded(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(PULL_EXCLUDED_TARGETS));
}

function errorWasShareCancellation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function isLegacyAccountLaunch() {
  if (window.location.pathname !== "/me") {
    return false;
  }
  const navigation = performance.getEntriesByType(
    "navigation"
  )[0] as PerformanceNavigationTiming | undefined;
  if (!navigation || navigation.type !== "navigate") {
    return false;
  }
  try {
    return new URL(navigation.name).pathname === "/me";
  } catch {
    return false;
  }
}

export function StandaloneAppControls() {
  const [isStandalone, setIsStandalone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const noticeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const standalone = isStandaloneDisplay();
    // Early installs retained the former /me manifest start URL on iOS.
    if (standalone && isLegacyAccountLaunch()) {
      window.location.replace("/");
      return;
    }
    setIsStandalone(standalone);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimeoutRef.current !== null) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isStandalone) {
      return undefined;
    }

    document.documentElement.classList.add("standalone-app");

    let gesture: PullGesture | null = null;
    let currentDistance = 0;
    let pendingDistance = 0;
    let pendingState: PullIndicatorState = "idle";
    let indicatorFrame: number | null = null;
    let reloadFrame: number | null = null;
    let isRefreshing = false;

    function renderIndicator(
      distance: number,
      state: PullIndicatorState
    ) {
      currentDistance = distance;
      pendingDistance = distance;
      pendingState = state;
      if (indicatorFrame !== null) {
        return;
      }

      indicatorFrame = window.requestAnimationFrame(() => {
        indicatorFrame = null;
        const indicator = indicatorRef.current;
        if (!indicator) {
          return;
        }

        const progress = Math.min(
          1,
          pendingDistance / PULL_REFRESH_THRESHOLD_PX
        );
        indicator.dataset.state = pendingState;
        indicator.style.setProperty(
          "--pull-refresh-distance",
          `${pendingDistance.toFixed(2)}px`
        );
        indicator.style.setProperty(
          "--pull-refresh-opacity",
          `${Math.min(1, pendingDistance / 24).toFixed(3)}`
        );
        indicator.style.setProperty(
          "--pull-refresh-scale",
          `${(0.84 + progress * 0.16).toFixed(3)}`
        );
        indicator.style.setProperty(
          "--pull-refresh-rotation",
          `${Math.round(progress * 210)}deg`
        );
      });
    }

    function settleIndicator() {
      renderIndicator(0, "settling");
    }

    function cancelGesture() {
      const wasPulling = gesture?.isPulling === true;
      gesture = null;
      if (wasPulling) {
        settleIndicator();
      }
    }

    function beginRefresh() {
      if (isRefreshing) {
        return;
      }
      isRefreshing = true;
      gesture = null;
      renderIndicator(PULL_REFRESH_THRESHOLD_PX, "refreshing");
      reloadFrame = window.requestAnimationFrame(() => {
        reloadFrame = window.requestAnimationFrame(() => {
          window.location.reload();
        });
      });
    }

    function handleTouchStart(event: TouchEvent) {
      if (
        isRefreshing ||
        event.touches.length !== 1 ||
        window.scrollY > 0 ||
        pullTargetIsExcluded(event.target)
      ) {
        cancelGesture();
        return;
      }

      const touch = event.touches.item(0);
      if (!touch) {
        return;
      }
      gesture = {
        identifier: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        isPulling: false
      };
    }

    function handleTouchMove(event: TouchEvent) {
      if (!gesture || isRefreshing || event.touches.length !== 1) {
        cancelGesture();
        return;
      }

      const touch = trackedTouch(event.touches, gesture.identifier);
      if (!touch) {
        cancelGesture();
        return;
      }

      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;

      if (!gesture.isPulling) {
        if (
          Math.abs(deltaX) < PULL_START_SLOP_PX &&
          Math.abs(deltaY) < PULL_START_SLOP_PX
        ) {
          return;
        }
        if (
          deltaY <= 0 ||
          deltaY < Math.abs(deltaX) * PULL_VERTICAL_BIAS ||
          window.scrollY > 0
        ) {
          cancelGesture();
          return;
        }
        gesture.isPulling = true;
      }

      if (window.scrollY > 0 || deltaY <= 0) {
        cancelGesture();
        return;
      }

      event.preventDefault();
      const distance = pullDistance(deltaY);
      renderIndicator(
        distance,
        distance >= PULL_REFRESH_THRESHOLD_PX ? "ready" : "pulling"
      );
    }

    function handleTouchEnd(event: TouchEvent) {
      if (
        !gesture ||
        !trackedTouch(event.changedTouches, gesture.identifier)
      ) {
        return;
      }

      if (
        gesture.isPulling &&
        currentDistance >= PULL_REFRESH_THRESHOLD_PX
      ) {
        beginRefresh();
      } else {
        cancelGesture();
      }
    }

    function handleTouchCancel() {
      cancelGesture();
    }

    window.addEventListener("touchstart", handleTouchStart, {
      capture: true,
      passive: true
    });
    window.addEventListener("touchmove", handleTouchMove, {
      capture: true,
      passive: false
    });
    window.addEventListener("touchend", handleTouchEnd, {
      capture: true,
      passive: true
    });
    window.addEventListener("touchcancel", handleTouchCancel, {
      capture: true,
      passive: true
    });

    return () => {
      document.documentElement.classList.remove("standalone-app");
      window.removeEventListener("touchstart", handleTouchStart, true);
      window.removeEventListener("touchmove", handleTouchMove, true);
      window.removeEventListener("touchend", handleTouchEnd, true);
      window.removeEventListener("touchcancel", handleTouchCancel, true);
      if (indicatorFrame !== null) {
        window.cancelAnimationFrame(indicatorFrame);
      }
      if (reloadFrame !== null) {
        window.cancelAnimationFrame(reloadFrame);
      }
    };
  }, [isStandalone]);

  function showNotice(message: string) {
    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    setNotice(message);
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimeoutRef.current = null;
    }, NOTICE_DURATION_MS);
  }

  async function copyCurrentUrl(url: string) {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard is unavailable");
    }
    await navigator.clipboard.writeText(url);
    showNotice("Link copied");
  }

  async function handleShare() {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: document.title,
          url
        });
        return;
      } catch (error) {
        if (errorWasShareCancellation(error)) {
          return;
        }
      }
    }

    try {
      await copyCurrentUrl(url);
    } catch {
      showNotice("Unable to share");
    }
  }

  return (
    <>
      <button
        type="button"
        className="icon-button standalone-share-button"
        aria-label={notice === "Link copied" ? "Link copied" : "Share this page"}
        title="Share"
        onClick={handleShare}
      >
        {notice === "Link copied" ? (
          <Check aria-hidden="true" size={16} strokeWidth={2} />
        ) : (
          <Share2 aria-hidden="true" size={16} strokeWidth={1.9} />
        )}
      </button>
      <div
        ref={indicatorRef}
        className="pull-refresh-indicator"
        data-state="idle"
        aria-hidden="true"
      >
        <RefreshCw size={17} strokeWidth={2} />
      </div>
      {notice ? (
        <div className="standalone-action-notice" role="status">
          {notice}
        </div>
      ) : null}
    </>
  );
}
