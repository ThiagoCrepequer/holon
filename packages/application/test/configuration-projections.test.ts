import { describe, expect, it } from "vitest";

import {
  configurationReference,
  verifyConfigurationSnapshot,
  sanitizedConfigurationSummary,
  projectConfigurationGuidance,
} from "../src/configuration-projections.js";
import { compileRepositoryConfiguration } from "../src/repository-configuration.js";

const identity = {
  installationId: 1,
  repositoryId: 2,
  pullRequestNumber: 3,
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  runId: `github:2:pr:3:head:${"b".repeat(40)}:base:${"a".repeat(40)}`,
};
async function compile(input: unknown) {
  return compileRepositoryConfiguration(
    identity,
    {
      readFile: async (path) =>
        path === ".holon.yml"
          ? {
              kind: "found",
              bytes: new TextEncoder().encode(JSON.stringify(input)),
            }
          : { kind: "absent" },
      directoryExists: async () => true,
      isReferenceAllowed: () => true,
    },
    JSON.parse,
  );
}
describe("scoped review guidance", () => {
  it("serializes shared text once and preserves the complete instruction chain for 50 files", async () => {
    const instruction = "a".repeat(16000);
    const snapshot = await compile({ instructions: [instruction] });
    const guidance = projectConfigurationGuidance(
      snapshot,
      Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`),
    );
    expect(guidance.instructions.map((entry) => entry.text)).toEqual([
      instruction,
    ]);
    expect(guidance.scopes).toHaveLength(50);
    expect(
      guidance.scopes.every(
        (scope) => scope.instructionOrigins.join() === "instructions[0]",
      ),
    ).toBe(true);
  });
  it("uses only the deepest project and all matching rules, retaining their declaration order", async () => {
    const snapshot = await compile({
      instructions: ["global"],
      projects: [
        { name: "parent", root: "apps", instructions: ["parent"] },
        { name: "api", root: "apps/api", instructions: ["api"] },
      ],
      path_rules: [
        { paths: ["apps/**"], instructions: ["first"] },
        { paths: ["**/*.ts"], instructions: ["second"] },
      ],
    });
    const guidance = projectConfigurationGuidance(snapshot, [
      "apps/api/a.ts",
      "apps/api-client/b.ts",
      "README.md",
    ]);
    const chain = (index: number) =>
      guidance.scopes[index]!.instructionOrigins.map(
        (origin) =>
          guidance.instructions.find((entry) => entry.origin === origin)!.text,
      );
    expect(chain(0)).toEqual(["global", "api", "first", "second"]);
    expect(chain(1)).toEqual(["global", "parent", "first", "second"]);
    expect(chain(2)).toEqual(["global"]);
  });
  it("rejects combined applicable guidance before truncating any instruction", async () => {
    const snapshot = await compile({
      instructions: ["a".repeat(16000)],
      projects: [{ name: "api", root: ".", instructions: ["b".repeat(16000)] }],
      path_rules: [{ paths: ["src/**"], instructions: ["c".repeat(1000)] }],
    });
    expect(() => projectConfigurationGuidance(snapshot, ["src/a.ts"])).toThrow(
      "budget_exceeded",
    );
  });
});

it("verifies content, authority and all digest roles independently", async () => {
  const snapshot = await compile({ instructions: ["private instruction"] });
  const ref = configurationReference(snapshot);
  await expect(
    verifyConfigurationSnapshot(snapshot, ref),
  ).resolves.toBeUndefined();
  for (const mutate of [
    (value: typeof snapshot) => {
      value.config.instructions[0]!.text = "tampered";
    },
    (value: typeof snapshot) => {
      value.compilerIdentity = "tampered";
    },
    (value: typeof snapshot) => {
      value.identity.installationId = 2;
    },
    (value: typeof snapshot) => {
      value.sourceDigest = "d".repeat(64);
    },
    (value: typeof snapshot) => {
      value.scopeDigest = "d".repeat(64);
    },
    (value: typeof snapshot) => {
      value.configDigest = "d".repeat(64);
    },
  ]) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    await expect(
      verifyConfigurationSnapshot(changed, ref),
    ).rejects.toMatchObject({ code: "snapshot_mismatch" });
  }
});
it("summarizes counts and compatibility without private instructions or descriptions", async () => {
  const snapshot = await compile({
    instructions: ["secret global"],
    projects: [
      {
        name: "api",
        root: ".",
        description: "secret description",
        compatibility: { runtimes: { node: "24" } },
        instructions: ["secret project"],
      },
    ],
    path_rules: [{ paths: ["src/**"], instructions: ["secret path rule"] }],
  });
  const summary = sanitizedConfigurationSummary(snapshot);
  expect(summary).toMatchObject({
    instructionCount: 3,
    referenceCount: 0,
    pathRuleCount: 1,
    projects: [
      { name: "api", root: ".", compatibility: { runtimes: { node: "24" } } },
    ],
  });
  expect(JSON.stringify(summary)).not.toContain("secret");
});
