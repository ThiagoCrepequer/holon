/** Git objects identify the immutable incident; source contents are not recorded. */
export const incidentCase = {
  baseSha: "b34acd285eaf0f59cfca6e9b7ffa53d5f5f80c5b",
  headSha: "7299188ca10cd4f20c5c63a05a96f993ee12c216",
  repositoryId: 1350973835,
  pullRequestNumber: 106,
  repositoryOwner: "ThiagoCrepequer",
  repositoryName: "holon",
  expected: { files: 32, lines: 1368, shards: 8 },
} as const;

export const injectedDefect = {
  path: "apps/control-plane/src/local-review-defect.ts",
  content:
    "export function canStartAttempt(attempt: number, limit: number): boolean {\n  // Contract: attempts must be strictly below limit.\n  return attempt <= limit;\n}\n",
  line: 3,
  excerpt: "return attempt <= limit;",
} as const;
