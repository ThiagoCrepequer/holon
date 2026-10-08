import { reviewExecutionLimits } from "@holon/contracts";

interface EvidenceCount {
  count: number;
  lines: number;
  characters: number;
}
const emptyEvidence = (): EvidenceCount => ({
  count: 0,
  lines: 0,
  characters: 0,
});
function appendEvidence(state: EvidenceCount, line: string): EvidenceCount {
  if (line.startsWith("-") || line.startsWith("\\ No newline")) return state;
  const text = line.slice(1);
  if (!line.startsWith("+") || !text.trim() || text.length > 1200)
    return { count: state.count, lines: 0, characters: 0 };
  const newWindow =
    !state.lines ||
    state.lines >= 8 ||
    state.characters + text.length + 1 > 1200;
  return {
    count: state.count + Number(newWindow),
    lines: (newWindow ? 0 : state.lines) + 1,
    characters: (newWindow ? 0 : state.characters) + text.length + 1,
  };
}

/** Conservative capacity estimate aligned with eight-line, 1200-character evidence windows. */
export function evidenceWindowCount(patch: string): number {
  let state = emptyEvidence(),
    inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@ ")) {
      inHunk = true;
      state = { count: state.count, lines: 0, characters: 0 };
      continue;
    }
    if (inHunk) state = appendEvidence(state, line);
  }
  return state.count;
}

const bytes = (value: string) => new TextEncoder().encode(value).length;

/** Partition canonical source without changing bytes/coordinates. maxLines counts additions; maxContentLines also bounds context, removals and newline markers. */
export function partitionPatch(
  patch: string,
  maxBytes: number,
  maxLines: number,
  maxContentLines = Number.POSITIVE_INFINITY,
): { patches: string[]; omittedLines: number } {
  let inHunk = false,
    addedCount = 0,
    contentCount = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@ ")) inHunk = true;
    else if (inHunk && /^[ +\-\\]/u.test(line)) {
      contentCount++;
      if (line.startsWith("+")) addedCount++;
    }
  }
  if (
    bytes(patch) <= maxBytes &&
    addedCount <= maxLines &&
    contentCount <= maxContentLines &&
    evidenceWindowCount(patch) <= reviewExecutionLimits.shardEvidenceWindows
  )
    return { patches: [patch], omittedLines: 0 };
  const starts = [
    ...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n/gmu),
  ];
  if (!starts.length) return { patches: [], omittedLines: 1 };
  const prelude = patch.slice(0, starts[0]!.index);
  const preludeBytes = bytes(prelude);
  const patches: string[] = [];
  let omittedLines = 0;
  for (const [index, match] of starts.entries()) {
    let oldLine = Number(match[1]),
      newLine = Number(match[3]);
    let chunk: string[] = [],
      oldStart = oldLine,
      newStart = newLine;
    let oldCount = 0,
      newCount = 0;
    let chunkBytes = 0,
      addedLines = 0,
      evidence = emptyEvidence();
    const render = () =>
      `${prelude}@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${chunk.join("\n")}\n`;
    const flush = () => {
      if (chunk.length) patches.push(render());
      chunk = [];
      oldCount = 0;
      newCount = 0;
      chunkBytes = 0;
      addedLines = 0;
      evidence = emptyEvidence();
      oldStart = oldLine;
      newStart = newLine;
    };
    const lines = patch
      .slice(
        match.index + match[0].length,
        starts[index + 1]?.index ?? patch.length,
      )
      .split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // A no-newline marker belongs to its preceding source line.
      const unit = [line];
      if (lines[i + 1]?.startsWith("\\ No newline")) unit.push(lines[++i]!);
      const oldDelta = line.startsWith("+") ? 0 : 1;
      const newDelta = line.startsWith("-") ? 0 : 1;
      const unitBytes = bytes(unit.join("\n") + "\n");
      const addedDelta = Number(line.startsWith("+"));
      const fits = () =>
        preludeBytes +
          chunkBytes +
          unitBytes +
          bytes(
            `@@ -${oldStart},${oldCount + oldDelta} +${newStart},${newCount + newDelta} @@\n`,
          ) <=
          maxBytes &&
        addedLines + addedDelta <= maxLines &&
        chunk.length + unit.length <= maxContentLines &&
        appendEvidence(evidence, line).count <=
          reviewExecutionLimits.shardEvidenceWindows;
      if (!fits()) flush();
      if (!fits()) {
        omittedLines++;
        oldLine += oldDelta;
        newLine += newDelta;
        oldStart = oldLine;
        newStart = newLine;
        continue;
      }
      chunk.push(...unit);
      chunkBytes += unitBytes;
      addedLines += addedDelta;
      evidence = appendEvidence(evidence, line);
      oldCount += oldDelta;
      newCount += newDelta;
      oldLine += oldDelta;
      newLine += newDelta;
    }
    flush();
  }
  return { patches, omittedLines };
}
