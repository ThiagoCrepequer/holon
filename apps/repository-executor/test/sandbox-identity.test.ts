import { describe, expect, it, vi } from "vitest";

import {
  createSandboxId,
  resolveContainerId,
} from "../src/sandbox-identity.js";

const headSha = "a".repeat(40);

describe("Sandbox identity", () => {
  it("resolves the platform Durable Object ID from the deterministic name", () => {
    const platformId = "f".repeat(64);
    const idFromName = vi.fn(() => ({ toString: () => platformId }));
    const runId = `github:42:pr:7:head:${headSha}:base:${"b".repeat(40)}`;

    expect(resolveContainerId({ idFromName }, runId)).toBe(platformId);
    expect(idFromName).toHaveBeenCalledWith(createSandboxId(runId));
  });

  it("compacts a review run into a stable DNS-safe Sandbox ID", () => {
    const runId = `github:1050733747:pr:123456:head:${headSha}:base:${"b".repeat(40)}`;

    const sandboxId = createSandboxId(runId);

    expect(sandboxId).toBe(createSandboxId(runId));
    expect(sandboxId).toMatch(/^[a-z0-9-]+$/u);
    expect(sandboxId.length).toBeLessThanOrEqual(63);
  });

  it("keeps repository and pull request coordinates in the identity", () => {
    expect(
      createSandboxId(`github:42:pr:7:head:${headSha}:base:${"b".repeat(40)}`),
    ).not.toBe(
      createSandboxId(`github:42:pr:8:head:${headSha}:base:${"b".repeat(40)}`),
    );
    expect(
      createSandboxId(`github:42:pr:7:head:${headSha}:base:${"b".repeat(40)}`),
    ).not.toBe(
      createSandboxId(`github:43:pr:7:head:${headSha}:base:${"b".repeat(40)}`),
    );
  });

  it("stays within the platform limit at safe-integer boundaries", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const sandboxId = createSandboxId(
      `github:${maximum}:pr:${maximum}:head:${headSha}:base:${"b".repeat(40)}`,
    );

    expect(sandboxId).toHaveLength(63);
  });

  it("rejects coordinates outside the domain safe-integer boundary", () => {
    const unsafe = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

    expect(() =>
      createSandboxId(
        `github:${unsafe}:pr:7:head:${headSha}:base:${"b".repeat(40)}`,
      ),
    ).toThrow("repositoryId must be a positive safe integer");
  });
});
