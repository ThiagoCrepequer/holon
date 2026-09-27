import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";

import { D1AdminStorage } from "../workers/d1-adapter.js";
import { processRetentionCleanup } from "../workers/retention-handler.js";
import { createSampleProjectionEvent, setupTestDatabase } from "./helpers.js";

describe("processRetentionCleanup", () => {
  let storage: D1AdminStorage;

  beforeEach(async () => {
    await setupTestDatabase(env.DB);
    storage = new D1AdminStorage(env.DB);
  });

  it("cleans up expired records when triggered", async () => {
    const now = 1772582400000;
    const ms181Days = 181 * 24 * 3600 * 1000;

    const oldEvent = await createSampleProjectionEvent({
      runId:
        "github:101:pr:99:head:1111111111111111111111111111111111111111:base:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      prKey: "github:101:pr:99",
      prNumber: 99,
      headSha: "1111111111111111111111111111111111111111",
      terminalAtEpochMs: now - ms181Days,
    });
    await storage.insertProjection(oldEvent, now - ms181Days);

    const result = await processRetentionCleanup(storage, { now: () => now });
    expect(result.deletedRunsCount).toBe(1);
    expect(result.deletedQuarantineCount).toBe(0);
  });
});
