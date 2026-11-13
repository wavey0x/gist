// The browser sizes table columns from their longest and shortest possible
// widths, so one long prose column takes nearly all the spare room and its
// neighbours are squeezed ("Liq:" on one line, "$48.07m" on the next). Every
// column therefore gets a floor: a cell whose every line is short keeps its
// lines whole, and a longer cell keeps room for about that many characters
// before it wraps. Prose gives up the few pixels instead. Mirrored in
// public/offline-shell.js.
const CELL_RE = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const SKIP_RE = /<(?:pre|table|img)\b/i;
const BLOCK_RE = /<(?:p|ul|ol|li|div|blockquote|h[1-6])\b/i;
const BREAK_RE = /<br\s*\/?>/i;
const TAG_RE = /<[^>]*>/g;
const ENTITY_RE = /&(?:#\d+|#x[\da-f]+|[a-z]+);/gi;
// Must match the .cell-roomy floor in public/app.css.
export const TIGHT_CELL_CHARS = 18;

export function tightenTableCells(html: string) {
  if (!html.includes("<table")) {
    return html;
  }
  return html.replace(CELL_RE, (cell, tag: string, attrs: string, inner: string) => {
    if (/\bclass\s*=/.test(attrs) || SKIP_RE.test(inner)) {
      return cell;
    }
    const lines = inner
      .split(BREAK_RE)
      .map((line) => line.replace(TAG_RE, "").replace(ENTITY_RE, "x").trim());
    if (!lines.some(Boolean)) {
      return cell;
    }
    const tight =
      !BLOCK_RE.test(inner) && lines.every((line) => line.length <= TIGHT_CELL_CHARS);
    return `<${tag}${attrs} class="${tight ? "cell-tight" : "cell-roomy"}">${inner}</${tag}>`;
  });
}
