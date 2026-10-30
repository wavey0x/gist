"use client";

import { Headphones, BookOpen } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { positionStorageKey } from "../lib/audio-engine";
import { formatPlaybackTime } from "../lib/audio-format";
import { readReadingPosition } from "../lib/reading-position";
import { readRecentlyViewedGists } from "../lib/recent-viewed";

type ContinueItem = {
  key: string;
  href: string;
  title: string;
  detail: string;
  listening: boolean;
  progress: number;
  savedAt: number;
};

const MAX_ITEMS = 3;

function readAudioPosition(gistId: string, revisionNumber: number) {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(positionStorageKey(gistId, revisionNumber)) ?? "null"
    ) as { position?: number; duration?: number; saved_at?: string } | null;
    return typeof stored?.position === "number" ? stored : null;
  } catch {
    return null;
  }
}

function readContinueItems() {
  const items: ContinueItem[] = [];
  for (const gist of readRecentlyViewedGists()) {
    const href = `/${gist.id}`;
    const title = gist.title?.trim() || gist.id;
    const audio = readAudioPosition(gist.id, gist.revision_number);
    const reading = readReadingPosition(gist.id, gist.revision_number);
    if (audio) {
      const position = audio.position ?? 0;
      const duration = audio.duration ?? 0;
      items.push({
        key: `audio:${gist.id}`,
        href,
        title,
        detail:
          duration > position
            ? `${formatPlaybackTime(duration - position)} left`
            : `At ${formatPlaybackTime(position)}`,
        listening: true,
        progress: duration > 0 ? position / duration : 0,
        savedAt: Date.parse(audio.saved_at ?? gist.viewed_at) || 0
      });
    } else if (reading) {
      items.push({
        key: `reading:${gist.id}`,
        href,
        title,
        detail: `${Math.round(reading.fraction * 100)}% read`,
        listening: false,
        progress: reading.fraction,
        savedAt: Date.parse(reading.saved_at) || 0
      });
    }
  }
  return items.sort((left, right) => right.savedAt - left.savedAt).slice(0, MAX_ITEMS);
}

export function ContinueRow() {
  const [items, setItems] = useState<ContinueItem[]>([]);

  useEffect(() => {
    setItems(readContinueItems());
  }, []);

  if (!items.length) {
    return null;
  }
  return (
    <section className="continue-row" aria-label="Continue">
      <h2 className="continue-heading">CONTINUE</h2>
      <ul className="continue-list">
        {items.map((item) => (
          <li key={item.key}>
            <Link className="continue-item" href={item.href} prefetch={false}>
              {item.listening ? (
                <Headphones aria-hidden="true" size={14} strokeWidth={1.8} />
              ) : (
                <BookOpen aria-hidden="true" size={14} strokeWidth={1.8} />
              )}
              <span className="continue-title">{item.title}</span>
              <span className="continue-detail">{item.detail}</span>
              <span
                className="continue-progress"
                style={{ width: `${Math.min(100, item.progress * 100)}%` }}
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
