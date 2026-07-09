"use client";

import { useEffect } from "react";

const MARKDOWN_BODY_SELECTOR = "article.markdown-body";
const MERMAID_RENDER_SELECTOR = ".js-mermaid-render";
const MERMAID_OUTPUT_SELECTOR = ".js-mermaid-render-output";
const MERMAID_FALLBACK_SELECTOR = '.mermaid-render-fallback pre[lang="mermaid"]';
const MERMAID_ERROR_SELECTOR = ".mermaid-render-error";
const MERMAID_RENDER_ERROR_TEXT = "Unable to render Mermaid diagram.";
const MERMAID_MAX_DIAGRAMS = 32;
const MERMAID_MAX_SOURCE_CHARS = 50000;
const FLOWCHART_RE = /^\s*(?:flowchart|graph)\b/i;
const UNQUOTED_EDGE_LABEL_WITH_PUNCTUATION_RE =
  /([-<>=.ox]+)\|([^|"\n]*[()[\],;][^|"\n]*)\|/g;

type MermaidApi = {
  initialize: (options: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

type MermaidRendererProps = {
  gistId: string;
  revisionNumber: number;
};

async function loadMermaid(): Promise<MermaidApi> {
  const mermaidModule = await import("mermaid");
  return mermaidModule.default;
}

function currentMermaidTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "default";
}

function cspNonce() {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ??
    null
  );
}

function mermaidRenderId(gistId: string, revisionNumber: number, index: number) {
  const safeGistId = gistId.replace(/[^A-Za-z0-9_-]/g, "-");
  return `wg-mermaid-${safeGistId}-${revisionNumber}-${index}`;
}

function configureMermaid(mermaid: MermaidApi, theme: string) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "suppressErrorRendering",
      "maxEdges",
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
  });
}

function normalizeMermaidSource(source: string) {
  if (!FLOWCHART_RE.test(source)) {
    return source;
  }

  // Mermaid rejects some GitHub-accepted unquoted flowchart edge labels.
  return source.replace(
    UNQUOTED_EDGE_LABEL_WITH_PUNCTUATION_RE,
    (_match, edgeOperator: string, label: string) =>
      `${edgeOperator}|"${label.replace(/"/g, '\\"')}"|`
  );
}

function addNonceToMermaidSvg(svg: string, nonce: string | null) {
  const template = document.createElement("template");
  template.innerHTML = svg.trim();

  const svgElement = template.content.querySelector("svg");
  if (svgElement) {
    svgElement.classList.add("mermaid-render-svg");
    if (!svgElement.getAttribute("role")) {
      svgElement.setAttribute("role", "img");
    }
  }

  if (nonce) {
    template.content.querySelectorAll("style").forEach((styleElement) => {
      styleElement.setAttribute("nonce", nonce);
    });
  }

  return template.innerHTML;
}

async function renderMermaidWithStyleNonce(
  mermaid: MermaidApi,
  id: string,
  source: string,
  nonce: string | null
) {
  if (!nonce) {
    return mermaid.render(id, normalizeMermaidSource(source));
  }

  const originalCreateElement = document.createElement.bind(document);
  const originalCreateElementNS = document.createElementNS.bind(document);
  document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    const element = originalCreateElement(tagName, options);
    if (tagName.toLowerCase() === "style") {
      element.nonce = nonce;
      element.setAttribute("nonce", nonce);
    }
    return element;
  }) as typeof document.createElement;
  document.createElementNS = ((
    namespaceURI: string | null,
    qualifiedName: string,
    options?: ElementCreationOptions
  ) => {
    const element = originalCreateElementNS(namespaceURI, qualifiedName, options);
    if (qualifiedName.toLowerCase() === "style") {
      element.setAttribute("nonce", nonce);
    }
    return element;
  }) as typeof document.createElementNS;

  try {
    return await mermaid.render(id, normalizeMermaidSource(source));
  } finally {
    document.createElement = originalCreateElement;
    document.createElementNS = originalCreateElementNS;
  }
}

function markMermaidError(container: HTMLElement, theme: string) {
  const output = container.querySelector<HTMLElement>(MERMAID_OUTPUT_SELECTOR);
  const error = container.querySelector<HTMLElement>(MERMAID_ERROR_SELECTOR);
  if (output) {
    output.innerHTML = "";
  }
  if (error) {
    error.textContent = MERMAID_RENDER_ERROR_TEXT;
  }
  container.dataset.mermaidTheme = theme;
  container.setAttribute("data-mermaid-state", "error");
}

async function renderMermaidContainer(
  mermaid: MermaidApi,
  container: HTMLElement,
  id: string,
  nonce: string | null,
  theme: string
) {
  const fallback = container.querySelector<HTMLPreElement>(
    MERMAID_FALLBACK_SELECTOR
  );
  const output = container.querySelector<HTMLElement>(MERMAID_OUTPUT_SELECTOR);
  const error = container.querySelector<HTMLElement>(MERMAID_ERROR_SELECTOR);
  const source = fallback?.textContent ?? "";

  if (!fallback || !output || !source.trim()) {
    markMermaidError(container, theme);
    return;
  }
  if (source.length > MERMAID_MAX_SOURCE_CHARS) {
    markMermaidError(container, theme);
    return;
  }

  output.innerHTML = "";
  if (error) {
    error.textContent = "";
  }
  container.dataset.mermaidTheme = theme;
  container.setAttribute("data-mermaid-state", "loading");

  try {
    const result = await renderMermaidWithStyleNonce(mermaid, id, source, nonce);
    output.innerHTML = addNonceToMermaidSvg(result.svg, nonce);
    container.dataset.mermaidTheme = theme;
    container.setAttribute("data-mermaid-state", "rendered");
  } catch {
    markMermaidError(container, theme);
  }
}

function mermaidContainersNeedingRender(theme: string) {
  const markdownRoot =
    document.querySelector<HTMLElement>(MARKDOWN_BODY_SELECTOR);
  if (!markdownRoot) {
    return [];
  }

  return Array.from(
    markdownRoot.querySelectorAll<HTMLElement>(MERMAID_RENDER_SELECTOR)
  )
    .map((container, index) => ({ container, index }))
    .filter(
      ({ container }) =>
        container.getAttribute("data-mermaid-state") !== "loading" &&
        container.dataset.mermaidTheme !== theme
    );
}

export function MermaidRenderer({
  gistId,
  revisionNumber
}: MermaidRendererProps) {
  useEffect(() => {
    let cancelled = false;
    let renderGeneration = 0;
    let renderTimeout: number | null = null;

    async function renderAll() {
      const generation = ++renderGeneration;
      const theme = currentMermaidTheme();
      const containers = mermaidContainersNeedingRender(theme);
      if (!containers.length) {
        return;
      }
      const renderableContainers = containers.slice(0, MERMAID_MAX_DIAGRAMS);
      containers
        .slice(MERMAID_MAX_DIAGRAMS)
        .forEach(({ container }) => markMermaidError(container, theme));

      let mermaid: MermaidApi;
      try {
        mermaid = await loadMermaid();
      } catch {
        renderableContainers.forEach(({ container }) =>
          markMermaidError(container, theme)
        );
        return;
      }

      if (cancelled || generation !== renderGeneration) {
        return;
      }

      configureMermaid(mermaid, theme);
      const nonce = cspNonce();
      for (const { container, index } of renderableContainers) {
        if (cancelled || generation !== renderGeneration) {
          return;
        }
        await renderMermaidContainer(
          mermaid,
          container,
          mermaidRenderId(gistId, revisionNumber, index),
          nonce,
          theme
        );
      }
    }

    function scheduleRender() {
      if (renderTimeout !== null) {
        window.clearTimeout(renderTimeout);
      }
      renderTimeout = window.setTimeout(() => {
        if (!cancelled) {
          void renderAll();
        }
      }, 0);
    }

    const domObserver = new MutationObserver(scheduleRender);
    domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    const themeObserver = new MutationObserver(scheduleRender);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    scheduleRender();

    return () => {
      cancelled = true;
      renderGeneration += 1;
      if (renderTimeout !== null) {
        window.clearTimeout(renderTimeout);
      }
      domObserver.disconnect();
      themeObserver.disconnect();
    };
  }, [gistId, revisionNumber]);

  return null;
}
