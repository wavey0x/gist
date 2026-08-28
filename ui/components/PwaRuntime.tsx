"use client";

import { useEffect } from "react";
import {
  initializeOfflineLibrary,
  reconcileIfStale,
  reconcileOfflineLibrary
} from "../lib/offline-library";
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
      }
    }

    function handleOnline() {
      void reconcileOfflineLibrary();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return null;
}
