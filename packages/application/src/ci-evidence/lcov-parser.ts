import type { LineCoverage } from "@holon/domain";

function normalizeLcovPath(rawPath: string): string {
  return rawPath
    .replace(/^(\.\/|\.\\)+/u, "")
    .replace(/\\/gu, "/")
    .trim();
}

/**
 * Parses LCOV formatted coverage text into structured LineCoverage records.
 * Robust against empty lines, comments, and missing LF/LH summaries.
 */
export function parseLcov(lcovContent: string): readonly LineCoverage[] {
  const records: LineCoverage[] = [];
  const lines = lcovContent.split(/\r?\n/u);

  let currentPath: string | undefined;
  let currentHits: Record<number, number> = {};
  let totalFound: number | undefined;
  let totalHit: number | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("SF:")) {
      currentPath = normalizeLcovPath(trimmed.slice(3));
      currentHits = {};
      totalFound = undefined;
      totalHit = undefined;
    } else if (trimmed.startsWith("DA:")) {
      const parts = trimmed.slice(3).split(",");
      const lineNumStr = parts[0]?.trim();
      const hitsStr = parts[1]?.trim();

      if (lineNumStr && hitsStr) {
        const lineNum = Number.parseInt(lineNumStr, 10);
        const hits = Number.parseInt(hitsStr, 10);
        if (
          !Number.isNaN(lineNum) &&
          !Number.isNaN(hits) &&
          lineNum > 0 &&
          hits >= 0
        ) {
          currentHits[lineNum] = hits;
        }
      }
    } else if (trimmed.startsWith("LF:")) {
      const val = Number.parseInt(trimmed.slice(3).trim(), 10);
      if (!Number.isNaN(val) && val >= 0) totalFound = val;
    } else if (trimmed.startsWith("LH:")) {
      const val = Number.parseInt(trimmed.slice(3).trim(), 10);
      if (!Number.isNaN(val) && val >= 0) totalHit = val;
    } else if (trimmed === "end_of_record") {
      if (currentPath) {
        const lineEntries = Object.values(currentHits);
        const found = totalFound ?? lineEntries.length;
        const hit = totalHit ?? lineEntries.filter((h) => h > 0).length;

        records.push({
          hitsByLine: currentHits,
          path: currentPath,
          totalFound: found,
          totalHit: hit,
        });
      }
      currentPath = undefined;
      currentHits = {};
      totalFound = undefined;
      totalHit = undefined;
    }
  }

  // Handle case where file does not end with end_of_record
  if (currentPath && Object.keys(currentHits).length > 0) {
    const lineEntries = Object.values(currentHits);
    records.push({
      hitsByLine: currentHits,
      path: currentPath,
      totalFound: totalFound ?? lineEntries.length,
      totalHit: totalHit ?? lineEntries.filter((h) => h > 0).length,
    });
  }

  return records;
}
