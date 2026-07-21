import { notFound } from "next/navigation";
import { apiUrl } from "./api-base";

const GIST_ID_RE = /^[A-Za-z0-9]{16,64}$/;
const REVISION_NUMBER_RE = /^[1-9][0-9]*$/;
const CONTENT_SHA256_RE = /^[a-f0-9]{64}$/;

export class PublicGistNotFoundError extends Error {
  constructor() {
    super("Public gist not found");
  }
}

export type RevisionHistoryItem = {
  revision_number: number;
  created_at: string;
  author_name: string;
  author_avatar_url?: string;
  is_latest: boolean;
  url: string;
};

export type PublicGistPayload = {
  id: string;
  title: string | null;
  author_name: string;
  author_avatar_url?: string;
  markdown: string;
  rendered_html: string;
  content_sha256: string;
  revision_number: number;
  latest_revision_number: number;
  created_at: string;
  updated_at: string;
  history: RevisionHistoryItem[];
};

function validateGistId(value: string) {
  return GIST_ID_RE.test(value);
}

function validateRevisionNumber(value: string) {
  return REVISION_NUMBER_RE.test(value);
}

function isHistoryItem(value: unknown): value is RevisionHistoryItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<RevisionHistoryItem>;
  return (
    typeof item.revision_number === "number" &&
    Number.isInteger(item.revision_number) &&
    item.revision_number > 0 &&
    typeof item.created_at === "string" &&
    typeof item.author_name === "string" &&
    (item.author_avatar_url === undefined ||
      typeof item.author_avatar_url === "string") &&
    typeof item.is_latest === "boolean" &&
    typeof item.url === "string"
  );
}

function normalizePayload(gistId: string, payload: unknown): PublicGistPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid gist payload");
  }

  const gist = payload as Partial<PublicGistPayload>;
  if (
    gist.id !== gistId ||
    typeof gist.author_name !== "string" ||
    (gist.author_avatar_url !== undefined &&
      typeof gist.author_avatar_url !== "string") ||
    typeof gist.markdown !== "string" ||
    typeof gist.rendered_html !== "string" ||
    typeof gist.content_sha256 !== "string" ||
    !CONTENT_SHA256_RE.test(gist.content_sha256) ||
    typeof gist.revision_number !== "number" ||
    !Number.isInteger(gist.revision_number) ||
    gist.revision_number < 1 ||
    typeof gist.latest_revision_number !== "number" ||
    !Number.isInteger(gist.latest_revision_number) ||
    gist.latest_revision_number < gist.revision_number ||
    typeof gist.created_at !== "string" ||
    typeof gist.updated_at !== "string" ||
    !("title" in gist) ||
    !(gist.title === null || typeof gist.title === "string") ||
    !Array.isArray(gist.history) ||
    gist.history.length > 50 ||
    !gist.history.every(isHistoryItem)
  ) {
    throw new Error("Invalid gist payload");
  }

  return {
    id: gist.id,
    title: gist.title,
    author_name: gist.author_name,
    ...(gist.author_avatar_url ? { author_avatar_url: gist.author_avatar_url } : {}),
    markdown: gist.markdown,
    rendered_html: gist.rendered_html,
    content_sha256: gist.content_sha256,
    revision_number: gist.revision_number,
    latest_revision_number: gist.latest_revision_number,
    created_at: gist.created_at,
    updated_at: gist.updated_at,
    history: gist.history
  };
}

export async function fetchPublicGistPayload(
  gistId: string,
  revisionNumber?: string
): Promise<PublicGistPayload> {
  if (!validateGistId(gistId)) {
    throw new PublicGistNotFoundError();
  }
  if (revisionNumber !== undefined && !validateRevisionNumber(revisionNumber)) {
    throw new PublicGistNotFoundError();
  }

  const path = revisionNumber
    ? `/api/v1/gists/${gistId}/revisions/${revisionNumber}/render`
    : `/api/v1/gists/${gistId}/render`;
  const response = await fetch(await apiUrl(path), {
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });

  if (response.status === 404) {
    throw new PublicGistNotFoundError();
  }
  if (!response.ok) {
    throw new Error(`Failed to load gist payload: ${response.status}`);
  }

  return normalizePayload(gistId, await response.json());
}

export async function fetchPublicGist(
  gistId: string,
  revisionNumber?: string
): Promise<PublicGistPayload> {
  try {
    return await fetchPublicGistPayload(gistId, revisionNumber);
  } catch (error) {
    if (error instanceof PublicGistNotFoundError) {
      notFound();
    }
    throw error;
  }
}
