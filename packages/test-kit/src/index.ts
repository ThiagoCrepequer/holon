import {
  reviewJobSchema,
  type ReviewContextV2,
  type ReviewJob,
} from "@holon/contracts";

const defaultHeadSha = "a".repeat(40);

export function createReviewJob(
  overrides: {
    readonly headSha?: string;
    readonly pullRequestNumber?: number;
    readonly repositoryId?: number;
  } = {},
): ReviewJob {
  const headSha = overrides.headSha ?? defaultHeadSha;
  const pullRequestNumber = overrides.pullRequestNumber ?? 7;
  const repositoryId = overrides.repositoryId ?? 42;
  return reviewJobSchema.parse({
    envelope: {
      action: "opened",
      deliveryId: "github:test-delivery",
      event: "pull_request",
      installationId: 99,
      pullRequest: {
        baseSha: "b".repeat(40),
        headSha,
        number: pullRequestNumber,
      },
      receivedAt: "2026-08-29T12:00:00.000Z",
      repository: {
        fullName: "acme/api",
        id: repositoryId,
        name: "api",
        owner: "acme",
      },
      schemaVersion: 1,
    },
    runId: `github:${repositoryId}:pr:${pullRequestNumber}:head:${headSha}`,
    schemaVersion: 1,
  });
}

export function createReviewContext(): ReviewContextV2 {
  const patch =
    "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -9,0 +10,1 @@\n+return null;\n";
  return {
    changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
    files: [{ mode: "structural", patch, path: "src/index.ts" }],
    schemaVersion: 2,
    truncated: false,
  };
}
