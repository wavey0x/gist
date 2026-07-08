import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GistViewer } from "../../../components/GistViewer";
import { MermaidRenderer } from "../../../components/MermaidRenderer";
import { RevisionDiffViewer } from "../../../components/RevisionDiffViewer";
import {
  PublicGistNotFoundError,
  fetchPublicGistPayload,
  fetchPublicGistWithPrevious
} from "../../../lib/gists";
import { getGistDocumentTitle } from "../../../lib/gist-title";
import { getSiteChromeConfig } from "../../../lib/site-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{
    gistId: string;
  }>;
};

const robots: Metadata["robots"] = {
  index: false,
  follow: false
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { gistId } = await params;

  try {
    const gist = await fetchPublicGistPayload(gistId);
    return {
      title: `${getGistDocumentTitle(gist)} diff`,
      robots
    };
  } catch (error) {
    if (error instanceof PublicGistNotFoundError) {
      return {
        title: "Gist diff",
        robots
      };
    }
    throw error;
  }
}

export default async function GistDiffPage({ params }: PageProps) {
  const { gistId } = await params;
  const { gist, previousRevision } = await fetchPublicGistWithPrevious(gistId);

  if (!previousRevision) {
    notFound();
  }

  const chrome = getSiteChromeConfig();

  return (
    <main className="page-shell page-shell-wide">
      <GistViewer
        chrome={chrome}
        gist={gist}
        customView="diff"
        customContent={
          <RevisionDiffViewer
            key={`${previousRevision.revision_number}-${gist.revision_number}`}
            gist={gist}
            previousRevision={previousRevision}
          />
        }
      />
      <MermaidRenderer gistId={gist.id} revisionNumber={gist.revision_number} />
    </main>
  );
}
