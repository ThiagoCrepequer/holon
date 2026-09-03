import type { ContractBreakSignal, ReviewFinding } from "@holon/contracts";
import { parsePatch } from "diff";

function addedLineExcerpt(
  files: readonly { readonly patch: string; readonly path: string }[],
  signal: ContractBreakSignal,
): string | undefined {
  const file = files.find((candidate) => candidate.path === signal.path);
  if (file === undefined) return undefined;
  try {
    for (const patch of parsePatch(file.patch)) {
      for (const hunk of patch.hunks ?? []) {
        let newLine = hunk.newStart;
        for (const rawLine of hunk.lines) {
          if (rawLine.startsWith("+")) {
            if (newLine === signal.line) return rawLine.slice(1).trim();
            newLine += 1;
          } else if (!rawLine.startsWith("-")) {
            newLine += 1;
          }
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function contractBreaksToFindings(
  signals: readonly ContractBreakSignal[],
  files: readonly { readonly patch: string; readonly path: string }[],
): readonly ReviewFinding[] {
  return signals.flatMap((signal) => {
    const excerpt = addedLineExcerpt(files, signal);
    if (excerpt === undefined || excerpt.length === 0) return [];
    return [
      {
        confidence: 1,
        diagnostic: `Deterministic contract break detected: ${signal.description}.`,
        evidence: [
          {
            excerpt: excerpt.slice(0, 300),
            path: signal.path,
            reason: "Detected by the host structural policy",
            startLine: signal.line,
          },
        ],
        location: { line: signal.line, path: signal.path, side: "RIGHT" },
        severity: signal.severity,
      },
    ];
  });
}
