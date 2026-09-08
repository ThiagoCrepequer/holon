import { describe, expect, it } from "vitest";

import {
  InvalidRunTransitionError,
  canTransitionRun,
  isTerminalRunState,
  transitionRun,
  type ReviewRun,
} from "../src/index.js";

const run: ReviewRun = {
  causalVersion: "2026-08-29T12:00:00.000Z",
  attempt: 0,
  createdAt: "2026-08-29T12:00:00.000Z",
  id: `github:42:pr:7:head:${"a".repeat(40)}`,
  prKey: "github:42:pr:7",
  state: "queued",
};

describe("review run state machine", () => {
  it("follows the documented successful lifecycle without mutating the input", () => {
    const running = transitionRun(run, "running", "2026-08-29T12:00:01.000Z");
    const publishing = transitionRun(
      running,
      "publishing",
      "2026-08-29T12:00:02.000Z",
    );
    const completed = transitionRun(
      publishing,
      "completed",
      "2026-08-29T12:00:03.000Z",
    );

    expect(run.state).toBe("queued");
    expect(running).toMatchObject({ attempt: 1, state: "running" });
    expect(completed).toMatchObject({
      state: "completed",
      updatedAt: "2026-08-29T12:00:03.000Z",
    });
    expect(isTerminalRunState(completed.state)).toBe(true);
  });

  it("allows retryable failures to resume and counts each execution attempt", () => {
    const running = transitionRun(run, "running", "2026-08-29T12:00:01.000Z");
    const failed = transitionRun(
      running,
      "failed_retryable",
      "2026-08-29T12:00:02.000Z",
    );
    const retried = transitionRun(
      failed,
      "running",
      "2026-08-29T12:00:03.000Z",
    );

    expect(retried.attempt).toBe(2);
    expect(canTransitionRun("failed_retryable", "failed_terminal")).toBe(true);
    expect(canTransitionRun("failed_retryable", "obsolete")).toBe(true);
  });

  it.each([
    ["queued", "completed"],
    ["completed", "running"],
    ["obsolete", "running"],
    ["failed_terminal", "running"],
  ] as const)("rejects transition %s -> %s", (from, to) => {
    expect(canTransitionRun(from, to)).toBe(false);
    expect(() =>
      transitionRun({ ...run, state: from }, to, "2026-08-29T12:00:01.000Z"),
    ).toThrow(InvalidRunTransitionError);
  });
});
