import { reviewJobSchema } from "@holon/contracts";
import { describe, expect, it } from "vitest";

import {
  causalVersionForJob,
  durationFrom,
  eventId,
} from "../src/review/workflow-policy.js";

const job = reviewJobSchema.parse({
  envelope: {
    action: "opened",
    deliveryId: "github:policy",
    event: "pull_request",
    installationId: 99,
    pullRequest: {
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      number: 7,
      updatedAt: "2026-08-29T12:00:00.000Z",
    },
    receivedAt: "2026-08-29T12:00:01.000Z",
    repository: {
      fullName: "acme/api",
      id: 42,
      name: "api",
      owner: "acme",
    },
  },
  runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
});

describe("workflow policy", () => {
  it("uses the required PR update time as the causal clock", () => {
    expect(causalVersionForJob(job)).toBe(job.envelope.pullRequest.updatedAt);
  });

  it("clamps replay durations and builds event ids with or without a suffix", () => {
    const startedAt = new Date("2026-08-29T12:00:02.000Z");
    expect(durationFrom(startedAt, "2026-08-29T12:00:01.000Z")).toBe(0);
    expect(eventId("workflow", "started")).toBe("workflow:started");
    expect(eventId("workflow", "attempt", 2)).toBe("workflow:attempt:2");
  });
});
