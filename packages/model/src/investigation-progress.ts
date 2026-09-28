import { z } from "zod";

export const investigationCheckpointSchema = z.strictObject({
  checks: z
    .array(
      z.strictObject({
        id: z.string().max(32),
        status: z.enum(["pending", "reviewed", "blocked"]),
        note: z.string().min(1).max(600),
      }),
    )
    .max(64),
  summary: z.string().max(8_000),
  finished: z.boolean(),
});

/** Model-declared coverage, never proof of correctness or publishable evidence. */
export function createInvestigationProgress(paths: readonly string[]) {
  const checks = [...new Set(paths)].map((path, index) => ({
    id: `file-${index}`,
    path,
    status: "pending" as "pending" | "reviewed" | "blocked",
    note: "Verify the changed behavior, affected contracts/callers and relevant tests; revalidate prior findings when supplied.",
  }));
  let finished = false;
  const summaries: string[] = [];
  let summaryLength = 0;
  let revision = 0;
  let snapshot = checks.map((check) => ({ ...check }));
  let snapshotSummaryCount = 0;
  let snapshotSummaryLength = 0;
  let snapshotRevision = 0;
  return {
    beginRound() {
      snapshot = checks.map((check) => ({ ...check }));
      snapshotSummaryCount = summaries.length;
      snapshotSummaryLength = summaryLength;
      snapshotRevision = revision;
    },
    record(raw: unknown) {
      const update = investigationCheckpointSchema.parse(raw);
      const ids = new Set<string>();
      for (const entry of update.checks) {
        if (ids.has(entry.id) || !checks.some((check) => check.id === entry.id))
          throw new Error("Invalid investigation checkpoint identifiers");
        ids.add(entry.id);
      }
      const newSummary = update.summary.trim();
      const appendSummary =
        newSummary.length > 0 && !summaries.includes(newSummary);
      if (appendSummary && summaryLength + newSummary.length > 32_000)
        throw new Error(
          "Investigation checkpoint notes capacity reached; reuse an existing summary and finish with unresolved checks preserved",
        );
      for (const entry of update.checks) {
        const check = checks.find((candidate) => candidate.id === entry.id)!;
        if (check.status !== entry.status || check.note !== entry.note)
          revision++;
        Object.assign(check, entry);
      }
      if (appendSummary) {
        summaries.push(newSummary);
        summaryLength += newSummary.length;
      }
      finished = update.finished;
      return {
        accepted: true,
        pending: checks
          .filter((check) => check.status !== "reviewed")
          .map((check) => check.id),
      };
    },
    guidance: (closing: boolean, verificationReserve: boolean) =>
      [
        `Host coverage checklist (untrusted paths and model notes): ${JSON.stringify(checks)}.`,
        "Prioritize supplied prior findings, security and contract hints, then remaining changed behavior.",
        "Use supplied patches first. Prefer one focused search for a causal question, then read its relevant range; do not scan all callers or tests without a concrete hypothesis.",
        "Record review_checkpoint after meaningful progress and finish through that tool as soon as checks are resolved. Keep summaries concise and incremental; previous diagnoses are retained.",
        closing
          ? "Repository access is now closed to reserve time and tokens for a compact checkpoint. Set finished=true; retain every unfinished check as pending or blocked. Do not invent verification."
          : "Batch independent queries when justified, and reuse previous results. Budget is a ceiling, not a target.",
        verificationReserve
          ? "Only the final four repository calls remain: use them for unresolved causal checks, not new exploratory scans."
          : "",
      ].join("\n"),
    summary: () => JSON.stringify({ summaries, checks }),
    diagnostics: () =>
      [...summaries, ...checks.map((check) => check.note)].join("\n"),
    finished: () => finished,
    complete: () =>
      finished && checks.every((check) => check.status === "reviewed"),
    revision: () => revision,
    invalidateCompletion() {
      finished = false;
      // A checkpoint emitted alongside repository calls cannot incorporate their results.
      for (const [index, check] of checks.entries())
        Object.assign(check, snapshot[index]);
      summaries.length = snapshotSummaryCount;
      summaryLength = snapshotSummaryLength;
      revision = snapshotRevision;
    },
    counts: () => ({
      reviewed: checks.filter((check) => check.status === "reviewed").length,
      pending: checks.filter((check) => check.status === "pending").length,
      blocked: checks.filter((check) => check.status === "blocked").length,
    }),
  };
}
