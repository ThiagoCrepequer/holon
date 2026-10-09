import { expect, it } from "vitest";

import {
  projectStructuralImpact,
  selectStructuralImpact,
  structuralImpactFits,
} from "../src/structural-context.js";

it("selects complete path-related records in both consumer directions without changing inventory metadata", () => {
  const input = {
    changedSymbols: [
      { path: "a", name: "kept" },
      { path: "b", name: "other" },
    ],
    contractBreaks: [{ path: "b" }],
    securitySurfaces: [{ path: "a", excerpt: "kept" }],
    downstreamReferences: [
      { targetPath: "a", callerPath: "b", excerpt: "inbound" },
      { targetPath: "b", callerPath: "a", excerpt: "outbound" },
      { targetPath: "b", callerPath: "c" },
    ],
    repositoryScanTruncated: true,
    omittedSignals: {
      changedSymbols: 2,
      downstreamReferences: 3,
      contractBreaks: 0,
      securitySurfaces: 0,
    },
  };
  const selected = selectStructuralImpact(input, ["a"]);
  expect(selected).toEqual({
    ...input,
    changedSymbols: [{ path: "a", name: "kept" }],
    contractBreaks: [],
    downstreamReferences: input.downstreamReferences.slice(0, 2),
  });
  expect(input.changedSymbols).toHaveLength(2);
  expect(input.downstreamReferences).toHaveLength(3);
});

it.each([
  [23800, true],
  [23801, true],
  [23802, false],
])(
  "measures the full ASCII envelope at the byte boundary (entry=%s)",
  (length, expected) => {
    const input = {
      changedSymbols: ["x".repeat(length)],
      contractBreaks: [],
      downstreamReferences: [],
      securitySurfaces: [],
    };
    // Empty envelope is 133 bytes; this single entry adds two quotes and its ASCII bytes.
    expect(structuralImpactFits(input)).toBe(expected);
    expect(projectStructuralImpact(input, 24000).truncated).toBe(!expected);
  },
);

it("accepts an absent report and charges multi-byte records by UTF-8 bytes", () => {
  expect(structuralImpactFits(undefined)).toBe(true);
  expect(
    structuralImpactFits({
      changedSymbols: ["á".repeat(11902)],
      contractBreaks: [],
      downstreamReferences: [],
      securitySurfaces: [],
    }),
  ).toBe(false);
});

it("shares structural context across categories without losing the partial-inventory flag", () => {
  expect(projectStructuralImpact(undefined, 100)).toEqual({
    content: "null",
    truncated: false,
    omitted: 0,
  });
  const report = {
    changedSymbols: ["symbol"],
    contractBreaks: ["contract"],
    downstreamReferences: ["consumer"],
    securitySurfaces: ["guard"],
    repositoryScanTruncated: true,
  };
  expect(
    JSON.parse(projectStructuralImpact(report, 1000).content),
  ).toMatchObject(report);
  const limited = projectStructuralImpact(
    { ...report, contractBreaks: ["x".repeat(2000)] },
    300,
  );
  expect(JSON.parse(limited.content)).toMatchObject({
    changedSymbols: ["symbol"],
    downstreamReferences: ["consumer"],
    securitySurfaces: ["guard"],
    contractBreaks: [],
    repositoryScanTruncated: true,
    omitted: 1,
  });
  expect(limited.truncated).toBe(true);
});

it("preserves producer gaps separately from omissions made by the prompt projection", () => {
  const result = projectStructuralImpact(
    {
      changedSymbols: ["symbol"],
      contractBreaks: ["x".repeat(2000)],
      downstreamReferences: [],
      securitySurfaces: [],
      omittedSignals: {
        changedSymbols: 1,
        contractBreaks: 2,
        downstreamReferences: 3,
        securitySurfaces: 4,
      },
    },
    400,
  );
  expect(result.truncated).toBe(true);
  expect(result.omitted).toBe(1);
  expect(JSON.parse(result.content)).toMatchObject({
    contractBreaks: [],
    omittedSignals: {
      changedSymbols: 1,
      contractBreaks: 2,
      downstreamReferences: 3,
      securitySurfaces: 4,
    },
    omitted: 1,
  });
  expect(
    new TextEncoder().encode(result.content).byteLength,
  ).toBeLessThanOrEqual(400);
});

it("reports global inventory gaps without claiming that the local prompt was truncated", () => {
  const result = projectStructuralImpact(
    {
      changedSymbols: [],
      contractBreaks: [],
      downstreamReferences: [],
      securitySurfaces: [],
      repositoryScanTruncated: true,
      omittedSignals: {
        changedSymbols: 351,
        contractBreaks: 0,
        downstreamReferences: 0,
        securitySurfaces: 0,
      },
    },
    10_000,
  );
  expect(result.truncated).toBe(false);
  expect(result.omitted).toBe(0);
  expect(JSON.parse(result.content)).toMatchObject({
    repositoryScanTruncated: true,
    omittedSignals: { changedSymbols: 351 },
  });
});
