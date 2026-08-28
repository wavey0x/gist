"use client";

import { useCallback, useEffect, useId, useState } from "react";
import {
  clearOfflineContent,
  DEFAULT_OFFLINE_BYTE_LIMIT,
  getOfflineLibrarySummary,
  OFFLINE_BYTE_LIMITS,
  OFFLINE_LIBRARY_EVENT,
  setOfflineByteLimit,
  setOfflineLibraryEnabled,
  type OfflineLibrarySummary
} from "../lib/offline-library";
import { ConfirmModal } from "./ConfirmModal";

const EMPTY_SUMMARY: OfflineLibrarySummary = {
  supported: true,
  enabled: true,
  byteLimit: DEFAULT_OFFLINE_BYTE_LIMIT,
  byteSize: 0,
  availableCount: 0,
  targetCount: 0,
  lastReconciledAt: null,
  syncing: false,
  completed: 0,
  total: 0,
  storageFull: false,
  error: null
};

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(0, Math.round(value / 1024))} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${Math.round(value / (1024 * 1024))} MB`;
  }
  const gigabytes = value / (1024 * 1024 * 1024);
  return `${gigabytes.toFixed(gigabytes < 10 ? 1 : 0)} GB`;
}

function limitLabel(value: number) {
  return value === OFFLINE_BYTE_LIMITS[2] ? "1 GB" : `${value / (1024 * 1024)} MB`;
}

function relativeUpdated(value: string | null) {
  if (!value) {
    return null;
  }
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return "Updated recently";
  }
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) {
    return "Updated just now";
  }
  if (minutes < 60) {
    return `Updated ${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
}

function statusText(summary: OfflineLibrarySummary) {
  if (!summary.supported) {
    return "Offline storage is not supported in this browser.";
  }
  if (summary.syncing) {
    return summary.total > 0
      ? `Saving for offline use… ${summary.completed} of ${summary.total}`
      : "Saving for offline use…";
  }
  if (summary.error === "clear") {
    return "Couldn’t clear all offline content · Try again";
  }
  if (summary.error === "update") {
    return "Couldn’t update · Saved gists are still available";
  }
  if (!summary.enabled) {
    return `Paused · ${summary.availableCount} ${summary.availableCount === 1 ? "gist" : "gists"} available`;
  }
  if (summary.storageFull && summary.targetCount > summary.availableCount) {
    return `${summary.availableCount} of ${summary.targetCount} available · Storage limit reached`;
  }
  const updated = relativeUpdated(summary.lastReconciledAt);
  return `${summary.availableCount} ${summary.availableCount === 1 ? "gist" : "gists"} available${updated ? ` · ${updated}` : ""}`;
}

export function OfflineLibrarySettings() {
  const titleId = useId();
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [busy, setBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const refresh = useCallback(() => {
    void getOfflineLibrarySummary()
      .then(setSummary)
      .catch(() => setSummary({ ...EMPTY_SUMMARY, supported: false }));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(OFFLINE_LIBRARY_EVENT, refresh);
    return () => window.removeEventListener(OFFLINE_LIBRARY_EVENT, refresh);
  }, [refresh]);

  async function toggleEnabled() {
    setBusy(true);
    try {
      await setOfflineLibraryEnabled(!summary.enabled);
      refresh();
    } catch {
      setSummary((current) => ({ ...current, error: "update" }));
    } finally {
      setBusy(false);
    }
  }

  async function changeLimit(value: string) {
    const parsed = Number(value);
    setBusy(true);
    try {
      await setOfflineByteLimit(parsed);
      refresh();
    } catch {
      setSummary((current) => ({ ...current, error: "update" }));
    } finally {
      setBusy(false);
    }
  }

  async function confirmClear() {
    setBusy(true);
    try {
      await clearOfflineContent();
      setClearOpen(false);
      refresh();
    } catch {
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const progress = Math.min(
    100,
    summary.byteLimit > 0 ? (summary.byteSize / summary.byteLimit) * 100 : 0
  );

  return (
    <section className="offline-settings" aria-labelledby={titleId}>
      <div className="offline-settings-heading">
        <div className="offline-settings-copy">
          <h1 id={titleId}>Offline Library</h1>
          <p>
            Keep my latest gists, recent reading, and requested audio on this
            device.
          </p>
        </div>
        <button
          type="button"
          className="settings-switch"
          role="switch"
          aria-checked={summary.enabled}
          aria-labelledby={titleId}
          aria-busy={busy}
          disabled={busy || !summary.supported}
          onClick={() => void toggleEnabled()}
        >
          <span className="settings-switch-thumb" aria-hidden="true" />
        </button>
      </div>

      <p className="offline-settings-status" role="status">
        {statusText(summary)}
      </p>

      <div className="offline-storage-summary">
        <div className="offline-storage-label">
          <span>{formatBytes(summary.byteSize)}</span>
          <span>of {limitLabel(summary.byteLimit)}</span>
        </div>
        <progress
          className="offline-storage-meter"
          max="100"
          value={progress}
          aria-label={`${formatBytes(summary.byteSize)} of ${limitLabel(summary.byteLimit)} used`}
        />
      </div>

      <div className="offline-settings-actions">
        <label className="offline-limit-control">
          <span>Storage limit</span>
          <select
            value={summary.byteLimit}
            disabled={busy || !summary.supported}
            onChange={(event) => void changeLimit(event.currentTarget.value)}
          >
            {OFFLINE_BYTE_LIMITS.map((limit) => (
              <option key={limit} value={limit}>
                {limitLabel(limit)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="offline-clear-button"
          disabled={busy || summary.byteSize === 0}
          onClick={() => setClearOpen(true)}
        >
          Clear offline content
        </button>
      </div>

      <ConfirmModal
        open={clearOpen}
        title="Clear offline content?"
        confirmLabel="Clear content"
        confirming={busy}
        confirmingLabel="Clearing…"
        confirmTone="danger"
        onCancel={() => setClearOpen(false)}
        onConfirm={() => void confirmClear()}
      >
        <p>
          Downloaded gists, images, and audio will be removed from this device.
          Offline Library will also be turned off. Recently viewed history is
          not affected.
        </p>
      </ConfirmModal>
    </section>
  );
}
