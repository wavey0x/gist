import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GistViewer } from "../../../../../components/GistViewer";
import { RevisionDiffViewer } from "../../../../../components/RevisionDiffViewer";
import {
  PublicGistNotFoundError,
  fetchPublicGistPayload,
  fetchPublicGistWithPrevious
} from "../../../../../lib/gists";
import { getGistDocumentTitle } from "../../../../../lib/gist-title";
import { getSiteChromeConfig } from "../../../../../lib/site-config";

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

export default async function GistRevisionDiffPage({ params }: PageProps) {
  const { gistId, revisionNumber } = await params;
  const { gist, previousRevision } = await fetchPublicGistWithPrevious(
    gistId,
    revisionNumber
  );

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
    </main>
  );
}
