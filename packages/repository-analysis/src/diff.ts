import type { ChangedLine } from "@holon/domain";
import { parsePatch } from "diff";

export interface PullRequestDiffFile {
  readonly patch: string;
  readonly path: string;
}

function normalizeDiffPath(path: string): string {
  const unquoted =
    path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
  return unquoted.replace(/^[ab]\//u, "");
}

/**
 * Splits the canonical GitHub pull-request diff without recomputing it from
 * branch tips. A content line cannot be mistaken for a boundary because Git
 * prefixes hunk content with a space, plus or minus.
 */
export function splitPullRequestDiff(
  diff: string,
): readonly PullRequestDiffFile[] {
  if (diff.trim().length === 0) return [];
  const starts = [...diff.matchAll(/^diff --git /gmu)].map(
    (match) => match.index,
  );
  if (starts.length === 0 || starts[0] !== 0) {
    throw new TypeError("Expected a canonical GitHub pull request diff");
  }
  return starts.map((start, index) => {
    const patch = diff.slice(start, starts[index + 1] ?? diff.length).trimEnd();
    const parsed = parsePatch(patch);
    if (parsed.length !== 1) {
      throw new TypeError("Expected one repository path per diff section");
    }
    const candidate =
      parsed[0]?.newFileName === "/dev/null"
        ? parsed[0]?.oldFileName
        : parsed[0]?.newFileName;
    if (candidate === undefined || candidate === "/dev/null") {
      throw new TypeError("Diff section does not identify a repository path");
    }
    return { patch, path: normalizeDiffPath(candidate) };
  });
}

export function collectChangedLines(
  path: string,
  patch: string,
  maximumLines = Number.MAX_SAFE_INTEGER,
): readonly ChangedLine[] {
  if (!Number.isSafeInteger(maximumLines) || maximumLines <= 0) {
    throw new TypeError("maximumLines must be a positive safe integer");
  }
  const result: ChangedLine[] = [];
  const parsed = parsePatch(patch);
  if (parsed.length > 1) {
    throw new TypeError("Expected a unified diff for one repository path");
  }
  for (const hunk of parsed[0]?.hunks ?? []) {
    if (
      !Number.isSafeInteger(hunk.newStart) ||
      hunk.newStart < 0 ||
      !Number.isSafeInteger(hunk.newLines) ||
      hunk.newLines < 0
    ) {
      throw new TypeError("Malformed unified diff hunk coordinates");
    }
    let rightLine = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        result.push({ line: rightLine, path, side: "RIGHT" });
        if (result.length === maximumLines) return result;
        rightLine += 1;
      } else if (!line.startsWith("-") && !line.startsWith("\\")) {
        rightLine += 1;
      }
    }
    if (rightLine !== hunk.newStart + hunk.newLines) {
      throw new TypeError("Unified diff hunk line count does not match header");
    }
  }

  return result;
}
