import { describe, expect, it } from "vitest";

import {
  compareCompatibilityValue,
  validateCompatibilityDeclaration,
} from "../src/configuration-compatibility.js";

describe("declared compatibility versus detected evidence", () => {
  it("uses npm range containment, not mere overlap or equality", () => {
    expect(
      compareCompatibilityValue("node", ">=22", "22.4.1", "configured-runtime"),
    ).toBe("matches");
    expect(
      compareCompatibilityValue("react", "19.x", "^18.2.0", "declared-range"),
    ).toBe("conflicts");
    expect(
      compareCompatibilityValue("node", ">=22", ">=20", "configured-runtime"),
    ).toBe("unknown");
    expect(
      compareCompatibilityValue("react", "19.x", "^19.1.0", "declared-range"),
    ).toBe("matches");
  });
  it("keeps Java families distinct from Maven qualifiers", () => {
    expect(
      compareCompatibilityValue("java", "21", "21.0.4", "configured-runtime"),
    ).toBe("matches");
    expect(
      compareCompatibilityValue("java", "21", "17", "configured-target"),
    ).toBe("conflicts");
    expect(
      compareCompatibilityValue(
        "quarkus",
        "3.27.x",
        "3.27.1",
        "declared-exact",
      ),
    ).toBe("matches");
    expect(
      compareCompatibilityValue(
        "quarkus",
        "3.27.x",
        "3.27.1.Final",
        "declared-exact",
      ),
    ).toBe("unknown");
  });
  it("does not promote conditional, unknown or unsupported grammars to facts", () => {
    expect(
      compareCompatibilityValue("react", "19.x", "19.1.0", "conditional"),
    ).toBe("unknown");
    expect(
      compareCompatibilityValue("custom", "19.x", "19.1.0", "locked"),
    ).toBe("unknown");
    expect(
      compareCompatibilityValue(
        "python",
        ">=3.11",
        "3.12.2",
        "configured-runtime",
      ),
    ).toBe("matches");
    expect(
      compareCompatibilityValue("python", ">=3.11", ">=3.12", "declared-range"),
    ).toBe("unknown");
  });
  it("rejects malformed known declarations without echoing their content", () => {
    expect(() =>
      validateCompatibilityDeclaration(
        "react",
        "secret-token",
        "projects[0].compatibility.frameworks.react",
      ),
    ).toThrow("invalid_compatibility");
    expect(() =>
      validateCompatibilityDeclaration(
        "custom",
        "vendor-specific",
        "projects[0]",
      ),
    ).not.toThrow();
  });
});

it("keeps detected projects and provenance separate from configured scopes", async () => {
  const { projectCompatibility } =
    await import("../src/configuration-compatibility.js");
  const { compileRepositoryConfiguration } =
    await import("../src/repository-configuration.js");
  const identity = {
    installationId: 1,
    repositoryId: 2,
    pullRequestNumber: 3,
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    runId: `github:2:pr:3:head:${"b".repeat(40)}:base:${"a".repeat(40)}`,
  };
  const snapshot = await compileRepositoryConfiguration(
    identity,
    {
      readFile: async (path) =>
        path === ".holon.yml"
          ? {
              kind: "found",
              bytes: new TextEncoder().encode(
                JSON.stringify({
                  projects: [
                    {
                      name: "parent",
                      root: "apps",
                      compatibility: { frameworks: { react: "18.x" } },
                    },
                    {
                      name: "web",
                      root: "apps/web",
                      compatibility: {
                        frameworks: { react: "19.x", custom: "vendor" },
                        runtimes: { node: ">=22" },
                      },
                    },
                  ],
                }),
              ),
            }
          : { kind: "absent" },
      directoryExists: async () => true,
      isReferenceAllowed: () => true,
    },
    JSON.parse,
  );
  const detected = {
    snapshotSha: identity.headSha,
    inventoryDigest: "c".repeat(64),
    detectorRevision: "detector",
    status: "complete" as const,
    limitations: [],
    projects: [
      {
        id: "node:apps/web",
        root: "apps/web",
        ecosystem: "node" as const,
        fingerprint: "d".repeat(64),
        status: "complete" as const,
        facts: [
          {
            id: "react-fact",
            path: "apps/web/package.json",
            digest: "e".repeat(64),
            selector: "dependencies.react",
            name: "react",
            value: "18.3.1",
            kind: "locked" as const,
            category: "framework" as const,
            condition: null,
          },
        ],
        technologies: [
          {
            name: "react",
            category: "framework" as const,
            declarations: [
              {
                value: "18.3.1",
                kind: "locked" as const,
                evidenceIds: ["react-fact"],
                condition: null,
              },
            ],
          },
        ],
        limitations: [],
        sourcePaths: ["apps/web/package.json"],
        interpretation: "deterministic" as const,
      },
    ],
  };
  const before = JSON.stringify(detected);
  const result = projectCompatibility(snapshot, detected);
  expect(result[0]?.projectIds).toEqual([]);
  expect(result[1]?.projectIds).toEqual(["node:apps/web"]);
  expect(result[1]?.declarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "react",
        expected: "19.x",
        status: "conflicts",
        detected: [
          expect.objectContaining({
            value: "18.3.1",
            evidenceIds: ["react-fact"],
            projectId: "node:apps/web",
          }),
        ],
      }),
      expect.objectContaining({
        name: "node",
        status: "not_detected",
        detected: [],
      }),
      expect.objectContaining({
        name: "custom",
        status: "unknown",
        detected: [],
      }),
    ]),
  );
  expect(JSON.stringify(detected)).toBe(before);
  const unavailable = projectCompatibility(snapshot, {
    ...detected,
    status: "unavailable",
    projects: [],
  });
  expect(
    unavailable
      .flatMap((project) => project.declarations)
      .every((item) => item.status === "unknown"),
  ).toBe(true);
});

it("uses PEP 440 compatible releases, epochs and exclusions without SemVer coercion", () => {
  expect(
    compareCompatibilityValue(
      "python",
      "~=3.11",
      "3.12.2",
      "configured-runtime",
    ),
  ).toBe("matches");
  expect(
    compareCompatibilityValue(
      "python",
      "~=3.11.0",
      "3.12.2",
      "configured-runtime",
    ),
  ).toBe("conflicts");
  expect(
    compareCompatibilityValue("django", ">=4.2,!=4.2.1", "4.2.1", "locked"),
  ).toBe("conflicts");
  expect(
    compareCompatibilityValue("django", ">=1!4.2", "1!4.2.1", "locked"),
  ).toBe("matches");
  expect(() =>
    validateCompatibilityDeclaration(
      "python",
      "==not-a-version",
      "projects[0]",
    ),
  ).toThrow("invalid_compatibility");
});
