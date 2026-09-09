export function mermaidConfig(theme: string) {
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
    theme,
    logLevel: "fatal",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  };
}
