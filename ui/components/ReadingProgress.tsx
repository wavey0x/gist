"use client";

import { useEffect, useState } from "react";
import { readReadingPosition, saveReadingPosition } from "../lib/reading-position";

type ReadingProgressProps = {
  gistId: string;
  revisionNumber: number;
};

const SAVE_DELAY_MS = 400;

function scrollableHeight() {
  return document.documentElement.scrollHeight - window.innerHeight;
}

export function ReadingProgress({ gistId, revisionNumber }: ReadingProgressProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame: number | null = null;
    let saveTimeout: number | null = null;
    let userScrolled = false;

    const saved = readReadingPosition(gistId, revisionNumber);
    if (saved && !window.location.hash && window.scrollY === 0) {
      window.scrollTo(0, saved.fraction * scrollableHeight());
    }

    function measure() {
      frame = null;
      const height = scrollableHeight();
      setProgress(height > 0 ? Math.min(1, window.scrollY / height) : 0);
    }

    function handleScroll() {
      frame ??= window.requestAnimationFrame(measure);
      if (!userScrolled) {
        userScrolled = true;
        return;
      }
      if (saveTimeout !== null) {
        window.clearTimeout(saveTimeout);
      }
      saveTimeout = window.setTimeout(() => {
        const height = scrollableHeight();
        if (height > 0) {
          saveReadingPosition(gistId, revisionNumber, window.scrollY / height);
        }
      }, SAVE_DELAY_MS);
    }

    measure();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (saveTimeout !== null) window.clearTimeout(saveTimeout);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [gistId, revisionNumber]);

  return (
    <div className="reading-progress" aria-hidden="true">
      <span style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
