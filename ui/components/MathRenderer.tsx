"use client";

import { useEffect } from "react";

const MATH_RENDER_SELECTOR = ".js-math-render";
const MATH_FALLBACK_SELECTOR = ".math-render-fallback";
const MATH_OUTPUT_SELECTOR = ".math-render-output";
const MATH_MAX_EXPRESSIONS = 256;
const MATH_MAX_SOURCE_CHARS = 10000;

type KatexApi = typeof import("katex").default;

type MathRendererProps = {
  gistId: string;
  revisionNumber: number;
};

async function loadKatex(): Promise<KatexApi> {
  const katexModule = await import("katex");
  return katexModule.default;
}

function mathSource(container: HTMLElement) {
  const fallback = container.querySelector<HTMLElement>(
    MATH_FALLBACK_SELECTOR
  );
  const original = fallback?.textContent ?? "";
  if (original.length < 4) {
    return null;
  }

  const displayMode = container.classList.contains("math-display");
  const opener = displayMode ? "\\[" : "\\(";
  const closer = displayMode ? "\\]" : "\\)";
  if (!original.startsWith(opener) || !original.endsWith(closer)) {
    return null;
  }

  return {
    displayMode,
    source: original.slice(opener.length, -closer.length)
  };
}

function markMathError(container: HTMLElement) {
  const output = container.querySelector<HTMLElement>(MATH_OUTPUT_SELECTOR);
  output?.replaceChildren();
  container.dataset.mathState = "error";
}

function renderMathContainer(katex: KatexApi, container: HTMLElement) {
  const expression = mathSource(container);
  const output = container.querySelector<HTMLElement>(MATH_OUTPUT_SELECTOR);
  if (
    !expression ||
    !output ||
    expression.source.length > MATH_MAX_SOURCE_CHARS
  ) {
    markMathError(container);
    return;
  }

  container.dataset.mathState = "loading";
  output.replaceChildren();
  try {
    katex.render(expression.source, output, {
      displayMode: expression.displayMode,
      maxExpand: 1000,
      maxSize: 100,
      output: "htmlAndMathml",
      strict: "warn",
      throwOnError: true,
      trust: false
    });
    container.dataset.mathState = "rendered";
  } catch {
    markMathError(container);
  }
}

function mathContainersNeedingRender() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(MATH_RENDER_SELECTOR)
  ).filter((container) => !container.dataset.mathState);
}

export function MathRenderer({ gistId, revisionNumber }: MathRendererProps) {
  useEffect(() => {
    let cancelled = false;
    let renderTimeout: number | null = null;
    let katexPromise: Promise<KatexApi> | null = null;

    async function renderAll() {
      const containers = mathContainersNeedingRender();
      if (!containers.length) {
        return;
      }

      const renderable = containers.slice(0, MATH_MAX_EXPRESSIONS);
      containers.slice(MATH_MAX_EXPRESSIONS).forEach(markMathError);
      renderable.forEach((container) => {
        container.dataset.mathState = "loading";
      });

      katexPromise ??= loadKatex();
      let katex: KatexApi;
      try {
        katex = await katexPromise;
      } catch {
        renderable.forEach(markMathError);
        return;
      }

      if (cancelled) {
        return;
      }
      renderable.forEach((container) => {
        if (container.isConnected) {
          renderMathContainer(katex, container);
        }
      });
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

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes.length > 0)) {
        scheduleRender();
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    scheduleRender();
    return () => {
      cancelled = true;
      if (renderTimeout !== null) {
        window.clearTimeout(renderTimeout);
      }
      observer.disconnect();
    };
  }, [gistId, revisionNumber]);

  return null;
}
