"use client";

import { useEffect } from "react";
import { getTopLevelHeading } from "../lib/gist-title";
import type { PublicGistPayload } from "../lib/gists";
import { recordRecentlyViewedGist } from "../lib/recent-viewed";

type RecentlyViewedRecorderProps = {
  gist: PublicGistPayload;
};

export function RecentlyViewedRecorder({ gist }: RecentlyViewedRecorderProps) {
  useEffect(() => {
    recordRecentlyViewedGist({
      id: gist.id,
      title: getTopLevelHeading(gist) ?? gist.title,
      author_name: gist.author_name,
      author_avatar_url: gist.author_avatar_url,
      revision_number: gist.revision_number,
      viewed_at: new Date().toISOString()
    });
  }, [
    gist.author_name,
    gist.author_avatar_url,
    gist.id,
    gist.revision_number,
    gist.snapshot_sha256,
    gist.title
  ]);

  return null;
}
