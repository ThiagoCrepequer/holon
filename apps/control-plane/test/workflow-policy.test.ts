import { reviewJobV1Schema } from "@holon/contracts";
import { describe, expect, it } from "vitest";

import {
  causalVersionForJob,
  durationFrom,
  eventId,
} from "../src/workflow-policy.js";

const v1Job = reviewJobV1Schema.parse({
  envelope: {
    action: "opened",
    deliveryId: "github:policy",
    event: "pull_request",
    installationId: 99,
    pullRequest: {
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      number: 7,
    },
    receivedAt: "2026-08-29T12:00:01.000Z",
    repository: {
      fullName: "acme/api",
      id: 42,
      name: "api",
      owner: "acme",
    },
    schemaVersion: 1,
  },
  runId: `github:42:pr:7:head:${"a".repeat(40)}`,
  schemaVersion: 1,
});

describe("workflow policy", () => {
  it("uses receipt time as the v1 causal clock", () => {
    expect(causalVersionForJob(v1Job)).toBe(v1Job.envelope.receivedAt);
  });

  it("clamps replay durations and builds event ids with or without a suffix", () => {
    const startedAt = new Date("2026-08-29T12:00:02.000Z");
    expect(durationFrom(startedAt, "2026-08-29T12:00:01.000Z")).toBe(0);
    expect(eventId("workflow", "started")).toBe("workflow:started");
    expect(eventId("workflow", "attempt", 2)).toBe("workflow:attempt:2");
  });
});
