import { describe, expect, it } from "vitest";

import { identifySnapshot } from "../src/index.js";
const sha = "a".repeat(40);
describe("project identification", () => {
  it("keeps independent projects and declared ranges separate", async () => {
    const result = await identifySnapshot({
      snapshotSha: sha,
      files: [
        {
          path: "apps/web/package.json",
          content: JSON.stringify({
            dependencies: { react: "^19.0.0", next: "15.2.0" },
          }),
        },
        {
          path: "apps/legacy/package.json",
          content: JSON.stringify({ dependencies: { react: "18.3.1" } }),
        },
      ],
      policyDigest: "policy",
      modelRevision: "model",
    });
    expect(result.projects).toHaveLength(2);
    expect(
      result.projects
        .find((p) => p.root === "apps/web")
        ?.technologies.find((t) => t.name === "react")?.declarations[0],
    ).toMatchObject({ value: "^19.0.0", kind: "declared-range" });
    expect(
      result.projects
        .find((p) => p.root === "apps/legacy")
        ?.technologies.find((t) => t.name === "react")?.declarations[0]?.value,
    ).toBe("18.3.1");
  });
  it("does not infer Node from TypeScript target", async () => {
    const result = await identifySnapshot({
      snapshotSha: sha,
      files: [
        {
          path: "package.json",
          content: '{"devDependencies":{"typescript":"5.7.2"}}',
        },
        {
          path: "tsconfig.json",
          content: '{"compilerOptions":{"target":"ES2022"}}',
        },
      ],
      policyDigest: "policy",
      modelRevision: "model",
    });
    expect(
      result.projects[0]?.technologies.some((t) => t.name === "node"),
    ).toBe(false);
    expect(
      result.projects[0]?.technologies.find((t) => t.name === "ecmascript")
        ?.declarations[0]?.kind,
    ).toBe("configured-target");
  });
});
