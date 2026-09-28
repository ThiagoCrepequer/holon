import type { ChangedLine } from "@holon/domain";
import { parsePatch } from "diff";

export interface PullRequestDiffFile {
  readonly changeType: PullRequestDiffChangeType;
  readonly newPath?: string;
  readonly oldPath?: string;
  readonly patch: string;
  readonly path: string;
}

export type PullRequestDiffChangeType =
  | "added"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed";

function normalizeDiffPath(path: string): string {
  return path.replace(/^[ab]\//u, "");
}

function repositoryPath(path: string | undefined): string | undefined {
  return path === undefined || path === "/dev/null"
    ? undefined
    : normalizeDiffPath(path);
}

function changeType(
  parsed: ReturnType<typeof parsePatch>[number],
  oldPath: string | undefined,
  newPath: string | undefined,
): PullRequestDiffChangeType {
  if (parsed?.isCopy === true) return "copied";
  if (parsed?.isRename === true) return "renamed";
  if (parsed?.isCreate === true || oldPath === undefined) return "added";
  if (parsed?.isDelete === true || newPath === undefined) return "deleted";
  return "modified";
}

/**
 * Splits a canonical Git pull-request diff. A content line cannot be mistaken
 * for a boundary because Git
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
    const patch = diff.slice(start, starts[index + 1] ?? diff.length);
    const parsed = parsePatch(patch);
    if (parsed.length !== 1) {
      throw new TypeError("Expected one repository path per diff section");
    }
    const parsedFile = parsed[0];
    if (parsedFile === undefined) {
      throw new TypeError("Expected one repository path per diff section");
    }
    const oldPath = repositoryPath(parsedFile.oldFileName);
    const newPath = repositoryPath(parsedFile.newFileName);
    const path = newPath ?? oldPath;
    if (path === undefined) {
      throw new TypeError("Diff section does not identify a repository path");
    }
    return {
      changeType: changeType(parsedFile, oldPath, newPath),
      ...(newPath === undefined ? {} : { newPath }),
      ...(oldPath === undefined ? {} : { oldPath }),
      patch,
      path,
    };
  });
}

export function isNonBinaryPullRequestPatch(patch: string): boolean {
  const parsed = parsePatch(patch);
  if (parsed.length !== 1) {
    throw new TypeError("Expected one repository path per diff section");
  }
  return parsed[0]?.isBinary !== true;
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
