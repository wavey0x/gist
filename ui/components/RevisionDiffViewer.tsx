"use client";

import { diffArrays, diffLines, diffWordsWithSpace } from "diff";
import type { Change } from "diff";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PublicGistPayload } from "../lib/gists";

type DiffRevision = Pick<
  PublicGistPayload,
  "revision_number" | "title" | "primary_file" | "files"
> &
  Partial<Pick<PublicGistPayload, "history" | "latest_revision_number">>;

export type RevisionDiffViewerProps = {
  fromRevision: DiffRevision;
  toRevision: DiffRevision;
};

type DiffLineKind = "context" | "removed" | "added" | "edited";

type WordPart = { value: string; change: "same" | "added" | "removed" };

type DiffLine = {
  key: string;
  kind: DiffLineKind;
  oldNumber: number | null;
  newNumber: number | null;
  content: string;
  compareContent?: string;
  parts?: WordPart[];
};

type CollapsedContext = {
  key: string;
  kind: "hunk";
  hidden: DiffLine[];
};

type DiffDisplayRow = DiffLine | CollapsedContext;

type BuiltDiff = {
  addedCount: number;
  removedCount: number;
  rows: DiffDisplayRow[];
};

// Prose (Markdown and plain text) wraps and folds small edits into one line.
// Code keeps one row per source line, old and new line numbers, and scrolls
// sideways, because line structure and indentation carry meaning there.
type DiffMode = "prose" | "code";

type FileDiff = {
  filename: string;
  status: "added" | "deleted" | "modified";
  mode: DiffMode;
  diff: BuiltDiff;
};

const CONTEXT_LINES = 3;
// An edited line is shown once, with inline marks, only when at least this
// share of it is unchanged. Below that it reads better as old then new.
const MERGE_SIMILARITY = 0.5;

function normalizeMarkdown(value: string) {
  return value.replace(/\r\n/g, "\n");
}

function splitDiffLines(value: string) {
  if (!value) {
    return [];
  }
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function createLine(
  key: string,
  kind: DiffLineKind,
  oldNumber: number | null,
  newNumber: number | null,
  content: string,
  compareContent?: string
): DiffLine {
  return { key, kind, oldNumber, newNumber, content, compareContent };
}

// Prose compares whole whitespace-separated tokens, so a figure such as 1.93m
// changes as one unit instead of splitting at its decimal point.
function wordParts(oldLine: string, newLine: string, mode: DiffMode = "code"): WordPart[] {
  const changes =
    mode === "prose"
      ? diffArrays(oldLine.split(/(\s+)/), newLine.split(/(\s+)/)).map((part) => ({
          ...part,
          value: part.value.join("")
        }))
      : diffWordsWithSpace(oldLine, newLine);
  const parts: WordPart[] = [];
  for (const part of changes) {
    if (!part.value) continue;
    const change = part.added ? "added" : part.removed ? "removed" : "same";
    const last = parts.at(-1);
    if (last && last.change === change) {
      last.value += part.value;
    } else {
      parts.push({ value: part.value, change });
    }
  }
  return parts;
}

function similarity(parts: WordPart[], oldLine: string, newLine: string) {
  const longest = Math.max(oldLine.trim().length, newLine.trim().length);
  if (!longest) {
    return 0;
  }
  const same = parts.reduce(
    (total, part) => total + (part.change === "same" ? part.value.trim().length : 0),
    0
  );
  return same / longest;
}

function lineGroups(change: Change) {
  return splitDiffLines(change.value);
}

function buildRawLines(oldMarkdown: string, newMarkdown: string, mode: DiffMode) {
  const changes = diffLines(
    normalizeMarkdown(oldMarkdown),
    normalizeMarkdown(newMarkdown),
    {
      ignoreNewlineAtEof: true
    }
  );
  const rows: DiffLine[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  let rowIndex = 0;

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const nextChange = changes[index + 1];

    if (change.removed && nextChange?.added) {
      const removedLines = lineGroups(change);
      const addedLines = lineGroups(nextChange);

      if (mode === "prose") {
        // Walk the two sides together so each rewritten paragraph sits next
        // to the one it replaced.
        const shared = Math.min(removedLines.length, addedLines.length);
        for (let lineIndex = 0; lineIndex < shared; lineIndex += 1) {
          const before = removedLines[lineIndex];
          const after = addedLines[lineIndex];
          const parts = wordParts(before, after, "prose");
          if (similarity(parts, before, after) >= MERGE_SIMILARITY) {
            rows.push({
              ...createLine(`line-${rowIndex}`, "edited", oldNumber, newNumber, after, before),
              parts
            });
            rowIndex += 1;
          } else {
            rows.push(createLine(`line-${rowIndex}`, "removed", oldNumber, null, before));
            rows.push(createLine(`line-${rowIndex + 1}`, "added", null, newNumber, after));
            rowIndex += 2;
          }
          oldNumber += 1;
          newNumber += 1;
        }
        removedLines.slice(shared).forEach((line) => {
          rows.push(createLine(`line-${rowIndex}`, "removed", oldNumber, null, line));
          oldNumber += 1;
          rowIndex += 1;
        });
        addedLines.slice(shared).forEach((line) => {
          rows.push(createLine(`line-${rowIndex}`, "added", null, newNumber, line));
          newNumber += 1;
          rowIndex += 1;
        });
        index += 1;
        continue;
      }

      removedLines.forEach((line, lineIndex) => {
        rows.push(
          createLine(
            `line-${rowIndex}`,
            "removed",
            oldNumber,
            null,
            line,
            addedLines[lineIndex]
          )
        );
        oldNumber += 1;
        rowIndex += 1;
      });

      addedLines.forEach((line, lineIndex) => {
        rows.push(
          createLine(
            `line-${rowIndex}`,
            "added",
            null,
            newNumber,
            line,
            removedLines[lineIndex]
          )
        );
        newNumber += 1;
        rowIndex += 1;
      });

      index += 1;
      continue;
    }

    const lines = lineGroups(change);
    lines.forEach((line) => {
      if (change.removed) {
        rows.push(
          createLine(`line-${rowIndex}`, "removed", oldNumber, null, line)
        );
        oldNumber += 1;
      } else if (change.added) {
        rows.push(
          createLine(`line-${rowIndex}`, "added", null, newNumber, line)
        );
        newNumber += 1;
      } else {
        rows.push(
          createLine(
            `line-${rowIndex}`,
            "context",
            oldNumber,
            newNumber,
            line
          )
        );
        oldNumber += 1;
        newNumber += 1;
      }
      rowIndex += 1;
    });
  }

  return rows;
}

function collapseContext(rows: DiffLine[]) {
  const changedIndexes = rows.reduce<number[]>((indexes, row, index) => {
    if (row.kind !== "context") {
      indexes.push(index);
    }
    return indexes;
  }, []);

  if (changedIndexes.length === 0) {
    return rows;
  }

  const visibleIndexes = new Set<number>();
  changedIndexes.forEach((changedIndex) => {
    const start = Math.max(0, changedIndex - CONTEXT_LINES);
    const end = Math.min(rows.length - 1, changedIndex + CONTEXT_LINES);
    for (let index = start; index <= end; index += 1) {
      visibleIndexes.add(index);
    }
  });

  const displayRows: DiffDisplayRow[] = [];
  let index = 0;

  while (index < rows.length) {
    if (visibleIndexes.has(index)) {
      displayRows.push(rows[index]);
      index += 1;
      continue;
    }

    const hiddenStart = index;
    while (index < rows.length && !visibleIndexes.has(index)) {
      index += 1;
    }
    const hiddenRows = rows.slice(hiddenStart, index);

    if (hiddenRows.length <= 2) {
      displayRows.push(...hiddenRows);
    } else {
      displayRows.push({
        key: `hunk-${hiddenStart}`,
        kind: "hunk",
        hidden: hiddenRows
      });
    }
  }

  return displayRows;
}

function buildDiff(oldMarkdown: string, newMarkdown: string, mode: DiffMode): BuiltDiff {
  const lines = buildRawLines(oldMarkdown, newMarkdown, mode);
  const count = (kind: DiffLineKind) =>
    lines.filter((line) => line.kind === kind || line.kind === "edited").length;
  const addedCount = count("added");
  const removedCount = count("removed");
  return {
    addedCount,
    removedCount,
    rows: addedCount || removedCount ? collapseContext(lines) : []
  };
}

function renderContent(line: DiffLine): ReactNode {
  if (line.kind === "edited" && line.parts) {
    return line.parts.map((part, index) =>
      part.change === "added" ? (
        <ins key={index}>{part.value}</ins>
      ) : part.change === "removed" ? (
        <del key={index}>{part.value}</del>
      ) : (
        <span key={index}>{part.value}</span>
      )
    );
  }
  if (
    line.compareContent === undefined ||
    line.kind === "context" ||
    line.content === line.compareContent
  ) {
    return line.content;
  }
  const parts =
    line.kind === "removed"
      ? wordParts(line.content, line.compareContent)
      : wordParts(line.compareContent, line.content);
  const hide = line.kind === "removed" ? "added" : "removed";
  return parts
    .filter((part) => part.change !== hide)
    .map((part, index) => (
      <span
        className={part.change === "same" ? undefined : `diff-word diff-word-${line.kind}`}
        key={index}
      >
        {part.value}
      </span>
    ));
}

const KIND_LABEL: Record<DiffLineKind, string> = {
  context: "",
  removed: "Removed: ",
  added: "Added: ",
  edited: "Edited: "
};

function DiffRows({ fileDiff }: { fileDiff: FileDiff }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const code = fileDiff.mode === "code";
  const columns = code ? 3 : 2;

  function renderLine(row: DiffLine) {
    return (
      <tr className={`diff-row diff-row-${row.kind}`} key={row.key}>
        {code ? (
          <td className="diff-line-number diff-line-number-old">{row.oldNumber ?? ""}</td>
        ) : null}
        <td className="diff-line-number">
          {row.newNumber ?? (code ? "" : <span aria-hidden="true">−</span>)}
        </td>
        <td className="diff-code">
          {row.kind === "context" ? null : (
            <span className="sr-only">{KIND_LABEL[row.kind]}</span>
          )}
          {renderContent(row)}
        </td>
      </tr>
    );
  }

  return (
    <div className="diff-table-scroll">
      <table
        className={`diff-table diff-table-${fileDiff.mode}`}
        aria-label={`${fileDiff.filename} changes`}
      >
        <colgroup>
          {code ? <col className="diff-col-number" /> : null}
          <col className="diff-col-number" />
          <col />
        </colgroup>
        <tbody>
          {fileDiff.diff.rows.map((row) =>
            row.kind !== "hunk" ? (
              renderLine(row)
            ) : expanded.has(row.key) ? (
              row.hidden.map(renderLine)
            ) : (
              <tr className="diff-hunk-row" key={row.key}>
                <td className="diff-hunk" colSpan={columns}>
                  <button
                    type="button"
                    className="diff-expand"
                    onClick={() => setExpanded((current) => new Set(current).add(row.key))}
                  >
                    Show {row.hidden.length} unchanged lines
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

function stepUrls(fromRevision: DiffRevision, toRevision: DiffRevision) {
  const from = fromRevision.revision_number;
  const to = toRevision.revision_number;
  const sample = toRevision.history?.[0]?.url;
  if (!sample || to !== from + 1) {
    return null;
  }
  const base = sample.replace(/\/revisions\/[1-9][0-9]*\/?$/, "").replace(/\/$/, "");
  const latest = toRevision.latest_revision_number ?? to;
  return {
    older: from > 1 ? `${base}/diff/${from - 1}..${from}` : null,
    newer: to < latest ? `${base}/diff/${to}..${to + 1}` : null
  };
}

function StepLink({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  return href ? (
    <a className="diff-step" href={href} aria-label={label} title={label}>
      {children}
    </a>
  ) : (
    <span className="diff-step" aria-disabled="true" aria-label={label} role="link">
      {children}
    </span>
  );
}

function Stats({ added, removed }: { added: number; removed: number }) {
  return (
    <div className="diff-viewer-stats" aria-label={`${added} additions and ${removed} deletions`}>
      <span className="diff-stat diff-stat-added">+{added}</span>
      <span className="diff-stat diff-stat-removed">−{removed}</span>
    </div>
  );
}

export function RevisionDiffViewer({
  fromRevision,
  toRevision
}: RevisionDiffViewerProps) {
  const summary = `Revision ${fromRevision.revision_number} to ${toRevision.revision_number}`;
  const titleChanged = fromRevision.title !== toRevision.title;
  const fileDiffs = useMemo(() => {
    const filenames = new Set([
      ...Object.keys(fromRevision.files),
      ...Object.keys(toRevision.files)
    ]);
    const orderedFilenames = [
      toRevision.primary_file,
      ...Array.from(filenames)
        .filter((filename) => filename !== toRevision.primary_file)
        .sort((left, right) => left.localeCompare(right))
    ];

    return orderedFilenames.flatMap<FileDiff>((filename) => {
      const oldFile = fromRevision.files[filename];
      const newFile = toRevision.files[filename];
      if (oldFile?.content === newFile?.content) {
        return [];
      }
      const mode: DiffMode =
        (newFile ?? oldFile)?.kind === "source" ? "code" : "prose";
      return [
        {
          filename,
          status: oldFile ? (newFile ? "modified" : "deleted") : "added",
          mode,
          diff: buildDiff(oldFile?.content ?? "", newFile?.content ?? "", mode)
        }
      ];
    });
  }, [fromRevision.files, toRevision.files, toRevision.primary_file]);
  const addedCount = fileDiffs.reduce(
    (total, fileDiff) => total + fileDiff.diff.addedCount,
    0
  );
  const removedCount = fileDiffs.reduce(
    (total, fileDiff) => total + fileDiff.diff.removedCount,
    0
  );
  const noChanges = !titleChanged && fileDiffs.length === 0;

  const steps = stepUrls(fromRevision, toRevision);
  const soleFile = fileDiffs.length === 1 ? fileDiffs[0] : null;

  return (
    <section className="diff-viewer" aria-label={`${summary} diff`}>
      <div className="diff-viewer-header">
        {soleFile ? <span className="diff-filename">{soleFile.filename}</span> : null}
        <div className="diff-range">
          {steps ? (
            <StepLink href={steps.older} label="Older changes">
              <ChevronLeft aria-hidden="true" size={15} strokeWidth={1.8} />
            </StepLink>
          ) : null}
          <h2 className="diff-viewer-title" aria-label={summary}>
            Revision {fromRevision.revision_number} → {toRevision.revision_number}
          </h2>
          {steps ? (
            <StepLink href={steps.newer} label="Newer changes">
              <ChevronRight aria-hidden="true" size={15} strokeWidth={1.8} />
            </StepLink>
          ) : null}
        </div>
        {soleFile && soleFile.status !== "modified" ? (
          <span className="diff-file-status">{soleFile.status}</span>
        ) : null}
        <Stats added={addedCount} removed={removedCount} />
      </div>
      {titleChanged ? (
        <div className="diff-metadata-change" aria-label="Title changed">
          <span className="diff-metadata-label">Title</span>
          <span>
            <del>{fromRevision.title || "Untitled"}</del>{" "}
            <ins>{toRevision.title || "Untitled"}</ins>
          </span>
        </div>
      ) : null}
      {noChanges ? <div className="diff-empty">No changes</div> : null}
      {fileDiffs.map((fileDiff) => (
        <section className="diff-file" key={fileDiff.filename}>
          {soleFile ? null : (
            <header className="diff-file-header">
              <h3>{fileDiff.filename}</h3>
              <div className="diff-file-summary">
                {fileDiff.status !== "modified" ? <span>{fileDiff.status}</span> : null}
                <Stats added={fileDiff.diff.addedCount} removed={fileDiff.diff.removedCount} />
              </div>
            </header>
          )}
          <DiffRows fileDiff={fileDiff} />
        </section>
      ))}
    </section>
  );
}
