"use client";

import { Check, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isStandaloneDisplay } from "../lib/web-push";

const NOTICE_DURATION_MS = 1600;

function errorWasShareCancellation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function StandaloneAppControls() {
  const [isStandalone, setIsStandalone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setIsStandalone(isStandaloneDisplay());
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

    return () => document.documentElement.classList.remove("standalone-app");
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
      {notice ? (
        <div className="standalone-action-notice" role="status">
          {notice}
        </div>
      ) : null}
    </>
  );
}
