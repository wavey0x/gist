"use client";

import { useEffect } from "react";
import { getTopLevelHeading } from "../lib/gist-title";
import type { PublicGistPayload } from "../lib/gists";
import { recordRecentlyViewedGist } from "../lib/recent-viewed";

type RecentlyViewedRecorderProps = {
  gist: PublicGistPayload;
};

function latestUrl(gist: PublicGistPayload) {
  return `/${gist.id}`;
}

function revisionUrl(gist: PublicGistPayload) {
  return `/${gist.id}/revisions/${gist.revision_number}`;
}

export function RecentlyViewedRecorder({ gist }: RecentlyViewedRecorderProps) {
  useEffect(() => {
    recordRecentlyViewedGist({
      id: gist.id,
      url: latestUrl(gist),
      revision_url: revisionUrl(gist),
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
    gist.rendered_html,
    gist.revision_number,
    gist.title
  ]);

  return null;
}
