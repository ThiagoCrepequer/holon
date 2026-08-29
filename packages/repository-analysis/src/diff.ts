import type { ChangedLine } from "@holon/domain";
import { parsePatch } from "diff";

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
