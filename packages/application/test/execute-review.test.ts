import {
  reviewJobSchema,
  type ModelReviewOutput,
  type ReviewJob,
} from "@holon/contracts";
import {
  createFindingId,
  type PublicationId,
  type PublicationRecord,
  type ReviewRun,
  type RunId,
  type RunState,
} from "@holon/domain";
import { describe, expect, it } from "vitest";

import {
  ExecuteReview,
  type ClaimedPublication,
  type ReviewContext,
  type ReviewLedger,
  type ReviewPublisher,
} from "../src/index.js";

const sha = "a".repeat(40);
const job: ReviewJob = reviewJobSchema.parse({
  envelope: {
    action: "opened",
    deliveryId: "github:delivery-123",
    event: "pull_request",
    installationId: 99,
    pullRequest: { baseSha: "b".repeat(40), headSha: sha, number: 7 },
    receivedAt: "2026-08-29T12:00:00.000Z",
    repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
    schemaVersion: 1,
  },
  runId: `github:42:pr:7:head:${sha}`,
  schemaVersion: 1,
});

const context: ReviewContext = {
  changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
  diff: "@@ -9,0 +10,1 @@\n+return null;",
  reviewedFiles: [{ mode: "structural", path: "src/index.ts" }],
};

const output: ModelReviewOutput = {
  findings: [
    {
      confidence: 0.95,
      diagnostic:
        "The unchanged caller dereferences this newly nullable result and will fail.",
      evidence: [
        {
          excerpt: "result.id",
          path: "src/caller.ts",
          reason: "Caller has no null guard",
          startLine: 30,
        },
      ],
      location: { line: 10, path: "src/index.ts", side: "RIGHT" },
      severity: "high",
      suggestion:
        "Keep the result non-null or update every caller with a null guard.",
    },
  ],
  summary: "One nullable contract regression was found.",
};

class MemoryLedger implements ReviewLedger {
  public readonly publications = new Map<PublicationId, PublicationRecord>();
  public readonly transitions: Array<readonly [RunState, RunState]> = [];
  public latest = true;
  public run?: ReviewRun;

  public claimRun(run: ReviewRun): Promise<"claimed" | "duplicate" | "resume"> {
    if (this.run?.state === "failed_retryable")
      return Promise.resolve("resume");
    if (this.run !== undefined) return Promise.resolve("duplicate");
    this.run = run;
    return Promise.resolve("claimed");
  }

  public isLatestRun(): Promise<boolean> {
    return Promise.resolve(this.latest);
  }

  public transition(
    runId: RunId,
    expected: RunState,
    next: RunState,
    occurredAt: string,
    _operationId: string,
  ): Promise<void> {
    if (this.run?.id !== runId || this.run.state !== expected)
      throw new Error("conditional transition failed");
    this.transitions.push([expected, next]);
    this.run = { ...this.run, state: next, updatedAt: occurredAt };
    return Promise.resolve();
  }

  public claimPublication(
    record: PublicationRecord,
  ): Promise<ClaimedPublication> {
    const existing = this.publications.get(record.id);
    if (existing?.state === "published")
      return Promise.resolve({ outcome: "published", record: existing });
    if (existing?.state === "publishing")
      return Promise.resolve({ outcome: "reconcile", record: existing });
    this.publications.set(record.id, record);
    return Promise.resolve({ outcome: "claimed", record });
  }

  public completePublication(
    id: PublicationId,
    githubCommentId: number,
  ): Promise<void> {
    const record = this.publications.get(id);
    if (record === undefined) throw new Error("publication not claimed");
    this.publications.set(id, {
      ...record,
      githubCommentId,
      state: "published",
    });
    return Promise.resolve();
  }
}

class MemoryPublisher implements ReviewPublisher {
  public readonly published: Array<{
    readonly body: string;
    readonly marker: string;
    readonly startLine?: number;
  }> = [];
  public reconciledCommentId?: number;

  public findCommentByMarker(): Promise<number | undefined> {
    return Promise.resolve(this.reconciledCommentId);
  }

  public publish(input: {
    readonly body: string;
    readonly marker: string;
    readonly startLine?: number;
  }): Promise<number> {
    this.published.push(input);
    return Promise.resolve(1_000 + this.published.length);
  }
}

function createSubject(
  ledger = new MemoryLedger(),
  publisher = new MemoryPublisher(),
  modelOutput: ModelReviewOutput = output,
) {
  let analysisCalls = 0;
  const subject = new ExecuteReview({
    clock: { now: () => "2026-08-29T12:00:00.000Z" },
    ledger,
    model: {
      review: () => {
        analysisCalls += 1;
        return Promise.resolve(modelOutput);
      },
    },
    publisher,
    pullRequest: {
      currentHeadSha: () => Promise.resolve(job.envelope.pullRequest.headSha),
    },
    repository: { loadContext: () => Promise.resolve(context) },
  });
  return { analysisCalls: () => analysisCalls, ledger, publisher, subject };
}

describe("ExecuteReview", () => {
  it("analyzes once and publishes one inline comment plus one summary", async () => {
    const { analysisCalls, ledger, publisher, subject } = createSubject();

    await expect(subject.execute(job)).resolves.toEqual({
      findingsPublished: 1,
      outcome: "completed",
    });

    expect(analysisCalls()).toBe(1);
    expect(publisher.published).toHaveLength(2);
    expect(publisher.published[0]!.body).toContain("nullable result");
    expect(publisher.published[0]!.marker).toContain("<!-- holon:v1;");
    expect(ledger.transitions).toEqual([
      ["queued", "running"],
      ["running", "publishing"],
      ["publishing", "completed"],
    ]);
  });

  it("does no analysis or external effect for a duplicate run", async () => {
    const fixture = createSubject();
    await fixture.subject.execute(job);
    fixture.publisher.published.length = 0;

    await expect(fixture.subject.execute(job)).resolves.toEqual({
      findingsPublished: 0,
      outcome: "duplicate",
    });
    expect(fixture.analysisCalls()).toBe(1);
    expect(fixture.publisher.published).toHaveLength(0);
  });

  it("marks the run obsolete before publication if a newer head exists", async () => {
    const fixture = createSubject();
    fixture.ledger.latest = false;

    await expect(fixture.subject.execute(job)).resolves.toEqual({
      findingsPublished: 0,
      outcome: "obsolete",
    });
    expect(fixture.publisher.published).toHaveLength(0);
    expect(fixture.ledger.run?.state).toBe("obsolete");
  });

  it("revalidates the live GitHub head before publication", async () => {
    const fixture = createSubject();
    const subject = new ExecuteReview({
      clock: { now: () => "2026-08-29T12:00:00.000Z" },
      ledger: fixture.ledger,
      model: { review: () => Promise.resolve(output) },
      publisher: fixture.publisher,
      pullRequest: { currentHeadSha: () => Promise.resolve("c".repeat(40)) },
      repository: { loadContext: () => Promise.resolve(context) },
    });

    await expect(subject.execute(job)).resolves.toEqual({
      findingsPublished: 0,
      outcome: "obsolete",
    });
    expect(fixture.publisher.published).toHaveLength(0);
  });

  it("reconciles a publishing record by marker instead of creating a duplicate comment", async () => {
    const fixture = createSubject();
    const findingId = await createFindingId(job.runId as RunId, {
      diagnostic: output.findings[0]!.diagnostic,
      endLine: output.findings[0]!.location.line,
      path: output.findings[0]!.location.path,
      startLine: output.findings[0]!.location.line,
    });
    const publicationId =
      `${job.runId}:publication:${findingId}` as PublicationId;
    fixture.ledger.publications.set(publicationId, {
      findingId,
      id: publicationId,
      kind: "inline",
      marker: "<!-- existing -->",
      runId: job.runId as RunId,
      state: "publishing",
    });
    fixture.publisher.reconciledCommentId = 55;

    await fixture.subject.execute(job);

    expect(fixture.publisher.published).toHaveLength(1);
    expect(fixture.ledger.publications.get(publicationId)).toMatchObject({
      githubCommentId: 55,
      state: "published",
    });
  });

  it("publishes again only when an ambiguous record cannot be reconciled", async () => {
    const fixture = createSubject();
    const finding = output.findings[0]!;
    const findingId = await createFindingId(job.runId as RunId, {
      diagnostic: finding.diagnostic,
      endLine: finding.location.line,
      path: finding.location.path,
      startLine: finding.location.line,
    });
    const publicationId =
      `${job.runId}:publication:${findingId}` as PublicationId;
    fixture.ledger.publications.set(publicationId, {
      findingId,
      id: publicationId,
      kind: "inline",
      marker: "<!-- existing -->",
      runId: job.runId as RunId,
      state: "publishing",
    });

    await fixture.subject.execute(job);

    expect(fixture.publisher.published).toHaveLength(2);
  });

  it("skips already published records and keeps low severity findings in the summary", async () => {
    const lowOutput: ModelReviewOutput = {
      findings: [{ ...output.findings[0]!, severity: "low" }],
      summary: "One low-impact observation.",
    };
    const fixture = createSubject(
      new MemoryLedger(),
      new MemoryPublisher(),
      lowOutput,
    );
    const summaryId = `${job.runId}:publication:summary` as PublicationId;
    fixture.ledger.publications.set(summaryId, {
      findingId: "summary",
      githubCommentId: 77,
      id: summaryId,
      kind: "summary",
      marker: "<!-- existing summary -->",
      runId: job.runId as RunId,
      state: "published",
    });

    await expect(fixture.subject.execute(job)).resolves.toEqual({
      findingsPublished: 0,
      outcome: "completed",
    });
    expect(fixture.publisher.published).toHaveLength(0);
  });

  it("supports an inline finding without a suggestion and with a range start", async () => {
    const { suggestion: _suggestion, ...withoutSuggestion } =
      output.findings[0]!;
    const rangeOutput: ModelReviewOutput = {
      findings: [
        {
          ...withoutSuggestion,
          location: { ...output.findings[0]!.location, startLine: 9 },
        },
      ],
      summary: output.summary,
    };
    const fixture = createSubject(
      new MemoryLedger(),
      new MemoryPublisher(),
      rangeOutput,
    );

    await fixture.subject.execute(job);

    expect(fixture.publisher.published[0]!.body).not.toContain(
      "Suggested action",
    );
    expect(fixture.publisher.published[0]!.startLine).toBe(9);
  });

  it("discards a model finding that is not anchored to a changed line", async () => {
    const fabricatedOutput: ModelReviewOutput = {
      findings: [
        {
          ...output.findings[0]!,
          location: { line: 999, path: "src/index.ts", side: "RIGHT" },
        },
      ],
      summary: "No publishable inline findings.",
    };
    const fixture = createSubject(
      new MemoryLedger(),
      new MemoryPublisher(),
      fabricatedOutput,
    );

    await expect(fixture.subject.execute(job)).resolves.toEqual({
      findingsPublished: 0,
      outcome: "completed",
    });
    expect(fixture.publisher.published).toHaveLength(1);
    expect(fixture.publisher.published[0]!.body).toBe(
      "No publishable inline findings.",
    );
  });

  it("records a retryable failure when analysis fails", async () => {
    const fixture = createSubject();
    const subject = new ExecuteReview({
      clock: { now: () => "2026-08-29T12:00:00.000Z" },
      ledger: fixture.ledger,
      model: { review: () => Promise.reject(new Error("gateway unavailable")) },
      publisher: fixture.publisher,
      pullRequest: {
        currentHeadSha: () => Promise.resolve(job.envelope.pullRequest.headSha),
      },
      repository: { loadContext: () => Promise.resolve(context) },
    });

    await expect(subject.execute(job)).rejects.toThrow("gateway unavailable");
    expect(fixture.ledger.run?.state).toBe("failed_retryable");
  });

  it("resumes an existing retryable run instead of treating it as a duplicate", async () => {
    const fixture = createSubject();
    fixture.ledger.run = {
      attempt: 1,
      createdAt: job.envelope.receivedAt,
      id: job.runId as RunId,
      prKey: "github:42:pr:7",
      state: "failed_retryable",
    };

    await expect(fixture.subject.execute(job)).resolves.toMatchObject({
      outcome: "completed",
    });
    expect(fixture.ledger.transitions[0]).toEqual([
      "failed_retryable",
      "running",
    ]);
  });
});
