"use client";

import { Pause, Play, SkipForward, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  closePlayer,
  playNext,
  togglePlayback,
  useAudioEngine
} from "../lib/audio-engine";
import { formatPlaybackTime } from "../lib/audio-format";

export function MiniPlayer() {
  const { currentTime, duration, opened, playing, queue, track } = useAudioEngine();
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
  return (
    <aside className="mini-player" aria-label="Now playing">
      <span className="mini-player-progress" style={{ width: `${progress}%` }} />
      <button
        type="button"
        className="mini-player-button"
        aria-label={playing ? "Pause article audio" : "Play article audio"}
        onClick={togglePlayback}
      >
        {playing ? (
          <Pause aria-hidden="true" size={17} strokeWidth={2} />
        ) : (
          <Play aria-hidden="true" size={17} strokeWidth={2} />
        )}
      </button>
      <Link className="mini-player-title" href={href}>
        <span className="mini-player-name">{track.title}</span>
        <span className="mini-player-meta">
          {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
          {queue.length ? ` · ${queue.length} up next` : ""}
        </span>
      </Link>
      {queue.length ? (
        <button
          type="button"
          className="mini-player-button"
          aria-label="Play next article"
          onClick={playNext}
        >
          <SkipForward aria-hidden="true" size={17} strokeWidth={1.8} />
        </button>
      ) : null}
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
