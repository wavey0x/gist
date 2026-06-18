"use client";

import { useEffect } from "react";
import { getTopLevelHeading } from "../lib/gist-title";
import type { PublicGistPayload } from "../lib/gists";
import { recordRecentlyViewedGist } from "../lib/recent-viewed";

type RecentlyViewedRecorderProps = {
  gist: PublicGistPayload;
};

function fallbackUrl(gist: PublicGistPayload) {
  if (gist.revision_number < gist.latest_revision_number) {
    return `/${gist.id}/revisions/${gist.revision_number}`;
  }
  return `/${gist.id}`;
}

export function RecentlyViewedRecorder({ gist }: RecentlyViewedRecorderProps) {
  useEffect(() => {
    recordRecentlyViewedGist({
      id: gist.id,
      url: window.location.pathname || fallbackUrl(gist),
      title: getTopLevelHeading(gist) ?? gist.title,
      author_name: gist.author_name,
      revision_number: gist.revision_number,
      viewed_at: new Date().toISOString()
    });
  }, [
    gist.author_name,
    gist.id,
    gist.latest_revision_number,
    gist.rendered_html,
    gist.revision_number,
    gist.title
  ]);

  return null;
}
