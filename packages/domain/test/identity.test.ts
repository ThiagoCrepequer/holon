import { describe, expect, it } from "vitest";

import {
  createDeliveryId,
  createFindingId,
  createPrKey,
  createPublicationId,
  createRunId,
} from "../src/index.js";

describe("review identities", () => {
  it("creates stable identities from validated GitHub coordinates", async () => {
    const pr = createPrKey({
      provider: "github",
      repositoryId: 42,
      pullRequestNumber: 7,
    });
    const run = createRunId(pr, "A".repeat(40));

    expect(createDeliveryId("delivery-123")).toBe("github:delivery-123");
    expect(pr).toBe("github:42:pr:7");
    expect(run).toBe(`github:42:pr:7:head:${"a".repeat(40)}`);

    const finding = await createFindingId(run, {
      diagnostic: "  Caller   still sends the removed parameter. ",
      endLine: 18,
      path: "src/caller.ts",
      startLine: 17,
    });

    expect(finding).toMatch(/^finding:[a-f0-9]{64}$/u);
    await expect(
      createFindingId(run, {
        diagnostic: "caller still sends the removed parameter.",
        endLine: 18,
        path: "src/caller.ts",
        startLine: 17,
      }),
    ).resolves.toBe(finding);
    expect(createPublicationId(run, finding)).toBe(
      `${run}:publication:${finding}`,
    );
    expect(createPublicationId(run, "summary")).toBe(
      `${run}:publication:summary`,
    );
  });

  it.each([
    () => createDeliveryId(""),
    () => createDeliveryId("contains space"),
    () =>
      createPrKey({
        provider: "github",
        repositoryId: 0,
        pullRequestNumber: 1,
      }),
    () =>
      createPrKey({
        provider: "github",
        repositoryId: 1,
        pullRequestNumber: -1,
      }),
    () =>
      createRunId(
        createPrKey({
          provider: "github",
          repositoryId: 1,
          pullRequestNumber: 1,
        }),
        "abc",
      ),
  ])("rejects an invalid identity component", (createInvalidIdentity) => {
    expect(createInvalidIdentity).toThrow();
  });
});
