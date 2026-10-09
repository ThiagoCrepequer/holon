import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repositoryRoot = resolve(process.argv[2]);
const source = (path: string) =>
  pathToFileURL(resolve(repositoryRoot, path)).href;
const {
  analyzeStructuralImpact,
  buildReviewPlan,
  splitPullRequestDiff,
  classifyPullRequestDiffFile,
  selectReviewableFiles,
  extractChangedSymbols,
} = await import(source("packages/repository-analysis/src/index.ts"));
const { buildShardReviewContext } = await import(
  source("apps/control-plane/src/review/review-shard-context.ts")
);
const { projectStructuralImpact } = await import(
  source("packages/domain/src/index.ts")
);
const base = "929ed5b8eaed671f7c6d5da3e8cdb1a117ba5ce0";
const head = "0dcf243be6f8f1a6c8135b01e7285c5f247bce56";
const git = (a: string[]) =>
  execFileSync("git", a, {
    cwd: repositoryRoot,
    maxBuffer: 10_000_000,
    encoding: "utf8",
  });
const diff = splitPullRequestDiff(
  git(["diff", "--no-ext-diff", "--no-textconv", "--unified=3", base, head]),
);
const paths = selectReviewableFiles(
  diff
    .filter(
      (f) =>
        classifyPullRequestDiffFile(f) === "structural" &&
        f.changeType !== "deleted",
    )
    .map((f) => f.path),
  101,
).slice(0, 100);
const files = paths.flatMap((path) => {
  const content = git(["show", head + ":" + path]);
  return Buffer.byteLength(content) <= 64_000 ? [{ path, content }] : [];
});
const impact = analyzeStructuralImpact({
  changedFiles: diff,
  repositoryFiles: files,
  repositoryScanTruncated: true,
});
const plan = buildReviewPlan(diff, { structuralImpact: impact });
const sameFull = (p: string, q: string) =>
  plan.shards.some((s) =>
    [p, q].every((path) =>
      s.files.some(
        (f) =>
          f.path === path &&
          f.patch === diff.find((x) => x.path === path)?.patch,
      ),
    ),
  );
const refs = impact.downstreamReferences.filter(
  (r) =>
    diff.some((f) => f.path === r.callerPath) &&
    diff.some((f) => f.path === r.targetPath),
);
console.log(
  JSON.stringify({
    scope:
      "Offline exact-SHA replay using changed modules only; not reproduction of the full production inventory.",
    files: files.length,
    bytes: files.reduce((s, f) => s + Buffer.byteLength(f.content), 0),
    symbols: impact.changedSymbols.length,
    allSymbols: extractChangedSymbols(diff, files).length,
    references: impact.downstreamReferences.length,
    totalRefs: impact.totalDownstreamReferencesCount,
    omitted: impact.omittedSignals,
    plan: { shards: plan.shards.length, omissions: plan.omissionReasons },
    projection: plan.shards.map((s) => {
      const p = projectStructuralImpact(
        buildShardReviewContext(s, impact, [], undefined, false)
          .structuralImpact,
        24000,
      );
      return {
        index: s.index,
        signals: s.files.length,
        bytes: Buffer.byteLength(p.content),
        omitted: p.omitted,
      };
    }),
    changedRelations: refs.length,
    relationsWithBothWholePatches: refs.filter((r) =>
      sameFull(r.callerPath, r.targetPath),
    ).length,
  }),
);
