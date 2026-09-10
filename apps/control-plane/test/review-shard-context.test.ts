import type {
  IdentifiedProject,
  ProjectIdentificationResult,
  ReviewShard,
} from "@holon/contracts";
import { describe, expect, it } from "vitest";

import { buildShardReviewContext } from "../src/review-shard-context.js";

function project(
  root: string,
  ecosystem: IdentifiedProject["ecosystem"] = "node",
): IdentifiedProject {
  return {
    id: `${ecosystem}:${root}`,
    root,
    ecosystem,
    fingerprint: "c".repeat(64),
    status: "complete",
    interpretation: "deterministic",
    sourcePaths: [],
    facts: [],
    technologies: [],
    limitations: [],
  };
}

function identification(): ProjectIdentificationResult {
  return {
    snapshotSha: "a".repeat(40),
    inventoryDigest: "b".repeat(64),
    detectorRevision: "detector",
    status: "complete",
    limitations: [],
    projects: [
      project("."),
      project("apps/web"),
      project("apps/web/admin"),
      project("services/api"),
      project("apps/web", "maven"),
    ],
  };
}

function shard(paths: readonly string[]): ReviewShard {
  const patch = "@@ -1 +1 @@\n-before\n+after\n";
  return {
    id: "review-shard",
    index: 0,
    totalShards: 1,
    byteLength: new TextEncoder().encode(patch).byteLength * paths.length,
    changedLines: paths.map((path) => ({ path, line: 1, side: "RIGHT" })),
    files: paths.map((path) => ({ path, mode: "structural", patch })),
  };
}

describe("project identification in shard context", () => {
  it.each([
    { path: "apps/web/admin/src/index.ts", expected: ["node:apps/web/admin"] },
    {
      path: "apps/web/src/index.ts",
      expected: ["node:apps/web", "maven:apps/web"],
    },
    { path: "index.ts", expected: ["node:."] },
    { path: "apps/website/src/index.ts", expected: ["node:."] },
    {
      path: "apps/web/admin-tools/index.ts",
      expected: ["node:apps/web", "maven:apps/web"],
    },
  ])(
    "associates $path only with its nearest project root",
    ({ path, expected }) => {
      const context = buildShardReviewContext(
        shard([path]),
        undefined,
        [],
        identification(),
        false,
      );
      expect(
        context.projectIdentification?.projects.map((item) => item.id),
      ).toEqual(expected);
    },
  );

  it("keeps parent and nested projects when different files in the shard belong to each", () => {
    const identified = identification();
    const context = buildShardReviewContext(
      shard([
        "index.ts",
        "apps/web/src/index.ts",
        "apps/web/admin/src/index.ts",
      ]),
      undefined,
      [],
      identified,
      false,
    );
    expect(
      context.projectIdentification?.projects.map((item) => item.id),
    ).toEqual([
      "node:.",
      "node:apps/web",
      "node:apps/web/admin",
      "maven:apps/web",
    ]);
    expect(context.projectIdentification?.snapshotSha).toBe("a".repeat(40));
    expect(identified.projects.map((item) => item.id)).toContain(
      "node:services/api",
    );
  });

  it("does not attach a sibling project to a file outside every detected root", () => {
    const context = buildShardReviewContext(
      shard(["apps/website/src/index.ts"]),
      undefined,
      [],
      {
        ...identification(),
        projects: [project("apps/web"), project("services/api")],
      },
      false,
    );
    expect(context.projectIdentification?.projects).toEqual([]);
  });
});
