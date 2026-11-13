"use client";

import { useEffect } from "react";
import { readReadingPosition, saveReadingPosition } from "../lib/reading-position";

type ReadingProgressProps = {
  gistId: string;
  revisionNumber: number;
};

const SAVE_DELAY_MS = 400;

function scrollableHeight() {
  return document.documentElement.scrollHeight - window.innerHeight;
}

// Remembers how far into an article the reader got and returns them there.
// It draws nothing: the library shows the saved position, and the scrollbar
// already says where you are on the page.
export function ReadingProgress({ gistId, revisionNumber }: ReadingProgressProps) {
  useEffect(() => {
    let saveTimeout: number | null = null;
    let userScrolled = false;

    const saved = readReadingPosition(gistId, revisionNumber);
    if (saved && !window.location.hash && window.scrollY === 0) {
      window.scrollTo(0, saved.fraction * scrollableHeight());
    }

    function handleScroll() {
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

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });
    return () => {
      if (saveTimeout !== null) window.clearTimeout(saveTimeout);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [gistId, revisionNumber]);

  return null;
}
