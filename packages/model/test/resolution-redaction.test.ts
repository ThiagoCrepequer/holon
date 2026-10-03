import { expect, it } from "vitest";

import { limitUtf8Text, redactModelReviewOutput } from "../src/redaction.js";

it("redacts resolution diagnostics and evidence without losing identity or confidence", () => {
  const secret = `ghp_${"a".repeat(30)}`;
  const fingerprint = `fp:${"f".repeat(64)}` as const;
  const output = redactModelReviewOutput({
    findings: [],
    summary: "Review complete",
    resolutions: [
      {
        fingerprint,
        confidence: 0.95,
        diagnostic: `Removed credential ${secret}`,
        location: { path: "src/config.ts", line: 1, side: "RIGHT" },
        evidence: [
          {
            path: "src/config.ts",
            startLine: 1,
            excerpt: `const token = "${secret}"`,
            reason: `Replaces ${secret}`,
          },
        ],
      },
    ],
  });
  expect(JSON.stringify(output)).not.toContain(secret);
  expect(output.resolutions?.[0]).toMatchObject({
    fingerprint,
    confidence: 0.95,
    diagnostic: "Removed credential [REDACTED_SECRET]",
    evidence: [
      {
        excerpt: 'const token = "[REDACTED_SECRET]"',
        reason: "Replaces [REDACTED_SECRET]",
      },
    ],
  });
});

it("limits UTF-8 text at code point boundaries and rejects invalid byte budgets", () => {
  expect(limitUtf8Text("short", 5)).toEqual({
    content: "short",
    truncated: false,
  });
  expect(limitUtf8Text("a語b", 2)).toEqual({ content: "a", truncated: true });
  expect(limitUtf8Text("語", 0)).toEqual({ content: "", truncated: true });
  expect(() => limitUtf8Text("text", -1)).toThrow(TypeError);
  expect(() => limitUtf8Text("text", 1.5)).toThrow(TypeError);
});

it("redacts findings, suggestions and summaries while preserving safe output flags", () => {
  const secret = `ghp_${"b".repeat(30)}`;
  const output = redactModelReviewOutput({
    findings: [
      {
        confidence: 0.9,
        diagnostic: `A credential ${secret} is sent to the client.`,
        evidence: [
          {
            path: "src/auth.ts",
            startLine: 4,
            excerpt: secret,
            reason: `Leaks ${secret}`,
          },
        ],
        location: { path: "src/auth.ts", line: 4, side: "RIGHT" },
        severity: "high",
        suggestion: `Remove ${secret}`,
      },
    ],
    isDegraded: true,
    outputLimitations: ["input_context_omitted"],
    summary: `Review ${secret}`,
  });
  expect(JSON.stringify(output)).not.toContain(secret);
  expect(output).toMatchObject({
    isDegraded: true,
    outputLimitations: ["input_context_omitted"],
    findings: [{ confidence: 0.9, severity: "high" }],
  });
});
