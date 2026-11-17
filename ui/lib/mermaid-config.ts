/**
 * Mermaid settings for the reader. Mermaid's "base" theme is the only one that
 * takes custom colors, so the page tokens feed it, and a scoped stylesheet
 * (themeCSS) adds what theme variables cannot: labels on the page color,
 * soft shadows and the diagram tints in app.css.
 */

export type MermaidPalette = {
  bg: string;
  surface: string;
  inset: string;
  text: string;
  muted: string;
  faint: string;
  line: string;
  lineStrong: string;
  /** --diagram-fill-1..5 and --diagram-stroke-1..5, for charts that need real colors. */
  fills: string[];
  strokes: string[];
};

// Same values as the app.css foundations; used when no page is available.
const FALLBACK_PALETTES: Record<"light" | "dark", MermaidPalette> = {
  light: {
    bg: "#fafafa",
    surface: "#ffffff",
    inset: "#f3f3f3",
    text: "#1f1f1f",
    muted: "#6b6b6b",
    faint: "#8f8f8f",
    line: "#e4e4e4",
    lineStrong: "#c6c6c6",
    fills: ["#eef3fd", "#e9f6f2", "#f2eefd", "#fdf5e6", "#fdeef0"],
    strokes: ["#a9c1ee", "#94cfbd", "#bcaef0", "#e6c483", "#eaa9b2"]
  },
  dark: {
    bg: "#111212",
    surface: "#1a1b1c",
    inset: "#18191a",
    text: "#e9e9e9",
    muted: "#9a9a9a",
    faint: "#6e6e6e",
    line: "#27292a",
    lineStrong: "#3c3e40",
    fills: ["#17233a", "#122d28", "#231d3b", "#30260f", "#36191e"],
    strokes: ["#3d64a6", "#2f8a76", "#6a56b5", "#9d7a2d", "#a2505c"]
  }
};

const PALETTE_TOKENS: Record<Exclude<keyof MermaidPalette, "fills" | "strokes">, string> = {
  bg: "--bg",
  surface: "--surface",
  inset: "--inset",
  text: "--text",
  muted: "--muted",
  faint: "--faint",
  line: "--line",
  lineStrong: "--line-strong"
};

// Author color names, in the same order as the --diagram-fill-N tints.
export const MERMAID_TONE_NAMES = ["info", "ok", "accent", "warn", "danger"];

export const MERMAID_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, "Noto Sans", Helvetica, Arial, sans-serif';

/** Reads the page tokens; Mermaid needs real colors to derive its shades. */
export function mermaidPalette(isDark: boolean, root?: Element): MermaidPalette {
  const fallback = FALLBACK_PALETTES[isDark ? "dark" : "light"];
  if (!root || typeof getComputedStyle !== "function") {
    return fallback;
  }
  const style = getComputedStyle(root);
  const read = (token: string, fallbackValue: string) => {
    const value = style.getPropertyValue(token).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallbackValue;
  };
  const palette = { ...fallback };
  for (const key of Object.keys(PALETTE_TOKENS) as (keyof typeof PALETTE_TOKENS)[]) {
    palette[key] = read(PALETTE_TOKENS[key], fallback[key]);
  }
  palette.fills = fallback.fills.map((value, index) => read(`--diagram-fill-${index + 1}`, value));
  palette.strokes = fallback.strokes.map((value, index) =>
    read(`--diagram-stroke-${index + 1}`, value)
  );
  return palette;
}

function toneShapes(selector: string) {
  return ["rect", "path", "polygon", "circle", "ellipse", "g > path"]
    .map((shape) => `${selector} > ${shape}`)
    .join(", ");
}

function mermaidThemeCss() {
  const tones = MERMAID_TONE_NAMES.map((name, index) => {
    const n = index + 1;
    return `${toneShapes(`.node.tone-${n}`)}, ${toneShapes(`.node.${name}`)} {
      fill: var(--diagram-fill-${n});
      stroke: var(--diagram-stroke-${n});
    }`;
  }).join("\n");

  return `
    .node > rect, .node > path, .node > polygon, .node > circle, .node > ellipse,
    .actor, .note {
      filter: var(--diagram-shadow);
    }
    .edgeLabel, .edgeLabel p, .labelBkg {
      background-color: var(--bg) !important;
      color: var(--muted) !important;
      font-size: 12px;
      font-weight: 400;
    }
    .edgeLabel rect {
      fill: var(--bg) !important;
      opacity: 1 !important;
    }
    .labelBkg {
      padding: 1px 4px;
      border-radius: 6px;
    }
    .flowchart-link {
      stroke-width: 1.4px;
      stroke-linecap: round;
    }
    ${tones}
  `;
}

export function mermaidConfig(theme: string, palette?: MermaidPalette) {
  const isDark = theme === "dark";
  const colors = palette ?? FALLBACK_PALETTES[isDark ? "dark" : "light"];
  return {
    startOnLoad: false,
    securityLevel: "strict",
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "suppressErrorRendering",
      "maxEdges",
      // The page theme owns the canvas palette, including edges and arrowheads.
      // Per-diagram themes must not reset it; classDef colors remain supported.
      "theme",
      "themeCSS",
      "themeVariables",
      "fontFamily",
      "altFontFamily",
      "dompurifyConfig"
    ],
    suppressErrorRendering: true,
    maxTextSize: 50000,
    deterministicIds: true,
    deterministicIDSeed: "wavey-gist",
    // Layout stays Mermaid's per-diagram default (ELK for flowcharts), and an
    // author can still pick another one, e.g. `layout: dagre` in frontmatter.
    theme: "base",
    themeVariables: {
      darkMode: isDark,
      background: colors.bg,
      fontFamily: MERMAID_FONT_FAMILY,
      fontSize: "14px",
      fontWeight: 500,
      primaryColor: colors.surface,
      primaryBorderColor: colors.lineStrong,
      primaryTextColor: colors.text,
      secondaryColor: colors.inset,
      secondaryBorderColor: colors.lineStrong,
      secondaryTextColor: colors.text,
      tertiaryColor: colors.inset,
      tertiaryBorderColor: colors.line,
      tertiaryTextColor: colors.text,
      lineColor: colors.faint,
      textColor: colors.text,
      edgeLabelBackground: colors.bg,
      clusterBkg: colors.inset,
      clusterBorder: colors.line,
      titleColor: colors.text,
      noteBkgColor: colors.inset,
      noteBorderColor: colors.lineStrong,
      noteTextColor: colors.text,
      // Charts that color by series (pie, timeline, mindmap, xychart) cycle
      // through the same five tints as flowchart nodes.
      ...Object.fromEntries(
        colors.strokes.flatMap((stroke, index) => [
          [`pie${index + 1}`, stroke],
          [`pie${index + 6}`, colors.fills[index]],
          [`cScale${index}`, colors.fills[index]],
          [`cScale${index + 5}`, stroke],
          [`cScaleLabel${index}`, colors.text],
          [`cScaleLabel${index + 5}`, colors.text]
        ])
      ),
      pieStrokeColor: colors.bg,
      pieStrokeWidth: "2px",
      pieOuterStrokeWidth: "0px",
      pieTitleTextColor: colors.text,
      pieSectionTextColor: colors.text,
      pieLegendTextColor: colors.text,
      xyChart: { plotColorPalette: colors.strokes.join(", ") },
      radius: 10,
      strokeWidth: 1,
      useGradient: false,
      nodeShadow: true,
      dropShadow: "var(--diagram-shadow)"
    },
    themeCSS: mermaidThemeCss(),
    flowchart: {
      wrappingWidth: 260,
      padding: 14,
      nodeSpacing: 36,
      rankSpacing: 44
    },
    logLevel: "fatal",
    fontFamily: MERMAID_FONT_FAMILY
  };
}

type FlowEdge = { start: string; end: string };
type FlowVertex = { classes?: string[]; styles?: string[] };

/**
 * Picks a tint for each node by its depth from the diagram's entry points, so
 * colors step down the flow. Returns nothing when the author colored any node
 * themselves, because their colors carry meaning that tints would blur.
 */
export function mermaidDepthTones(
  vertices: Map<string, FlowVertex>,
  edges: FlowEdge[]
): Map<string, number> {
  const tones = new Map<string, number>();
  for (const vertex of vertices.values()) {
    const authorClasses = (vertex.classes ?? []).filter((name) => name !== "default");
    if (authorClasses.length || (vertex.styles ?? []).length) {
      return tones;
    }
  }

  const ids = [...vertices.keys()];
  const next = new Map(ids.map((id) => [id, [] as string[]]));
  const incoming = new Set<string>();
  for (const { start, end } of edges) {
    next.get(start)?.push(end);
    if (start !== end) {
      incoming.add(end);
    }
  }

  const roots = ids.filter((id) => !incoming.has(id));
  const queue: [string, number][] = (roots.length ? roots : ids.slice(0, 1)).map(
    (id) => [id, 0]
  );
  // Breadth first, so a back edge never pushes a node deeper.
  for (let index = 0; index < queue.length; index += 1) {
    const [id, depth] = queue[index];
    if (tones.has(id)) {
      continue;
    }
    tones.set(id, (depth % MERMAID_TONE_NAMES.length) + 1);
    for (const target of next.get(id) ?? []) {
      if (!tones.has(target)) {
        queue.push([target, depth + 1]);
      }
    }
  }
  // Nodes only reachable from a cycle with no entry point start a new walk.
  for (const id of ids) {
    if (!tones.has(id)) {
      tones.set(id, 1);
    }
  }
  return tones;
}
