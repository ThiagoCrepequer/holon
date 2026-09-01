import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("harness evaluation Worker", () => {
  it("routes through the authenticated handler", async () => {
    const hash = "b".repeat(64);
    const response = await SELF.fetch(
      `https://example.test/runs/eval-${hash}/review-${hash}`,
      {
        headers: {
          authorization: "Bearer test-evaluation-token-long-enough",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reason: "unknown",
      status: "errored",
    });
  });
});
