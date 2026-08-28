"use client";

import { useEffect, useState } from "react";
import { OFFLINE_CONNECTIVITY_EVENT } from "../lib/offline-library";

export function ConnectivityIndicator() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(navigator.onLine === false);

    function handleOffline() {
      setOffline(true);
    }

    function handleOnline() {
      setOffline(false);
    }

    function handleConnectivity(event: Event) {
      const detail = (event as CustomEvent<{ online?: unknown }>).detail;
      if (detail?.online === true) {
        setOffline(false);
      } else if (detail?.online === false) {
        setOffline(true);
      }
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener(OFFLINE_CONNECTIVITY_EVENT, handleConnectivity);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(
        OFFLINE_CONNECTIVITY_EVENT,
        handleConnectivity
      );
    };
  }, []);

  return offline ? (
    <span className="app-offline-status" role="status">
      Offline
    </span>
  ) : null;
}
