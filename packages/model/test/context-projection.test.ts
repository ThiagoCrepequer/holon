import { expect, it } from "vitest";

import {
  projectContextList,
  projectStructuralImpact,
} from "../src/context-projection.js";

it("keeps whole JSON entries, counts omissions and still admits smaller later entries", () => {
  const items = [
    "á".repeat(100),
    { path: "src/consumer.ts" },
    { path: "src/second.ts" },
  ];
  const result = projectContextList(items, 60);
  expect(JSON.parse(result.content)).toEqual(items.slice(1));
  expect(result).toMatchObject({ truncated: true, omitted: 1 });
  expect(
    new TextEncoder().encode(result.content).byteLength,
  ).toBeLessThanOrEqual(60);
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
