import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GistViewer } from "../../../../components/GistViewer";
import { MermaidRenderer } from "../../../../components/MermaidRenderer";
import { RevisionDiffViewer } from "../../../../components/RevisionDiffViewer";
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
    comparison: string;
  }>;
};

const robots: Metadata["robots"] = {
  index: false,
  follow: false
};

function parseComparison(value: string) {
  const match = /^([1-9][0-9]*)\.\.([1-9][0-9]*)$/.exec(value);
  if (!match) {
    return null;
  }

  const fromRevisionNumber = Number(match[1]);
  const toRevisionNumber = Number(match[2]);
  if (
    !Number.isSafeInteger(fromRevisionNumber) ||
    !Number.isSafeInteger(toRevisionNumber) ||
    fromRevisionNumber === toRevisionNumber
  ) {
    return null;
  }

  return { fromRevisionNumber, toRevisionNumber };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { gistId, comparison } = await params;
  const revisions = parseComparison(comparison);

  if (!revisions) {
    return { title: "Gist diff", robots };
  }

  try {
    const gist = await fetchPublicGistPayload(
      gistId,
      String(revisions.toRevisionNumber)
    );
    return buildGistMetadata(gist, { diff: true, robots });
  } catch (error) {
    if (error instanceof PublicGistNotFoundError) {
      return { title: "Gist diff", robots };
    }
    throw error;
  }
}

export default async function GistRevisionDiffPage({ params }: PageProps) {
  const { gistId, comparison } = await params;
  const revisions = parseComparison(comparison);

  if (!revisions) {
    notFound();
  }

  const [fromRevision, toRevision] = await Promise.all([
    fetchPublicGist(gistId, String(revisions.fromRevisionNumber)),
    fetchPublicGist(gistId, String(revisions.toRevisionNumber))
  ]);

  const chrome = getSiteChromeConfig();

  return (
    <main className="page-shell page-shell-wide">
      <GistViewer
        chrome={chrome}
        gist={toRevision}
        customDiffFromRevisionNumber={fromRevision.revision_number}
        customView="diff"
        customContent={
          <RevisionDiffViewer
            key={`${fromRevision.revision_number}-${toRevision.revision_number}`}
            fromRevision={fromRevision}
            toRevision={toRevision}
          />
        }
      />
      <MermaidRenderer
        gistId={toRevision.id}
        revisionNumber={toRevision.revision_number}
      />
    </main>
  );
}
