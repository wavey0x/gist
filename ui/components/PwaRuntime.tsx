"use client";

import { useEffect } from "react";
import {
  initializeOfflineLibrary,
  reconcileIfStale,
  reconcileOfflineLibrary
} from "../lib/offline-library";
import { syncThemeColor } from "../lib/theme-color";
import { registerServiceWorker } from "../lib/web-push";

export function PwaRuntime() {
  useEffect(() => {
    let active = true;

    void registerServiceWorker()
      .then(() => (active ? initializeOfflineLibrary() : undefined))
      .catch(() => undefined);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void reconcileIfStale();
        void navigator.clearAppBadge?.().catch(() => undefined);
      }
    }

    function handleOnline() {
      void reconcileOfflineLibrary();
    }

    void navigator.clearAppBadge?.().catch(() => undefined);
    syncThemeColor();
    const themeObserver = new MutationObserver(syncThemeColor);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      active = false;
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return null;
}
