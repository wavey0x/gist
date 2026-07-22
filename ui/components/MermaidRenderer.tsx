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
const PANZOOM_COMPACT_HEIGHT_TOLERANCE = 24;
const PANZOOM_COMPACT_BREAKPOINT = 640;
const PANZOOM_COMPACT_DESKTOP_MIN_HEIGHT = 360;
const PANZOOM_COMPACT_DESKTOP_MAX_HEIGHT = 640;
const PANZOOM_COMPACT_MOBILE_MIN_HEIGHT = 280;
const PANZOOM_COMPACT_MOBILE_MAX_HEIGHT = 560;
const ZOOM_IN_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
const ZOOM_OUT_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
const RESET_VIEW_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 0-15.74-5.95L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15.74 5.95L21 16"/><path d="M16 16h5v5"/></svg>';
const EXPAND_DIAGRAM_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="m14 10 7-7"/><path d="M9 21H3v-6"/><path d="m10 14-7 7"/></svg>';
const COMPACT_DIAGRAM_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3v5H3"/><path d="m3 8 6-6"/><path d="M16 21v-5h5"/><path d="m21 16-6 6"/></svg>';

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

type PanZoomViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PanZoomContentBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PanZoomState = {
  scale: number;
  viewX: number;
  viewY: number;
  baseViewBox: PanZoomViewBox;
  isCompactable: boolean;
  isExpanded: boolean;
  dragPointerId: number | null;
  dragStartX: number;
  dragStartY: number;
  dragOriginViewX: number;
  dragOriginViewY: number;
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

function filenameIdentifier(filename: string) {
  return Array.from(new TextEncoder().encode(filename), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("-");
}

function mermaidRenderId(
  gistId: string,
  revisionNumber: number,
  filename: string,
  diagramIndex: number
) {
  const safeGistId = gistId.replace(/[^A-Za-z0-9_-]/g, "-");
  return `wg-mermaid-${safeGistId}-${revisionNumber}-${filenameIdentifier(filename)}-${diagramIndex}`;
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

function compactViewportHeight() {
  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 800;
  if (viewportWidth < PANZOOM_COMPACT_BREAKPOINT) {
    return Math.round(
      clamp(
        viewportHeight * 0.7,
        PANZOOM_COMPACT_MOBILE_MIN_HEIGHT,
        PANZOOM_COMPACT_MOBILE_MAX_HEIGHT
      )
    );
  }
  return Math.round(
    clamp(
      viewportHeight * 0.68,
      PANZOOM_COMPACT_DESKTOP_MIN_HEIGHT,
      PANZOOM_COMPACT_DESKTOP_MAX_HEIGHT
    )
  );
}

function readSvgViewBox(svg: SVGSVGElement): PanZoomViewBox | null {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width > 0 && viewBox.height > 0) {
    return {
      x: viewBox.x,
      y: viewBox.y,
      width: viewBox.width,
      height: viewBox.height
    };
  }

  const rawViewBox = svg.getAttribute("viewBox");
  const values = rawViewBox
    ?.trim()
    .split(/[\s,]+/)
    .map((value) => Number(value));

  if (
    values &&
    values.length === 4 &&
    values.every(Number.isFinite) &&
    values[2] > 0 &&
    values[3] > 0
  ) {
    return {
      x: values[0],
      y: values[1],
      width: values[2],
      height: values[3]
    };
  }

  return null;
}

function visibleViewBox(state: PanZoomState) {
  return {
    width: state.baseViewBox.width / state.scale,
    height: state.baseViewBox.height / state.scale
  };
}

function panZoomAvailableWidth(viewport: HTMLElement) {
  return (
    viewport.clientWidth ||
    viewport.closest<HTMLElement>(MARKDOWN_BODY_SELECTOR)?.clientWidth ||
    viewport.parentElement?.clientWidth ||
    0
  );
}

function svgContentBox(
  state: PanZoomState,
  svg: SVGSVGElement
): PanZoomContentBox | null {
  const rect = svg.getBoundingClientRect();
  const view = visibleViewBox(state);
  if (!rect.width || !rect.height || !view.width || !view.height) {
    return null;
  }

  const rectAspect = rect.width / rect.height;
  const viewAspect = view.width / view.height;
  if (rectAspect > viewAspect) {
    const width = rect.height * viewAspect;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top,
      width,
      height: rect.height
    };
  }

  const height = rect.width / viewAspect;
  return {
    left: rect.left,
    top: rect.top + (rect.height - height) / 2,
    width: rect.width,
    height
  };
}

function clampPanZoom(state: PanZoomState) {
  const { width, height } = visibleViewBox(state);
  const maxX = state.baseViewBox.width - width;
  const maxY = state.baseViewBox.height - height;

  if (!width || !height) {
    state.viewX = 0;
    state.viewY = 0;
    return;
  }

  if (maxX <= 0) {
    state.viewX = maxX / 2;
  } else {
    state.viewX = clamp(state.viewX, 0, maxX);
  }

  if (maxY <= 0) {
    state.viewY = maxY / 2;
  } else {
    state.viewY = clamp(state.viewY, 0, maxY);
  }
}

function syncLayoutButton(
  state: PanZoomState,
  layoutButton: HTMLButtonElement
) {
  layoutButton.hidden = !state.isCompactable;
  const label = state.isExpanded ? "Compact diagram" : "Expand diagram";
  layoutButton.setAttribute("aria-label", label);
  layoutButton.title = label;
  layoutButton.innerHTML = state.isExpanded
    ? COMPACT_DIAGRAM_ICON
    : EXPAND_DIAGRAM_ICON;
}

function updatePanZoomLayout(
  state: PanZoomState,
  viewport: HTMLElement,
  layoutButton: HTMLButtonElement
) {
  const availableWidth = panZoomAvailableWidth(viewport);
  const compactHeight = compactViewportHeight();
  const naturalHeight =
    availableWidth > 0
      ? (availableWidth * state.baseViewBox.height) / state.baseViewBox.width
      : 0;

  state.isCompactable =
    naturalHeight > compactHeight + PANZOOM_COMPACT_HEIGHT_TOLERANCE;
  if (!state.isCompactable) {
    state.isExpanded = false;
  }

  const layout =
    state.isCompactable && !state.isExpanded ? "compact" : "expanded";
  viewport.dataset.panzoomLayout = layout;
  viewport.style.setProperty("--mermaid-compact-height", `${compactHeight}px`);
  syncLayoutButton(state, layoutButton);
}

function applyPanZoom(
  state: PanZoomState,
  viewport: HTMLElement,
  svg: SVGSVGElement
) {
  clampPanZoom(state);
  const { width, height } = visibleViewBox(state);
  // Zoom through the SVG viewBox so text and edges stay vector-crisp.
  svg.setAttribute(
    "viewBox",
    `${state.baseViewBox.x + state.viewX} ${state.baseViewBox.y + state.viewY} ${width} ${height}`
  );
  viewport.dataset.panzoomScale = state.scale.toFixed(2);
}

function setPanZoomScale(
  state: PanZoomState,
  viewport: HTMLElement,
  svg: SVGSVGElement,
  scale: number,
  clientX?: number,
  clientY?: number
) {
  const nextScale = clamp(scale, PANZOOM_MIN_SCALE, PANZOOM_MAX_SCALE);
  const contentBox = svgContentBox(state, svg);
  const focalX =
    clientX === undefined || !contentBox
      ? 0.5
      : clamp((clientX - contentBox.left) / contentBox.width, 0, 1);
  const focalY =
    clientY === undefined || !contentBox
      ? 0.5
      : clamp((clientY - contentBox.top) / contentBox.height, 0, 1);
  const currentView = visibleViewBox(state);
  const contentX = state.viewX + focalX * currentView.width;
  const contentY = state.viewY + focalY * currentView.height;

  state.scale = nextScale;
  const nextView = visibleViewBox(state);
  state.viewX = contentX - focalX * nextView.width;
  state.viewY = contentY - focalY * nextView.height;
  applyPanZoom(state, viewport, svg);
}

function resetPanZoom(
  state: PanZoomState,
  viewport: HTMLElement,
  svg: SVGSVGElement
) {
  state.scale = 1;
  state.viewX = 0;
  state.viewY = 0;
  applyPanZoom(state, viewport, svg);
}

function createPanZoomButton(
  label: string,
  icon: string,
  onClick: (button: HTMLButtonElement) => void
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
    onClick(button);
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

  const baseViewBox = readSvgViewBox(svg);
  if (!baseViewBox) {
    return;
  }

  svg.style.width = "100%";
  svg.style.maxWidth = "none";
  svg.style.height = "auto";
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

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
    viewX: 0,
    viewY: 0,
    baseViewBox,
    isCompactable: false,
    isExpanded: false,
    dragPointerId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginViewX: 0,
    dragOriginViewY: 0,
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

  const layoutButton = createPanZoomButton(
    "Expand diagram",
    EXPAND_DIAGRAM_ICON,
    (button) => {
      revealControls();
      state.isExpanded = !state.isExpanded;
      updatePanZoomLayout(state, viewport, button);
      resetPanZoom(state, viewport, svg);
    }
  );

  controls.append(
    createPanZoomButton("Zoom in", ZOOM_IN_ICON, () => {
      revealControls();
      setPanZoomScale(state, viewport, svg, state.scale * PANZOOM_STEP);
    }),
    createPanZoomButton("Zoom out", ZOOM_OUT_ICON, () => {
      revealControls();
      setPanZoomScale(state, viewport, svg, state.scale / PANZOOM_STEP);
    }),
    createPanZoomButton("Reset view", RESET_VIEW_ICON, () => {
      revealControls();
      resetPanZoom(state, viewport, svg);
    }),
    layoutButton
  );
  syncLayoutButton(state, layoutButton);

  viewport.append(canvas, controls);
  output.replaceChildren(viewport);
  updatePanZoomLayout(state, viewport, layoutButton);

  const startDrag = (pointerId: number, point: PanZoomPoint) => {
    state.dragPointerId = pointerId;
    state.dragStartX = point.clientX;
    state.dragStartY = point.clientY;
    state.dragOriginViewX = state.viewX;
    state.dragOriginViewY = state.viewY;
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
        svg,
        state.pinchStartScale * (distance / state.pinchStartDistance),
        center.clientX,
        center.clientY
      );
      event.preventDefault();
      return;
    }

    if (state.dragPointerId === event.pointerId) {
      const contentBox = svgContentBox(state, svg);
      const currentView = visibleViewBox(state);
      const deltaX = contentBox?.width
        ? ((event.clientX - state.dragStartX) / contentBox.width) *
          currentView.width
        : 0;
      const deltaY = contentBox?.height
        ? ((event.clientY - state.dragStartY) / contentBox.height) *
          currentView.height
        : 0;

      state.viewX = state.dragOriginViewX - deltaX;
      state.viewY = state.dragOriginViewY - deltaY;
      applyPanZoom(state, viewport, svg);
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
    const activeElement = document.activeElement;
    const viewportHasFocus =
      activeElement instanceof Element && viewport.contains(activeElement);

    if (!viewportHasFocus && !event.ctrlKey && !event.metaKey) {
      return;
    }

    revealControls();
    event.preventDefault();
    const scaleFactor = event.deltaY < 0 ? PANZOOM_STEP : 1 / PANZOOM_STEP;
    setPanZoomScale(
      state,
      viewport,
      svg,
      state.scale * scaleFactor,
      event.clientX,
      event.clientY
    );
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "+" || event.key === "=") {
      revealControls();
      setPanZoomScale(state, viewport, svg, state.scale * PANZOOM_STEP);
      event.preventDefault();
    } else if (event.key === "-") {
      revealControls();
      setPanZoomScale(state, viewport, svg, state.scale / PANZOOM_STEP);
      event.preventDefault();
    } else if (event.key === "0" || event.key === "Escape") {
      revealControls();
      resetPanZoom(state, viewport, svg);
      event.preventDefault();
    }
  };

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          updatePanZoomLayout(state, viewport, layoutButton);
          resetPanZoom(state, viewport, svg);
        });

  const handleWindowResize = () => {
    updatePanZoomLayout(state, viewport, layoutButton);
    resetPanZoom(state, viewport, svg);
  };

  viewport.addEventListener("pointerdown", handlePointerDown);
  viewport.addEventListener("pointermove", handlePointerMove);
  viewport.addEventListener("pointerup", handlePointerEnd);
  viewport.addEventListener("pointercancel", handlePointerEnd);
  viewport.addEventListener("wheel", handleWheel, { passive: false });
  viewport.addEventListener("keydown", handleKeyDown);
  viewport.addEventListener("focusin", revealControls);
  viewport.addEventListener("pointerenter", revealControls);
  window.addEventListener("resize", handleWindowResize);
  resizeObserver?.observe(viewport);

  window.requestAnimationFrame(() => {
    updatePanZoomLayout(state, viewport, layoutButton);
    resetPanZoom(state, viewport, svg);
  });

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
    window.removeEventListener("resize", handleWindowResize);
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
  theme: string,
  shouldCancel: () => boolean
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
  if (shouldCancel() || !container.isConnected) {
    return;
  }

  const hasRenderedOutput =
    container.getAttribute("data-mermaid-state") === "rendered" &&
    Boolean(output.querySelector("svg"));
  if (!hasRenderedOutput) {
    destroyMermaidPanZoom(output);
    output.innerHTML = "";
  }
  if (error) {
    error.textContent = "";
  }
  container.dataset.mermaidTheme = theme;
  container.setAttribute("data-mermaid-state", "loading");

  try {
    const result = await renderMermaidWithStyleNonce(mermaid, id, source, nonce);
    if (shouldCancel() || !container.isConnected) {
      return;
    }
    destroyMermaidPanZoom(output);
    output.innerHTML = addNonceToMermaidSvg(result.svg, nonce);
    initializeMermaidPanZoom(output);
    container.dataset.mermaidTheme = theme;
    container.setAttribute("data-mermaid-state", "rendered");
  } catch {
    if (shouldCancel() || !container.isConnected) {
      return;
    }
    markMermaidError(container, theme);
  }
}

function mermaidContainersNeedingRender(theme: string) {
  return Array.from(
    document.querySelectorAll<HTMLElement>(MARKDOWN_BODY_SELECTOR)
  )
    .flatMap((markdownRoot, rootIndex) => {
      const filename =
        markdownRoot.closest<HTMLElement>("[data-gist-filename]")?.dataset
          .gistFilename ?? `document-${rootIndex}`;
      return Array.from(
        markdownRoot.querySelectorAll<HTMLElement>(MERMAID_RENDER_SELECTOR)
      ).map((container, diagramIndex) => ({
        container,
        diagramIndex,
        filename
      }));
    })
    .filter(
      ({ container }) =>
        container.getAttribute("data-mermaid-state") !== "loading" &&
        container.dataset.mermaidTheme !== theme
    );
}

function nodeContainsMermaidRenderSurface(node: Node) {
  if (!(node instanceof Element)) {
    return false;
  }
  return (
    node.matches(MARKDOWN_BODY_SELECTOR) ||
    node.matches(MERMAID_RENDER_SELECTOR) ||
    Boolean(
      node.querySelector(`${MARKDOWN_BODY_SELECTOR}, ${MERMAID_RENDER_SELECTOR}`)
    )
  );
}

function mutationsTouchMermaidRenderSurface(mutations: MutationRecord[]) {
  return mutations.some((mutation) => {
    if (
      mutation.target instanceof Element &&
      mutation.target.closest(MARKDOWN_BODY_SELECTOR)
    ) {
      return true;
    }
    return Array.from(mutation.addedNodes).some(nodeContainsMermaidRenderSurface);
  });
}

export function MermaidRenderer({
  gistId,
  revisionNumber
}: MermaidRendererProps) {
  useEffect(() => {
    let cancelled = false;
    let renderTimeout: number | null = null;
    let renderInProgress = false;
    let renderAgain = false;

    async function renderPass() {
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

      if (cancelled) {
        return;
      }

      configureMermaid(mermaid, theme);
      const nonce = cspNonce();
      for (const { container, diagramIndex, filename } of renderableContainers) {
        if (cancelled) {
          return;
        }
        await renderMermaidContainer(
          mermaid,
          container,
          mermaidRenderId(
            gistId,
            revisionNumber,
            filename,
            diagramIndex
          ),
          nonce,
          theme,
          () => cancelled
        );
      }
    }

    async function renderAll() {
      if (renderInProgress) {
        renderAgain = true;
        return;
      }

      renderInProgress = true;
      try {
        do {
          renderAgain = false;
          await renderPass();
        } while (!cancelled && renderAgain);
      } finally {
        renderInProgress = false;
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

    const domObserver = new MutationObserver((mutations) => {
      if (mutationsTouchMermaidRenderSurface(mutations)) {
        scheduleRender();
      }
    });
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
      renderAgain = false;
      if (renderTimeout !== null) {
        window.clearTimeout(renderTimeout);
      }
      domObserver.disconnect();
      themeObserver.disconnect();
    };
  }, [gistId, revisionNumber]);

  return null;
}
