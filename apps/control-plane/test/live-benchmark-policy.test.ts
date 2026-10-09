import { expect, it } from "vitest";

import {
  assertLiveBenchmarkResume,
  liveBenchmarkExitCode,
} from "../evaluation/live-benchmark-policy.js";

const identity = {
  profile: "quality-check",
  thinking: false,
  temperature: null,
  partition: "development",
  structuralContext: false,
  costPolicy: { limitUSD: 0.5 },
  probe: false,
  limits: { calls: 24, inputBytes: 600_000, outputTokens: 50_000 },
  cases: [{ id: "positive", variants: ["receipts"] }],
  variants: ["receipts"],
  sourceDigests: { host: "fixed" },
  routeDeployment: "fixed-route",
  imageDigest: "fixed-image",
};

it("allows continuation only under the same predeclared identity and budget", () => {
  expect(() =>
    assertLiveBenchmarkResume(identity, structuredClone(identity)),
  ).not.toThrow();
  for (const changed of [
    { ...identity, limits: { ...identity.limits, calls: 56 } },
    { ...identity, cases: [] },
    { ...identity, thinking: true },
    { ...identity, temperature: 0 },
    { ...identity, partition: "holdout" },
    { ...identity, structuralContext: true },
    { ...identity, costPolicy: { limitUSD: 0.6 } },
    { ...identity, sourceDigests: { host: "changed" } },
    { ...identity, routeDeployment: "new-route" },
    { ...identity, imageDigest: "new-image" },
  ])
    expect(() => assertLiveBenchmarkResume(identity, changed)).toThrow();
});

it("fails quality when a missing defect or an incomplete case remains even after a successful harness run", () => {
  const expected = ["positive", "negative"];
  const passing = [
    { key: "positive", passed: true },
    { key: "negative", passed: true },
  ];
  expect(liveBenchmarkExitCode(0, passing, expected)).toBe(0);
  expect(
    liveBenchmarkExitCode(
      0,
      [{ key: "positive", passed: false }, passing[1]!],
      expected,
    ),
  ).toBe(2);
  expect(liveBenchmarkExitCode(0, [passing[1]!], expected)).toBe(2);
  expect(liveBenchmarkExitCode(0, [passing[1]!, passing[1]!], expected)).toBe(
    2,
  );
  expect(liveBenchmarkExitCode(0, [], expected)).toBe(2);
  expect(liveBenchmarkExitCode(1, passing, expected)).toBe(1);
  expect(liveBenchmarkExitCode(null, passing, expected)).toBe(1);
});
