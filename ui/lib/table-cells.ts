// The browser sizes table columns from their longest and shortest possible
// widths, so one long prose column takes nearly all the spare room and short
// neighbours get wrapped ("Liq:" on one line, "$48.07m" on the next). A cell
// whose every line is short is marked so it keeps its lines whole; the prose
// column gives up the few pixels instead. Mirrored in public/offline-shell.js.
const CELL_RE = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const BLOCK_RE = /<(?:p|ul|ol|li|pre|div|blockquote|table|img|h[1-6])\b/i;
const BREAK_RE = /<br\s*\/?>/i;
const TAG_RE = /<[^>]*>/g;
const ENTITY_RE = /&(?:#\d+|#x[\da-f]+|[a-z]+);/gi;
export const TIGHT_CELL_CHARS = 18;

export function tightenTableCells(html: string) {
  if (!html.includes("<table")) {
    return html;
  }
  return html.replace(CELL_RE, (cell, tag: string, attrs: string, inner: string) => {
    if (/\bclass\s*=/.test(attrs) || BLOCK_RE.test(inner)) {
      return cell;
    }
    const lines = inner
      .split(BREAK_RE)
      .map((line) => line.replace(TAG_RE, "").replace(ENTITY_RE, "x").trim());
    if (!lines.some(Boolean) || lines.some((line) => line.length > TIGHT_CELL_CHARS)) {
      return cell;
    }
    return `<${tag}${attrs} class="cell-tight">${inner}</${tag}>`;
  });
}
