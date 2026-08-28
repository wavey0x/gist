"use client";

import { useEffect } from "react";
import { OFFLINE_IDENTITY_STORAGE_KEY } from "../lib/offline-library";

type OfflineIdentity = {
  name: string;
  avatarUrl: string | null;
  canGenerateAudio: boolean;
};

export function OfflineIdentityRecorder({
  identity
}: {
  identity: OfflineIdentity | null;
}) {
  useEffect(() => {
    if (!identity) {
      return;
    }
    try {
      localStorage.setItem(
        OFFLINE_IDENTITY_STORAGE_KEY,
        JSON.stringify(identity)
      );
    } catch {
      // The offline header can gracefully omit identity when storage is blocked.
    }
  }, [identity]);

  return null;
}
