import { notFound } from "next/navigation";
import { apiUrl } from "./api-base";

const GIST_ID_RE = /^[A-Za-z0-9]{16,64}$/;
const REVISION_NUMBER_RE = /^[1-9][0-9]*$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

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
  snapshot_sha256: string;
  file_count: number;
  is_latest: boolean;
  url: string;
};

export type PublicGistFile = {
  filename: string;
  kind: "markdown" | "source" | "text";
  language: string | null;
  content: string;
  rendered_html: string;
  content_sha256: string;
  byte_size: number;
  raw_url: string;
};

export type PublicGistPayload = {
  id: string;
  url: string;
  title: string | null;
  display_title: string;
  author_name: string;
  author_avatar_url?: string;
  primary_file: string;
  snapshot_sha256: string;
  revision_number: number;
  latest_revision_number: number;
  created_at: string;
  updated_at: string;
  files: Record<string, PublicGistFile>;
  history: RevisionHistoryItem[];
};

export function validateGistId(value: string) {
  return GIST_ID_RE.test(value);
}

export function validateRevisionNumber(value: string) {
  return REVISION_NUMBER_RE.test(value);
}

export function validateGistFilename(value: string) {
  if (!value || value.normalize("NFC") !== value) {
    return false;
  }
  if (
    value === "." ||
    value === ".." ||
    value.trim() !== value ||
    value.includes("/") ||
    value.includes("\\") ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  ) {
    return false;
  }
  return new TextEncoder().encode(value).length <= 255;
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
    typeof item.snapshot_sha256 === "string" &&
    SHA256_RE.test(item.snapshot_sha256) &&
    typeof item.file_count === "number" &&
    Number.isInteger(item.file_count) &&
    item.file_count > 0 &&
    item.file_count <= 32 &&
    typeof item.is_latest === "boolean" &&
    typeof item.url === "string"
  );
}

function isGistFile(filename: string, value: unknown): value is PublicGistFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const file = value as Partial<PublicGistFile>;
  return (
    validateGistFilename(filename) &&
    file.filename === filename &&
    (file.kind === "markdown" || file.kind === "source" || file.kind === "text") &&
    (file.language === null || typeof file.language === "string") &&
    typeof file.content === "string" &&
    typeof file.rendered_html === "string" &&
    typeof file.content_sha256 === "string" &&
    SHA256_RE.test(file.content_sha256) &&
    typeof file.byte_size === "number" &&
    Number.isInteger(file.byte_size) &&
    file.byte_size === new TextEncoder().encode(file.content).length &&
    typeof file.raw_url === "string"
  );
}

function normalizePayload(gistId: string, payload: unknown): PublicGistPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid gist payload");
  }

  const gist = payload as Partial<PublicGistPayload>;
  const fileEntries =
    gist.files && typeof gist.files === "object"
      ? Object.entries(gist.files)
      : [];
  if (
    gist.id !== gistId ||
    typeof gist.url !== "string" ||
    typeof gist.display_title !== "string" ||
    !gist.display_title ||
    typeof gist.author_name !== "string" ||
    (gist.author_avatar_url !== undefined &&
      typeof gist.author_avatar_url !== "string") ||
    typeof gist.primary_file !== "string" ||
    typeof gist.snapshot_sha256 !== "string" ||
    !SHA256_RE.test(gist.snapshot_sha256) ||
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
    fileEntries.length < 1 ||
    fileEntries.length > 32 ||
    !fileEntries.every(([filename, file]) => isGistFile(filename, file)) ||
    !Object.prototype.hasOwnProperty.call(gist.files, gist.primary_file) ||
    !Array.isArray(gist.history) ||
    gist.history.length > 50 ||
    !gist.history.every(isHistoryItem)
  ) {
    throw new Error("Invalid gist payload");
  }

  return gist as PublicGistPayload;
}

export function orderedGistFiles(gist: PublicGistPayload) {
  const entries = Object.values(gist.files);
  return [
    gist.files[gist.primary_file],
    ...entries
      .filter((file) => file.filename !== gist.primary_file)
      .sort((left, right) => left.filename.localeCompare(right.filename))
  ];
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
    headers: { Accept: "application/json" }
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
