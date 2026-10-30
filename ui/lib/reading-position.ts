export const READING_KEY_PREFIX = "waveygist:reading:v1:";

const MIN_FRACTION = 0.02;
const MAX_FRACTION = 0.98;

export type ReadingPosition = {
  fraction: number;
  saved_at: string;
};

function readingKey(gistId: string, revisionNumber: number) {
  return `${READING_KEY_PREFIX}${gistId}:${revisionNumber}`;
}

export function readReadingPosition(gistId: string, revisionNumber: number) {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(readingKey(gistId, revisionNumber)) ?? "null"
    ) as Partial<ReadingPosition> | null;
    return typeof stored?.fraction === "number" && typeof stored.saved_at === "string"
      ? (stored as ReadingPosition)
      : null;
  } catch {
    return null;
  }
}

export function saveReadingPosition(
  gistId: string,
  revisionNumber: number,
  fraction: number
) {
  try {
    const key = readingKey(gistId, revisionNumber);
    if (fraction < MIN_FRACTION || fraction > MAX_FRACTION) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({
        fraction: Math.round(fraction * 1000) / 1000,
        saved_at: new Date().toISOString()
      })
    );
  } catch {
    // Reading bookmarks are best effort.
  }
}
