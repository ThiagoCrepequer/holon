import { expect, it } from "vitest";

import { createInvestigationProgress } from "../src/investigation-progress.js";

it("tracks pending checks and refuses unknown or duplicate identifiers atomically", () => {
  const progress = createInvestigationProgress(["src/a.ts", "src/b.ts"]);
  expect(progress.counts()).toEqual({ reviewed: 0, pending: 2, blocked: 0 });
  expect(() =>
    progress.record({
      checks: [
        { id: "file-0", status: "reviewed", note: "verified" },
        { id: "other", status: "reviewed", note: "unknown" },
      ],
      summary: "done",
      finished: true,
    }),
  ).toThrow();
  expect(progress.counts().pending).toBe(2);
  expect(() =>
    progress.record({
      checks: [
        { id: "file-0", status: "reviewed", note: "verified" },
        { id: "file-0", status: "blocked", note: "blocked" },
      ],
      summary: "",
      finished: false,
    }),
  ).toThrow();
});
it("finishes with verified notes while preserving blocked coverage", () => {
  const progress = createInvestigationProgress(["src/a.ts", "src/b.ts"]);
  progress.record({
    checks: [
      {
        id: "file-0",
        status: "reviewed",
        note: "Contract and callers verified",
      },
    ],
    summary: "Verified diagnosis",
    finished: false,
  });
  progress.record({
    checks: [{ id: "file-1", status: "blocked", note: "Consumer unavailable" }],
    summary: "One unresolved check",
    finished: true,
  });
  expect(progress.finished()).toBe(true);
  expect(progress.complete()).toBe(false);
  expect(progress.summary()).toContain("Contract and callers verified");
  expect(progress.counts()).toEqual({ reviewed: 1, pending: 0, blocked: 1 });
});
it("requires explicit reviewed coverage and can invalidate premature completion", () => {
  const progress = createInvestigationProgress(["src/a.ts"]);
  progress.record({
    checks: [
      { id: "file-0", status: "reviewed", note: "Checked supplied patch" },
    ],
    summary: "No defect",
    finished: true,
  });
  expect(progress.complete()).toBe(true);
  progress.invalidateCompletion();
  expect(progress.complete()).toBe(false);
  expect(progress.counts().pending).toBe(1);
});

it("rolls back only the current round without losing earlier verified work", () => {
  const progress = createInvestigationProgress(["a.ts", "b.ts"]);
  progress.record({
    checks: [
      { id: "file-0", status: "reviewed", note: "Earlier verified contract" },
    ],
    summary: "Earlier diagnosis",
    finished: false,
  });
  progress.beginRound();
  progress.record({
    checks: [{ id: "file-1", status: "reviewed", note: "Premature" }],
    summary: "Premature diagnosis",
    finished: true,
  });
  progress.invalidateCompletion();
  expect(progress.counts()).toEqual({ reviewed: 1, pending: 1, blocked: 0 });
  expect(progress.summary()).toContain("Earlier diagnosis");
  expect(progress.summary()).not.toContain("Premature");
});
it("bounds accumulated notes atomically and permits closing without deleting prior diagnoses", () => {
  const progress = createInvestigationProgress(["a.ts"]);
  for (let index = 0; index < 4; index++)
    progress.record({
      checks: [],
      summary: String(index).repeat(8000),
      finished: false,
    });
  expect(() =>
    progress.record({
      checks: [{ id: "file-0", status: "reviewed", note: "Discarded update" }],
      summary: "overflow",
      finished: true,
    }),
  ).toThrow("capacity");
  expect(progress.counts().pending).toBe(1);
  progress.record({ checks: [], summary: "", finished: true });
  expect(progress.finished()).toBe(true);
  expect(progress.complete()).toBe(false);
  expect(progress.summary()).toContain("000000");
});
