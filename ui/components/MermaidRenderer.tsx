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
const PANZOOM_MIN_SCALE = 0.5;
const PANZOOM_MAX_SCALE = 4;
const PANZOOM_STEP = 1.2;
const PANZOOM_CONTROLS_VISIBLE_MS = 2500;
const ZOOM_IN_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
const ZOOM_OUT_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
const RESET_VIEW_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.34-5.66"/><path d="M4 4v6h6"/></svg>';
const PAN_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2v20"/><path d="m8 6 4-4 4 4"/><path d="m8 18 4 4 4-4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/><path d="m18 8 4 4-4 4"/></svg>';

const mermaidPanZoomCleanups = new WeakMap<HTMLElement, () => void>();

type MermaidApi = {
  initialize: (options: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

type MermaidRendererProps = {
  gistId: string;
  revisionNumber: number;
};

type PanZoomPoint = {
  clientX: number;
  clientY: number;
};

type PanZoomState = {
  scale: number;
  x: number;
  y: number;
  dragPointerId: number | null;
  dragStartX: number;
  dragStartY: number;
  dragOriginX: number;
  dragOriginY: number;
  pinchStartDistance: number | null;
  pinchStartScale: number;
  pointers: Map<number, PanZoomPoint>;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pointDistance(first: PanZoomPoint, second: PanZoomPoint) {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function pointCenter(first: PanZoomPoint, second: PanZoomPoint) {
  return {
    clientX: (first.clientX + second.clientX) / 2,
    clientY: (first.clientY + second.clientY) / 2
  };
}

function clampPanZoom(
  state: PanZoomState,
  viewport: HTMLElement,
  canvas: HTMLElement
) {
  const viewportWidth = viewport.clientWidth;
  const viewportHeight = viewport.clientHeight;
  const contentWidth = canvas.offsetWidth * state.scale;
  const contentHeight = canvas.offsetHeight * state.scale;

  if (!viewportWidth || !viewportHeight || !contentWidth || !contentHeight) {
    state.x = 0;
    state.y = 0;
    return;
  }

  if (contentWidth <= viewportWidth) {
    state.x = (viewportWidth - contentWidth) / 2;
  } else {
    state.x = clamp(state.x, viewportWidth - contentWidth, 0);
  }

  if (contentHeight <= viewportHeight) {
    state.y = (viewportHeight - contentHeight) / 2;
  } else {
    state.y = clamp(state.y, viewportHeight - contentHeight, 0);
  }
}

function applyPanZoom(
  state: PanZoomState,
  viewport: HTMLElement,
  canvas: HTMLElement
) {
  clampPanZoom(state, viewport, canvas);
  canvas.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
  viewport.dataset.panzoomScale = state.scale.toFixed(2);
}

function setPanZoomScale(
  state: PanZoomState,
  viewport: HTMLElement,
  canvas: HTMLElement,
  scale: number,
  clientX?: number,
  clientY?: number
) {
  const nextScale = clamp(scale, PANZOOM_MIN_SCALE, PANZOOM_MAX_SCALE);
  const rect = viewport.getBoundingClientRect();
  const focalX = clientX === undefined ? rect.width / 2 : clientX - rect.left;
  const focalY = clientY === undefined ? rect.height / 2 : clientY - rect.top;
  const contentX = (focalX - state.x) / state.scale;
  const contentY = (focalY - state.y) / state.scale;

  state.scale = nextScale;
  state.x = focalX - contentX * nextScale;
  state.y = focalY - contentY * nextScale;
  applyPanZoom(state, viewport, canvas);
}

function resetPanZoom(
  state: PanZoomState,
  viewport: HTMLElement,
  canvas: HTMLElement
) {
  state.scale = 1;
  state.x = 0;
  state.y = 0;
  applyPanZoom(state, viewport, canvas);
}

function createPanZoomButton(
  label: string,
  icon: string,
  onClick: () => void
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mermaid-panzoom-button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = icon;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function destroyMermaidPanZoom(output: HTMLElement) {
  const cleanup = mermaidPanZoomCleanups.get(output);
  if (cleanup) {
    cleanup();
    mermaidPanZoomCleanups.delete(output);
  }
}

function initializeMermaidPanZoom(output: HTMLElement) {
  destroyMermaidPanZoom(output);

  const svg = output.querySelector<SVGSVGElement>("svg");
  if (!svg) {
    return;
  }

  svg.style.width = "100%";
  svg.style.maxWidth = "none";
  svg.style.height = "auto";

  const viewport = document.createElement("div");
  viewport.className = "mermaid-panzoom";
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "group");
  viewport.setAttribute(
    "aria-label",
    "Interactive Mermaid diagram with zoom and pan controls"
  );
  viewport.setAttribute("data-panzoom-state", "idle");

  const canvas = document.createElement("div");
  canvas.className = "mermaid-panzoom-canvas";
  canvas.appendChild(svg);

  const controls = document.createElement("div");
  controls.className = "mermaid-panzoom-controls";
  controls.setAttribute("aria-label", "Mermaid diagram controls");

  const state: PanZoomState = {
    scale: 1,
    x: 0,
    y: 0,
    dragPointerId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
    pinchStartDistance: null,
    pinchStartScale: 1,
    pointers: new Map()
  };

  let controlsHideTimeout: number | null = null;
  const revealControls = () => {
    viewport.dataset.panzoomControls = "visible";
    if (controlsHideTimeout !== null) {
      window.clearTimeout(controlsHideTimeout);
    }
    controlsHideTimeout = window.setTimeout(() => {
      delete viewport.dataset.panzoomControls;
      controlsHideTimeout = null;
    }, PANZOOM_CONTROLS_VISIBLE_MS);
  };

  controls.append(
    createPanZoomButton("Zoom in", ZOOM_IN_ICON, () => {
      revealControls();
      setPanZoomScale(state, viewport, canvas, state.scale * PANZOOM_STEP);
    }),
    createPanZoomButton("Zoom out", ZOOM_OUT_ICON, () => {
      revealControls();
      setPanZoomScale(state, viewport, canvas, state.scale / PANZOOM_STEP);
    }),
    createPanZoomButton("Reset view", RESET_VIEW_ICON, () => {
      revealControls();
      resetPanZoom(state, viewport, canvas);
    })
  );

  const panAffordance = document.createElement("span");
  panAffordance.className = "mermaid-panzoom-grip";
  panAffordance.title = "Drag to pan";
  panAffordance.innerHTML = PAN_ICON;
  controls.prepend(panAffordance);

  viewport.append(canvas, controls);
  output.replaceChildren(viewport);

  const startDrag = (pointerId: number, point: PanZoomPoint) => {
    state.dragPointerId = pointerId;
    state.dragStartX = point.clientX;
    state.dragStartY = point.clientY;
    state.dragOriginX = state.x;
    state.dragOriginY = state.y;
    viewport.setAttribute("data-panzoom-state", "dragging");
  };

  const startPinch = () => {
    const [first, second] = Array.from(state.pointers.values());
    if (!first || !second) {
      return;
    }
    state.dragPointerId = null;
    state.pinchStartDistance = pointDistance(first, second);
    state.pinchStartScale = state.scale;
    viewport.setAttribute("data-panzoom-state", "dragging");
  };

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button")) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    revealControls();
    viewport.focus({ preventScroll: true });
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events may not have an active pointer to capture.
    }
    state.pointers.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY
    });

    if (state.pointers.size >= 2) {
      startPinch();
    } else {
      startDrag(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY
      });
    }
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!state.pointers.has(event.pointerId)) {
      return;
    }

    state.pointers.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY
    });
    revealControls();

    if (state.pointers.size >= 2 && state.pinchStartDistance) {
      const [first, second] = Array.from(state.pointers.values());
      if (!first || !second) {
        return;
      }
      const center = pointCenter(first, second);
      const distance = pointDistance(first, second);
      setPanZoomScale(
        state,
        viewport,
        canvas,
        state.pinchStartScale * (distance / state.pinchStartDistance),
        center.clientX,
        center.clientY
      );
      event.preventDefault();
      return;
    }

    if (state.dragPointerId === event.pointerId) {
      state.x = state.dragOriginX + event.clientX - state.dragStartX;
      state.y = state.dragOriginY + event.clientY - state.dragStartY;
      applyPanZoom(state, viewport, canvas);
      event.preventDefault();
    }
  };

  const handlePointerEnd = (event: PointerEvent) => {
    state.pointers.delete(event.pointerId);
    try {
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore synthetic or already-released pointers.
    }

    state.pinchStartDistance = null;
    if (state.pointers.size === 1) {
      const [[pointerId, point]] = Array.from(state.pointers.entries());
      startDrag(pointerId, point);
      return;
    }

    state.dragPointerId = null;
    viewport.setAttribute("data-panzoom-state", "idle");
  };

  const handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    revealControls();
    event.preventDefault();
    const scaleFactor = event.deltaY < 0 ? PANZOOM_STEP : 1 / PANZOOM_STEP;
    setPanZoomScale(
      state,
      viewport,
      canvas,
      state.scale * scaleFactor,
      event.clientX,
      event.clientY
    );
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "+" || event.key === "=") {
      revealControls();
      setPanZoomScale(state, viewport, canvas, state.scale * PANZOOM_STEP);
      event.preventDefault();
    } else if (event.key === "-") {
      revealControls();
      setPanZoomScale(state, viewport, canvas, state.scale / PANZOOM_STEP);
      event.preventDefault();
    } else if (event.key === "0" || event.key === "Escape") {
      revealControls();
      resetPanZoom(state, viewport, canvas);
      event.preventDefault();
    }
  };

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => resetPanZoom(state, viewport, canvas));

  viewport.addEventListener("pointerdown", handlePointerDown);
  viewport.addEventListener("pointermove", handlePointerMove);
  viewport.addEventListener("pointerup", handlePointerEnd);
  viewport.addEventListener("pointercancel", handlePointerEnd);
  viewport.addEventListener("wheel", handleWheel, { passive: false });
  viewport.addEventListener("keydown", handleKeyDown);
  viewport.addEventListener("focusin", revealControls);
  viewport.addEventListener("pointerenter", revealControls);
  resizeObserver?.observe(viewport);

  window.requestAnimationFrame(() => resetPanZoom(state, viewport, canvas));

  mermaidPanZoomCleanups.set(output, () => {
    if (controlsHideTimeout !== null) {
      window.clearTimeout(controlsHideTimeout);
    }
    resizeObserver?.disconnect();
    viewport.removeEventListener("pointerdown", handlePointerDown);
    viewport.removeEventListener("pointermove", handlePointerMove);
    viewport.removeEventListener("pointerup", handlePointerEnd);
    viewport.removeEventListener("pointercancel", handlePointerEnd);
    viewport.removeEventListener("wheel", handleWheel);
    viewport.removeEventListener("keydown", handleKeyDown);
    viewport.removeEventListener("focusin", revealControls);
    viewport.removeEventListener("pointerenter", revealControls);
  });
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
    destroyMermaidPanZoom(output);
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

  destroyMermaidPanZoom(output);
  output.innerHTML = "";
  if (error) {
    error.textContent = "";
  }
  container.dataset.mermaidTheme = theme;
  container.setAttribute("data-mermaid-state", "loading");

  try {
    const result = await renderMermaidWithStyleNonce(mermaid, id, source, nonce);
    output.innerHTML = addNonceToMermaidSvg(result.svg, nonce);
    initializeMermaidPanZoom(output);
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
