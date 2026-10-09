import { reviewJobSchema } from "@holon/contracts";
import { expect, it } from "vitest";

import { buildCausalVerificationPrompt } from "../src/causal-verification.js";
import { buildReviewPromptResult } from "../src/reviewer.js";

const job = reviewJobSchema.parse({
  runId: `github:1:pr:1:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
  envelope: {
    action: "opened",
    event: "pull_request",
    deliveryId: "github:test",
    installationId: 1,
    receivedAt: "2026-10-08T00:00:00Z",
    pullRequest: {
      title: "Synthetic review",
      author: "synthetic",
      state: "open",
      number: 1,
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      updatedAt: "2026-10-08T00:00:00Z",
    },
    repository: {
      id: 1,
      name: "fixture",
      owner: "synthetic",
      fullName: "synthetic/fixture",
    },
  },
});
const projection = buildReviewPromptResult(job, {
  files: [
    {
      path: "src/value.ts",
      mode: "structural",
      patch: "@@ -1 +1 @@\n-old()\n+new()",
    },
  ],
  changedLines: [{ path: "src/value.ts", side: "RIGHT", line: 1 }],
  truncated: false,
});

it("carries snapshot facts into verification without repeating the investigation task", () => {
  const prompt = buildCausalVerificationPrompt(projection.verificationContext, {
    findings: [],
    summary: "Review",
  });
  expect(prompt).toContain("new()");
  expect(prompt).toContain(job.envelope.pullRequest.headSha);
  expect(prompt).not.toContain(
    "Investigate causal impact and return the required structured review output.",
  );
  expect(prompt).not.toContain("Return investigations as");
});
it("provides selectable IDs for complete inspected receipt windows", () => {
  const receipt = {
    id: "a".repeat(64),
    digest: "b".repeat(64),
    runId: `github:1:pr:1:head:${"c".repeat(40)}:base:${"d".repeat(40)}`,
    headSha: "c".repeat(40),
    path: "src/caller.ts",
    startLine: 20,
    endLine: 24,
    truncated: false,
  };
  const prompt = buildCausalVerificationPrompt(
    projection.verificationContext,
    { findings: [], summary: "Review" },
    [{ receipt, content: "caller()" }],
  );
  expect(prompt).toContain("Selectable evidenceReceiptIds");
  expect(prompt).toContain(JSON.stringify([receipt.id]));
  expect(prompt).toContain(JSON.stringify([{ receipt, content: "caller()" }]));
  expect(prompt).not.toContain("Copyable inspected references");
});
