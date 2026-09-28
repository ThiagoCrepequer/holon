import type {
  CanonicalEvidenceEntry,
  ProjectIdentificationResult,
  ReviewContextFile,
} from "@holon/contracts";

import { redactSecrets } from "./redaction.js";

const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

/** Supplementary metadata is projected independently of code-review coverage. */
export function compactProjectContext(
  input: ProjectIdentificationResult | undefined,
): string {
  if (!input) return "null";
  const projects = input.projects.map((project) => ({
    root: project.root,
    ecosystem: project.ecosystem,
    status: project.status,
    technologies: [] as Array<{
      name: string;
      category: string;
      declarations: Array<{ value: string; kind: string; condition?: string }>;
    }>,
  }));
  const result = {
    status: input.status,
    limitations: input.limitations.slice(0, 10),
    projects,
    configuredCompatibility: [] as NonNullable<
      ProjectIdentificationResult["configuredCompatibility"]
    >,
    omittedCompatibility: input.configuredCompatibility?.length ?? 0,
    omittedTechnologies: input.projects.reduce(
      (n, p) => n + p.technologies.length,
      0,
    ),
    omittedDeclarations: 0,
    omittedProjects: 0,
  };
  while (jsonBytes(result) > 12000 && projects.length) {
    projects.pop();
    result.omittedProjects++;
  }
  while (jsonBytes(result) > 12000 && result.limitations.length)
    result.limitations.pop();
  // Preserve host comparisons from the compiled configuration as complete entries.
  for (const comparison of input.configuredCompatibility ?? []) {
    if (
      !projects.some(
        (project) =>
          comparison.root === "." ||
          project.root === comparison.root ||
          project.root.startsWith(comparison.root + "/"),
      )
    )
      continue;
    result.configuredCompatibility.push(comparison);
    result.omittedCompatibility--;
    if (jsonBytes(result) > 6000) {
      result.configuredCompatibility.pop();
      result.omittedCompatibility++;
    }
  }
  // Round-robin selection gives each affected project context before filling any one project.
  for (let index = 0; index < 100; index++) {
    for (const [projectIndex, project] of input.projects.entries()) {
      const technology = project.technologies[index];
      if (!technology || !projects[projectIndex]) continue;
      const projected = {
        name: technology.name,
        category: technology.category,
        declarations: technology.declarations.slice(0, 4).map((d) => ({
          value: d.value,
          kind: d.kind,
          ...(d.condition ? { condition: d.condition } : {}),
        })),
      };
      const destination = projects[projectIndex].technologies;
      destination.push(projected);
      result.omittedTechnologies--;
      const omitted = Math.max(0, technology.declarations.length - 4);
      result.omittedDeclarations += omitted;
      if (jsonBytes(result) > 12000) {
        destination.pop();
        result.omittedTechnologies++;
        result.omittedDeclarations -= omitted;
      }
    }
  }
  return JSON.stringify(result);
}

export interface CanonicalEvidenceCandidate {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly excerpt: string;
}

/** Build complete, bounded line windows from the canonical patch, never model text. */
export function canonicalEvidenceCandidates(
  files: readonly ReviewContextFile[],
): CanonicalEvidenceCandidate[] {
  const candidates: CanonicalEvidenceCandidate[] = [];
  for (const file of files) {
    let line = 0;
    let window: CanonicalEvidenceCandidate | undefined;
    const flush = () => {
      if (window) candidates.push(window);
      window = undefined;
    };
    for (const raw of file.patch.split("\n")) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw);
      if (hunk) {
        flush();
        line = Number(hunk[1]);
        continue;
      }
      if (!line || raw.startsWith("-")) continue;
      if (raw.startsWith("+") || raw.startsWith(" ")) {
        const sourceText = raw.slice(1);
        const text = redactSecrets(sourceText);
        if (
          raw.startsWith("+") &&
          text === sourceText &&
          text.trim() &&
          text.length <= 1200
        ) {
          if (
            window &&
            window.endLine === line - 1 &&
            window.excerpt.length + text.length + 1 <= 1200 &&
            line - window.startLine < 8
          )
            window = {
              ...window,
              endLine: line,
              excerpt: window.excerpt + "\n" + text,
            };
          else {
            flush();
            window = {
              path: file.path,
              startLine: line,
              endLine: line,
              excerpt: text,
            };
          }
        } else flush();
        line++;
      } else if (!raw.startsWith("\\ No newline")) {
        flush();
        line = 0;
      }
    }
    flush();
  }
  return candidates;
}

export function selectFinalizationEvidence(
  candidates: readonly CanonicalEvidenceCandidate[],
  investigation: string,
): readonly CanonicalEvidenceCandidate[] {
  const mentionedLines = new Set(
    Array.from(investigation.matchAll(/\b\d+\b/gu), (match) =>
      Number(match[0]),
    ),
  );
  const score = (candidate: CanonicalEvidenceCandidate) =>
    Number(investigation.includes(candidate.path)) * 2 +
    Number(
      [...mentionedLines].some(
        (line) => line >= candidate.startLine && line <= candidate.endLine,
      ),
    );
  const result: CanonicalEvidenceCandidate[] = [];
  let bytes = 2; // JSON array delimiters.
  const unique = [
    ...new Map(
      candidates.map((candidate) => [JSON.stringify(candidate), candidate]),
    ).values(),
  ];
  for (const candidate of unique.toSorted((a, b) => score(b) - score(a))) {
    // IDs have a fixed encoded width; include the actual JSON fields and comma.
    const size =
      jsonBytes({ ...candidate, id: `ev:${"0".repeat(64)}` }) +
      Number(result.length > 0);
    if (bytes + size > 24000 || result.length >= 32) continue;
    result.push(candidate);
    bytes += size;
  }
  return result;
}

/** IDs bind path, coordinates and bytes; resolution still uses a request-local allowlist. */
export async function createFinalizationEvidenceCatalog(
  candidates: readonly CanonicalEvidenceCandidate[],
  investigation: string,
): Promise<readonly CanonicalEvidenceEntry[]> {
  const selected = selectFinalizationEvidence(candidates, investigation);
  const catalog = await Promise.all(
    selected.map(async (entry) => {
      const bytes = new TextEncoder().encode(
        JSON.stringify([
          entry.path,
          entry.startLine,
          entry.endLine,
          entry.excerpt,
        ]),
      );
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const id = `ev:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
      return { ...entry, id };
    }),
  );
  return [...new Map(catalog.map((entry) => [entry.id, entry])).values()];
}
