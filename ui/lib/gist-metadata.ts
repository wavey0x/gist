import type { Metadata } from "next";
import type { PublicGistPayload } from "./gists";
import { getGistDocumentTitle } from "./gist-title";

type GistMetadataOptions = {
  diff?: boolean;
  robots: Metadata["robots"];
};

export function buildGistMetadata(
  gist: PublicGistPayload,
  { diff = false, robots }: GistMetadataOptions
): Metadata {
  const title = `${getGistDocumentTitle(gist)}${diff ? " diff" : ""}`;

  return {
    title,
    openGraph: {
      title,
      type: "article"
    },
    twitter: {
      card: "summary_large_image",
      title
    },
    robots
  };
}
