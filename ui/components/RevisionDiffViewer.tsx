"use client";

import { useEffect, useState } from "react";
import ReactDiffViewer, {
  DiffMethod
} from "react-diff-viewer-continued";
import type { ReactDiffViewerStylesOverride } from "react-diff-viewer-continued";
import type { PublicGistPayload, RevisionDiffBase } from "../lib/gists";

export type RevisionDiffViewerProps = {
  gist: PublicGistPayload;
  previousRevision: RevisionDiffBase;
};

type Theme = "light" | "dark";

const MONO_FONT =
  "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace";

const diffStyles: ReactDiffViewerStylesOverride = {
  variables: {
    light: {
      diffViewerBackground: "var(--page-bg)",
      diffViewerTitleBackground: "var(--button-bg-active)",
      diffViewerColor: "var(--page-fg)",
      diffViewerTitleColor: "var(--muted-fg)",
      diffViewerTitleBorderColor: "var(--border)",
      addedBackground: "#dafbe1",
      addedColor: "#116329",
      removedBackground: "#ffebe9",
      removedColor: "#82071e",
      wordAddedBackground: "#aceebb",
      wordRemovedBackground: "#ffcecb",
      addedGutterBackground: "#ccffd8",
      addedGutterColor: "#116329",
      removedGutterBackground: "#ffd7d5",
      removedGutterColor: "#82071e",
      gutterBackground: "var(--button-bg-active)",
      gutterColor: "var(--muted-fg)",
      codeFoldGutterBackground: "var(--button-bg-active)",
      codeFoldBackground: "var(--button-bg-active)",
      codeFoldContentColor: "var(--muted-fg)",
      emptyLineBackground: "var(--page-bg)"
    },
    dark: {
      diffViewerBackground: "var(--page-bg)",
      diffViewerTitleBackground: "#151b23",
      diffViewerColor: "var(--page-fg)",
      diffViewerTitleColor: "var(--muted-fg)",
      diffViewerTitleBorderColor: "var(--border)",
      addedBackground: "#033a16",
      addedColor: "#aff5b4",
      removedBackground: "#67060c",
      removedColor: "#ffdcd7",
      wordAddedBackground: "#2ea04366",
      wordRemovedBackground: "#f8514966",
      addedGutterBackground: "#04260f",
      addedGutterColor: "#aff5b4",
      removedGutterBackground: "#4c080b",
      removedGutterColor: "#ffdcd7",
      gutterBackground: "#151b23",
      gutterBackgroundDark: "#151b23",
      gutterColor: "var(--muted-fg)",
      codeFoldGutterBackground: "#151b23",
      codeFoldBackground: "#151b23",
      codeFoldContentColor: "var(--muted-fg)",
      emptyLineBackground: "var(--page-bg)"
    }
  },
  diffContainer: {
    border: "1px solid var(--border)",
    borderRadius: "6px",
    background: "var(--page-bg)",
    color: "var(--page-fg)",
    fontFamily: MONO_FONT,
    fontSize: "13px",
    lineHeight: 1.5,
    overflow: "hidden"
  },
  summary: {
    minHeight: "34px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    borderBottom: "1px solid var(--border)",
    padding: "7px 10px",
    color: "var(--muted-fg)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
    fontSize: "12px",
    lineHeight: 1.35
  },
  allExpandButton: {
    display: "inline-grid",
    width: "22px",
    height: "22px",
    placeItems: "center",
    border: 0,
    background: "transparent",
    color: "var(--muted-fg)",
    padding: 0,
    cursor: "pointer"
  },
  content: {
    width: "100%"
  },
  contentText: {
    fontFamily: MONO_FONT,
    fontSize: "13px",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word"
  },
  lineContent: {
    width: "100%",
    padding: "0 10px"
  },
  gutter: {
    minWidth: "48px",
    padding: "0 8px",
    color: "var(--muted-fg)",
    textAlign: "right",
    userSelect: "none"
  },
  marker: {
    width: "28px",
    padding: "0 8px",
    textAlign: "center",
    userSelect: "none"
  },
  line: {
    verticalAlign: "top"
  },
  codeFoldContentContainer: {
    textAlign: "left"
  },
  codeFoldExpandButton: {
    width: "100%",
    border: 0,
    background: "transparent",
    color: "var(--muted-fg)",
    padding: "6px 10px",
    cursor: "pointer",
    fontFamily: MONO_FONT,
    fontSize: "12px",
    textAlign: "left"
  }
};

function documentTheme(): Theme {
  if (typeof document === "undefined") {
    return "light";
  }
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function useDocumentTheme() {
  const [theme, setTheme] = useState<Theme>(documentTheme);

  useEffect(() => {
    const root = document.documentElement;
    function updateTheme() {
      setTheme(documentTheme());
    }

    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export function RevisionDiffViewer({
  gist,
  previousRevision
}: RevisionDiffViewerProps) {
  const [mounted, setMounted] = useState(false);
  const theme = useDocumentTheme();
  const summary = `Revision ${previousRevision.revision_number} to ${gist.revision_number}`;

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <section className="diff-viewer" aria-label={`${summary} diff`}>
        <div className="diff-viewer-loading" role="status">
          Loading diff...
        </div>
      </section>
    );
  }

  return (
    <section className="diff-viewer" aria-label={`${summary} diff`}>
      <ReactDiffViewer
        oldValue={previousRevision.markdown}
        newValue={gist.markdown}
        compareMethod={DiffMethod.WORDS_WITH_SPACE}
        splitView={false}
        showDiffOnly={true}
        extraLinesSurroundingDiff={5}
        summary={summary}
        useDarkTheme={theme === "dark"}
        disableWorker={true}
        styles={diffStyles}
      />
    </section>
  );
}
