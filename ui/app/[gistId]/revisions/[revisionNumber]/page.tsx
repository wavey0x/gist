import type { Metadata } from "next";
import { GistViewer } from "../../../../components/GistViewer";
import { MathRenderer } from "../../../../components/MathRenderer";
import { MermaidRenderer } from "../../../../components/MermaidRenderer";
import {
  PublicGistNotFoundError,
  fetchPublicGist,
  fetchPublicGistPayload
} from "../../../../lib/gists";
import { buildGistMetadata } from "../../../../lib/gist-metadata";
import { getSiteChromeConfig } from "../../../../lib/site-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{
    gistId: string;
    revisionNumber: string;
  }>;
};

const robots: Metadata["robots"] = {
  index: false,
  follow: false
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { gistId, revisionNumber } = await params;

  try {
    const gist = await fetchPublicGistPayload(gistId, revisionNumber);
    return buildGistMetadata(gist, { robots });
  } catch (error) {
    if (error instanceof PublicGistNotFoundError) {
      return {
        title: "Gist",
        robots
      };
    }
    throw error;
  }
}

export default async function GistRevisionPage({ params }: PageProps) {
  const { gistId, revisionNumber } = await params;
  const gist = await fetchPublicGist(gistId, revisionNumber);
  const chrome = getSiteChromeConfig();
  const hasMultipleFiles = Object.keys(gist.files).length > 1;

  return (
    <main
      className={hasMultipleFiles ? "page-shell page-shell-gist" : "page-shell"}
    >
      <GistViewer chrome={chrome} gist={gist} />
      <MathRenderer gistId={gist.id} revisionNumber={gist.revision_number} />
      <MermaidRenderer gistId={gist.id} revisionNumber={gist.revision_number} />
    </main>
  );
}
