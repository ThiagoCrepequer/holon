import {
  adminFindingSummarySchema,
  type AdminFindingSummary,
  buildReviewAnalysisCheckpoint,
  reconciledReviewOutputSchema,
  runIdSchema,
  type ReconciledReviewOutput,
  type ReviewAnalysisCheckpoint,
} from "@holon/contracts";

/** Temporary private evidence, deleted by the same durable terminal cleanup as the Sandbox. */
export class ReviewAnalysisStore {
  public constructor(private readonly storage: DurableObjectStorage) {}

  public save(
    rawRunId: string,
    rawOutput: ReconciledReviewOutput,
  ): ReviewAnalysisCheckpoint {
    const runId = runIdSchema.parse(rawRunId);
    const output = reconciledReviewOutputSchema.parse(rawOutput);
    return this.storage.transactionSync(() => {
      const existing = this.storage.sql
        .exec(
          "SELECT 1 FROM review_analysis_artifacts WHERE run_id = ? LIMIT 1",
          runId,
        )
        .toArray();
      if (existing.length)
        return buildReviewAnalysisCheckpoint(this.load(runId));
      const run = this.storage.sql
        .exec<{ state: string }>("SELECT state FROM runs WHERE id = ?", runId)
        .toArray()[0];
      if (run === undefined || !["running", "publishing"].includes(run.state))
        throw new Error("Analysis run is not active");
      // Retain user-visible verified results independently of temporary analysis.
      const summaries = output.activeFindings.map((finding) =>
        adminFindingSummarySchema.parse({
          details: {
            confidence: finding.confidence,
            suggestion: finding.suggestion,
            evidence: finding.evidence,
          },
          identityAmbiguous: finding.identityAmbiguous,
          diagnostic: finding.diagnostic,
          filePath: finding.location.path,
          fingerprint: finding.fingerprint,
          line: finding.location.line,
          severity: finding.severity,
          status: finding.status,
          updatedAt: new Date().toISOString(),
        }),
      );
      const retainedBytes = new TextEncoder().encode(JSON.stringify(summaries));
      for (let offset = 0; offset < retainedBytes.length; offset += 64_000) {
        this.storage.sql.exec(
          "INSERT INTO review_finding_artifacts(run_id, part, payload) VALUES (?, ?, ?)",
          runId,
          offset / 64_000,
          retainedBytes.slice(offset, offset + 64_000).buffer,
        );
      }
      const bytes = new TextEncoder().encode(JSON.stringify(output));
      for (let offset = 0; offset < bytes.length; offset += 64_000) {
        this.storage.sql.exec(
          "INSERT INTO review_analysis_artifacts(run_id, part, payload) VALUES (?, ?, ?)",
          runId,
          offset / 64_000,
          bytes.slice(offset, offset + 64_000).buffer,
        );
      }
      return buildReviewAnalysisCheckpoint(output);
    });
  }

  public retainedFindings(rawRunId: string): AdminFindingSummary[] | null {
    const runId = runIdSchema.parse(rawRunId);
    const rows = this.storage.sql
      .exec<{ payload: ArrayBuffer }>(
        "SELECT payload FROM review_finding_artifacts WHERE run_id = ? ORDER BY part",
        runId,
      )
      .toArray();
    if (!rows.length) return null;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const json =
      rows
        .map((row) => decoder.decode(row.payload, { stream: true }))
        .join("") + decoder.decode();
    return adminFindingSummarySchema.array().parse(JSON.parse(json));
  }

  public load(rawRunId: string): ReconciledReviewOutput {
    const runId = runIdSchema.parse(rawRunId);
    const rows = this.storage.sql
      .exec<{ payload: ArrayBuffer }>(
        "SELECT payload FROM review_analysis_artifacts WHERE run_id = ? ORDER BY part",
        runId,
      )
      .toArray();
    if (!rows.length)
      throw new Error("Review analysis artifact is unavailable");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const json =
      rows
        .map((row) => decoder.decode(row.payload, { stream: true }))
        .join("") + decoder.decode();
    return reconciledReviewOutputSchema.parse(JSON.parse(json));
  }
}
