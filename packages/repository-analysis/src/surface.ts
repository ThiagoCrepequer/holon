import { parsePatch } from "diff";

export type ReviewSurfaceKind =
  | "contract"
  | "control_flow"
  | "persistence"
  | "security";

export interface ReviewSurfaceSignal {
  readonly change: "added" | "removed";
  readonly excerpt: string;
  readonly kind: ReviewSurfaceKind;
  readonly line: number;
  readonly path: string;
}

const patterns: ReadonlyArray<readonly [ReviewSurfaceKind, RegExp]> = [
  [
    "security",
    /\b(?:auth(?:entication|orization)?|permission|role|scope|secret|token|crypto|encrypt|decrypt|cors|csrf|session)\b/iu,
  ],
  [
    "persistence",
    /\b(?:select|insert|update|delete|transaction|commit|rollback|query|database|repository|prisma|drizzle|migration)\b/iu,
  ],
  [
    "contract",
    /\b(?:export|interface|type|class|function|public|protected|implements|extends)\b|=>/u,
  ],
  [
    "control_flow",
    /\b(?:if|else|switch|case|throw|return|await|catch|finally|break|continue)\b/iu,
  ],
];

function classify(content: string): ReviewSurfaceKind | undefined {
  return patterns.find(([, pattern]) => pattern.test(content))?.[0];
}

export function mapReviewSurface(
  files: readonly { readonly patch: string; readonly path: string }[],
  maximumSignals = 100,
): readonly ReviewSurfaceSignal[] {
  if (!Number.isSafeInteger(maximumSignals) || maximumSignals <= 0) {
    throw new TypeError("maximumSignals must be a positive safe integer");
  }
  const signals: ReviewSurfaceSignal[] = [];
  for (const file of files) {
    const patches = parsePatch(file.patch);
    if (patches.length > 1) {
      throw new TypeError("Expected a unified diff for one repository path");
    }
    for (const hunk of patches[0]?.hunks ?? []) {
      if (
        !Number.isSafeInteger(hunk.oldStart) ||
        !Number.isSafeInteger(hunk.newStart)
      ) {
        throw new TypeError("Malformed unified diff hunk coordinates");
      }
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      for (const rawLine of hunk.lines) {
        const change = rawLine.startsWith("+")
          ? "added"
          : rawLine.startsWith("-")
            ? "removed"
            : undefined;
        const line = change === "added" ? newLine : oldLine;
        if (change !== undefined) {
          const excerpt = rawLine.slice(1).trim().slice(0, 300);
          const kind = classify(excerpt);
          if (kind !== undefined && excerpt.length > 0) {
            signals.push({ change, excerpt, kind, line, path: file.path });
            if (signals.length === maximumSignals) return signals;
          }
        }
        if (!rawLine.startsWith("-")) newLine += 1;
        if (!rawLine.startsWith("+")) oldLine += 1;
      }
    }
  }
  return signals;
}
