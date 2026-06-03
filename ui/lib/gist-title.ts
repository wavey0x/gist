import type { PublicGistPayload } from "./gists";

const FIRST_H1_RE = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i;
const TAG_RE = /<[^>]*>/g;
const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\""
};

function decodeHtmlEntity(entity: string) {
  const normalized = entity.toLowerCase();
  if (normalized.startsWith("#x")) {
    const codePoint = Number.parseInt(normalized.slice(2), 16);
    return Number.isFinite(codePoint)
      ? String.fromCodePoint(codePoint)
      : `&${entity};`;
  }
  if (normalized.startsWith("#")) {
    const codePoint = Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(codePoint)
      ? String.fromCodePoint(codePoint)
      : `&${entity};`;
  }

  return NAMED_ENTITIES[normalized] ?? `&${entity};`;
}

function normalizeHeadingText(html: string) {
  const text = html
    .replace(TAG_RE, "")
    .replace(ENTITY_RE, (_, entity: string) => decodeHtmlEntity(entity))
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
}

export function getTopLevelHeading(gist: PublicGistPayload) {
  const match = FIRST_H1_RE.exec(gist.rendered_html);
  return match ? normalizeHeadingText(match[1]) : null;
}

export function getGistDocumentTitle(gist: PublicGistPayload) {
  const title = getTopLevelHeading(gist) ?? gist.title ?? "untitled";
  return `gist: ${title}`;
}

export function getGistHeaderTitle(gist: PublicGistPayload) {
  return getTopLevelHeading(gist) ? null : gist.title;
}
