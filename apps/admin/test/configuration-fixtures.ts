import type {
  ProjectIdentificationResult,
  RunConfigurationSummary,
} from "@holon/contracts";
export const configuration: RunConfigurationSummary = {
  identity: {
    installationId: 1,
    repositoryId: 42,
    pullRequestNumber: 7,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
  },
  configDigest: "c".repeat(64),
  sourceDigest: "d".repeat(64),
  scopeDigest: "e".repeat(64),
  source: ".holon.yml",
  output: { language: "pt-BR", detail: "detailed", maxInlineComments: 0 },
  additionalExcludes: ["docs/generated/**"],
  focus: ["correctness", "security"],
  verdictStrictness: "block_all_confident_medium",
  instructionCount: 3,
  referenceCount: 2,
  pathRuleCount: 1,
  projects: [
    {
      name: "api",
      root: "apps/api",
      compatibility: {
        runtimes: { node: "24" },
        frameworks: { react: "^19", unknown: "1", missing: "2" },
      },
    },
  ],
};
export const identification: ProjectIdentificationResult = {
  snapshotSha: "a".repeat(40),
  inventoryDigest: "f".repeat(64),
  detectorRevision: "detector",
  status: "complete",
  projects: [],
  limitations: [],
  configuredCompatibility: [
    {
      name: "api",
      root: "apps/api",
      projectIds: ["detected-api"],
      declarations: [
        {
          category: "runtimes",
          name: "node",
          expected: "24",
          status: "matches",
          detected: [
            {
              projectId: "detected-api",
              technology: "node",
              value: "24.4.0",
              kind: "declared-exact",
              evidenceIds: ["fact-node"],
              condition: null,
            },
          ],
        },
        {
          category: "frameworks",
          name: "react",
          expected: "^19",
          status: "conflicts",
          detected: [
            {
              projectId: "detected-api",
              technology: "react",
              value: "18.3.1",
              kind: "declared-exact",
              evidenceIds: ["fact-react"],
              condition: "workspace",
            },
          ],
        },
        {
          category: "frameworks",
          name: "unknown",
          expected: "1",
          status: "unknown",
          detected: [],
        },
        {
          category: "frameworks",
          name: "missing",
          expected: "2",
          status: "not_detected",
          detected: [],
        },
      ],
    },
  ],
};
