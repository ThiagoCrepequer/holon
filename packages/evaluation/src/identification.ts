import type { ProjectIdentificationModel } from "@holon/application";
import {
  identifySnapshot,
  verifyInterpretation,
} from "@holon/project-identification";

import { identificationCorpus } from "../corpus/project-identification/index.js";
/** Returns aggregate metrics only: no repository contents or provider output. */
export async function evaluateIdentification(
  model?: ProjectIdentificationModel,
) {
  let expected = 0,
    matched = 0,
    asserted = 0,
    falseExact = 0,
    failures = 0,
    calls = 0;
  const started = Date.now();
  for (const fixture of identificationCorpus) {
    const result = await identifySnapshot({
      snapshotSha: "a".repeat(40),
      policyDigest: "evaluation-v1",
      modelRevision: "evaluation-v1",
      files: fixture.files,
    });
    const claims = [];
    for (const deterministic of result.projects) {
      let project = deterministic;
      if (model) {
        calls++;
        try {
          project = verifyInterpretation(
            project,
            await model.identify(project, AbortSignal.timeout(30000)),
          );
        } catch {
          failures++;
        }
      }
      claims.push(
        ...project.technologies.flatMap((t) =>
          t.declarations.map((d) => ({
            root: project.root,
            name: t.name,
            value: d.value,
            kind: d.kind,
            category: t.category,
          })),
        ),
      );
    }
    const actual = new Set(claims.map((c) => JSON.stringify(c))),
      oracle = new Set(fixture.expected.map((c) => JSON.stringify(c)));
    expected += oracle.size;
    asserted += actual.size;
    for (const claim of actual) if (oracle.has(claim)) matched++;
    falseExact += claims.filter(
      (c) =>
        ["declared-exact", "locked"].includes(c.kind) &&
        !oracle.has(JSON.stringify(c)),
    ).length;
  }
  return {
    corpus: "identification-v1",
    cases: identificationCorpus.length,
    expected,
    asserted,
    matched,
    falseExact,
    failures,
    calls,
    precision: asserted ? matched / asserted : 1,
    recall: expected ? matched / expected : 1,
    latencyMs: Date.now() - started,
  };
}
