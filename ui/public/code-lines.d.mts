export type LineTarget = { slug: string | null; start: number | null; end: number | null };

export function splitHighlightedLines(
  html: string
): { wrapperClass: string; lines: string[] } | null;
export function fileSlugs(filenames: string[]): Record<string, string>;
export function parseLineFragment(hash: string): LineTarget | null;
export function formatLineFragment(target: {
  slug?: string | null;
  start?: number | null;
  end?: number | null;
}): string;
export function codeLinesHtml(html: string, slug?: string): string | null;
export function mountLineLinks(
  root: Element | null,
  options?: { expandFile?: (slug: string) => void }
): () => void;
