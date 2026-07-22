"use client";

import { diffLines, diffWordsWithSpace } from "diff";
import type { Change } from "diff";
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { PublicGistPayload } from "../lib/gists";

type DiffRevision = Pick<
  PublicGistPayload,
  "revision_number" | "title" | "primary_file" | "files"
>;

export type RevisionDiffViewerProps = {
  fromRevision: DiffRevision;
  toRevision: DiffRevision;
};

type DiffLineKind = "context" | "removed" | "added";

type DiffLine = {
  key: string;
  kind: DiffLineKind;
  oldNumber: number | null;
  newNumber: number | null;
  marker: " " | "-" | "+";
  content: string;
  compareContent?: string;
};

type CollapsedContext = {
  key: string;
  kind: "hunk";
  hiddenCount: number;
};

type DiffDisplayRow = DiffLine | CollapsedContext;

type BuiltDiff = {
  addedCount: number;
  removedCount: number;
  rows: DiffDisplayRow[];
};

type FileDiff = {
  filename: string;
  status: "added" | "deleted" | "modified";
  diff: BuiltDiff;
};

const CONTEXT_LINES = 4;

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
  return {
    key,
    kind,
    oldNumber,
    newNumber,
    marker: kind === "removed" ? "-" : kind === "added" ? "+" : " ",
    content,
    compareContent
  };
}

function lineGroups(change: Change) {
  return splitDiffLines(change.value);
}

function buildRawLines(oldMarkdown: string, newMarkdown: string) {
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
        hiddenCount: hiddenRows.length
      });
    }
  }

  return displayRows;
}

function buildDiff(oldMarkdown: string, newMarkdown: string): BuiltDiff {
  const lines = buildRawLines(oldMarkdown, newMarkdown);
  const addedCount = lines.filter((line) => line.kind === "added").length;
  const removedCount = lines.filter((line) => line.kind === "removed").length;
  return {
    addedCount,
    removedCount,
    rows: addedCount || removedCount ? collapseContext(lines) : []
  };
}

function renderWordDiff(line: DiffLine): ReactNode {
  if (
    !line.compareContent ||
    line.kind === "context" ||
    line.content === line.compareContent
  ) {
    return line.content;
  }

  const wordDiff =
    line.kind === "removed"
      ? diffWordsWithSpace(line.content, line.compareContent)
      : diffWordsWithSpace(line.compareContent, line.content);
  return wordDiff
    .filter((part) => {
      if (line.kind === "removed") {
        return !part.added;
      }
      return !part.removed;
    })
    .map((part, index) => {
      const highlighted =
        line.kind === "removed" ? part.removed : part.added;
      return (
        <span
          className={highlighted ? `diff-word diff-word-${line.kind}` : undefined}
          key={index}
        >
          {part.value}
        </span>
      );
    });
}

function lineNumber(value: number | null) {
  return value === null ? "" : value;
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
      return [
        {
          filename,
          status: oldFile ? (newFile ? "modified" : "deleted") : "added",
          diff: buildDiff(oldFile?.content ?? "", newFile?.content ?? "")
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

  return (
    <section className="diff-viewer" aria-label={`${summary} diff`}>
      <div className="diff-viewer-header">
        <h2 className="diff-viewer-title">{summary}</h2>
        <div
          className="diff-viewer-stats"
          aria-label={`${addedCount} additions and ${removedCount} deletions`}
        >
          <span className="diff-stat diff-stat-added">+{addedCount}</span>
          <span className="diff-stat diff-stat-removed">
            -{removedCount}
          </span>
        </div>
      </div>
      {titleChanged ? (
        <div className="diff-metadata-change" aria-label="Title changed">
          <span className="diff-metadata-label">Title</span>
          <del>{fromRevision.title || "Untitled"}</del>
          <ins>{toRevision.title || "Untitled"}</ins>
        </div>
      ) : null}
      {noChanges ? <div className="diff-empty">No changes</div> : null}
      {fileDiffs.map((fileDiff) => (
        <section className="diff-file" key={fileDiff.filename}>
          <header className="diff-file-header">
            <h3>{fileDiff.filename}</h3>
            <div className="diff-file-summary">
              <span>{fileDiff.status}</span>
              <span className="diff-stat diff-stat-added">
                +{fileDiff.diff.addedCount}
              </span>
              <span className="diff-stat diff-stat-removed">
                -{fileDiff.diff.removedCount}
              </span>
            </div>
          </header>
          <div className="diff-table-scroll">
            <table
              className="diff-table"
              aria-label={`${fileDiff.filename} changes`}
            >
              <thead className="sr-only">
                <tr>
                  <th scope="col">Old line</th>
                  <th scope="col">New line</th>
                  <th scope="col">Change</th>
                  <th scope="col">Content</th>
                </tr>
              </thead>
              <tbody>
                {fileDiff.diff.rows.map((row) =>
                  row.kind === "hunk" ? (
                    <tr className="diff-hunk-row" key={row.key}>
                      <td className="diff-hunk" colSpan={4}>
                        {row.hiddenCount} unchanged lines
                      </td>
                    </tr>
                  ) : (
                    <tr className={`diff-row diff-row-${row.kind}`} key={row.key}>
                      <td className="diff-line-number">
                        {lineNumber(row.oldNumber)}
                      </td>
                      <td className="diff-line-number">
                        {lineNumber(row.newNumber)}
                      </td>
                      <td className="diff-marker" aria-hidden="true">
                        {row.marker}
                      </td>
                      <td className="diff-code">{renderWordDiff(row)}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </section>
  );
}
