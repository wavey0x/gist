"use client";

import { Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  closePlayer,
  skip,
  togglePlayback,
  useAudioEngine
} from "../lib/audio-engine";
import { formatPlaybackTime } from "../lib/audio-format";
import { countUpNext, useListenQueue } from "../lib/listen-queue";

export function MiniPlayer() {
  const { currentTime, duration, opened, playing, buffering, message, track } = useAudioEngine();
  const { items } = useListenQueue();
  const upNext = countUpNext(items, track?.gistId ?? null);
  const pathname = usePathname();
  if (!track || !opened) {
    return null;
  }
  const href = `/${track.gistId}`;
  const revisionHref = `${href}/revisions/${track.revisionNumber}`;
  if (pathname === href || pathname === revisionHref) {
    return null;
  }
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const status = message || (buffering ? "Loading audio…" : "");
  const timing = `${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`;
  return (
    <aside className="mini-player" aria-label="Now playing">
      <span className="mini-player-progress" style={{ width: `${progress}%` }} />
      <div className="mini-player-transport">
        <button
          type="button"
          className="mini-player-button mini-player-skip"
          aria-label="Skip back 10 seconds"
          title="Back 10 seconds"
          disabled={duration <= 0}
          onClick={() => skip(-10)}
        >
          <RotateCcw aria-hidden="true" size={23} strokeWidth={1.8} />
          <span className="article-audio-skip-label" aria-hidden="true">10</span>
        </button>
        <button
          type="button"
          className="mini-player-button"
          aria-label={playing ? "Pause article audio" : "Play article audio"}
          aria-busy={buffering}
          onClick={togglePlayback}
        >
          {playing ? (
            <Pause aria-hidden="true" size={17} strokeWidth={2} />
          ) : (
            <Play aria-hidden="true" size={17} strokeWidth={2} />
          )}
        </button>
        <button
          type="button"
          className="mini-player-button mini-player-skip"
          aria-label="Skip forward 10 seconds"
          title="Forward 10 seconds"
          disabled={duration <= 0}
          onClick={() => skip(10)}
        >
          <RotateCw aria-hidden="true" size={23} strokeWidth={1.8} />
          <span className="article-audio-skip-label" aria-hidden="true">10</span>
        </button>
      </div>
      <Link className="mini-player-title" href={href}>
        <span className="mini-player-name">{track.title}</span>
        <span className="mini-player-meta">
          {status || `${timing}${upNext ? ` · ${upNext} up next` : ""}`}
        </span>
      </Link>
      <span className="sr-only" role="status">{status}</span>
      <button
        type="button"
        className="mini-player-button"
        aria-label="Close audio player"
        onClick={closePlayer}
      >
        <X aria-hidden="true" size={17} strokeWidth={1.8} />
      </button>
    </aside>
  );
}
