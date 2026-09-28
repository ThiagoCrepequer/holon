/** Conservative capacity estimate aligned with eight-line, 1200-character evidence windows. */
export function evidenceWindowCount(patch: string): number {
  let count = 0,
    lines = 0,
    characters = 0,
    inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@ ")) {
      inHunk = true;
      lines = 0;
      characters = 0;
      continue;
    }
    if (!inHunk || line.startsWith("-") || line.startsWith("\\ No newline"))
      continue;
    const text = line.slice(1);
    if (!line.startsWith("+") || !text.trim() || text.length > 1200) {
      lines = 0;
      characters = 0;
      continue;
    }
    if (!lines || lines >= 8 || characters + text.length + 1 > 1200) {
      count++;
      lines = 0;
      characters = 0;
    }
    lines++;
    characters += text.length + 1;
  }
  return count;
}

const bytes = (value: string) => new TextEncoder().encode(value).length;

/** Partition canonical hunk content without changing source bytes or coordinates. */
export function partitionPatch(
  patch: string,
  maxBytes: number,
  maxLines: number,
): { patches: string[]; omittedLines: number } {
  if (
    bytes(patch) <= maxBytes &&
    patch.split("\n").length <= maxLines &&
    evidenceWindowCount(patch) <= 24
  )
    return { patches: [patch], omittedLines: 0 };
  const starts = [
    ...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n/gmu),
  ];
  if (!starts.length) return { patches: [], omittedLines: 1 };
  const prelude = patch.slice(0, starts[0]!.index);
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
    const render = () =>
      `${prelude}@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${chunk.join("\n")}\n`;
    const flush = () => {
      if (chunk.length) patches.push(render());
      chunk = [];
      oldCount = 0;
      newCount = 0;
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
      const fits = () =>
        bytes(
          `${prelude}@@ -${oldStart},${oldCount + oldDelta} +${newStart},${newCount + newDelta} @@\n${[...chunk, ...unit].join("\n")}\n`,
        ) <= maxBytes &&
        chunk.length + unit.length <= maxLines &&
        evidenceWindowCount(
          `@@ -0,0 +1,1 @@\n${[...chunk, ...unit].join("\n")}`,
        ) <= 24;
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
      oldCount += oldDelta;
      newCount += newDelta;
      oldLine += oldDelta;
      newLine += newDelta;
    }
    flush();
  }
  return { patches, omittedLines };
}
