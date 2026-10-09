import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { runEvaluationCli } from "../src/cli.js";
import { runIdentificationCli } from "../src/identification-cli.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});
it("writes a recorded report and GitHub summary without provider credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "holon-eval-"));
  try {
    const output = join(dir, "nested/report.json"),
      summary = join(dir, "summary.md");
    await writeFile(summary, "");
    vi.stubEnv("EVALUATION_REPORT_PATH", output);
    vi.stubEnv("GITHUB_STEP_SUMMARY", summary);
    vi.stubEnv("GITHUB_SHA", "local-proof");
    vi.spyOn(process, "argv", "get").mockReturnValue([
      "node",
      "ignored.ts",
      "recorded",
    ]);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runEvaluationCli();
    const report = JSON.parse(await readFile(output, "utf8"));
    expect(report.suite.passedCases).toBe(7);
    expect(report.suite.metrics.recall).toBe(1);
    expect(await readFile(summary, "utf8")).toContain("Passed cases: 7/7");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("rejects invalid CLI modes and unsafe report metadata", async () => {
  vi.spyOn(process, "argv", "get").mockReturnValue([
    "node",
    "ignored.ts",
    "live",
  ]);
  await expect(runEvaluationCli()).rejects.toThrow(/recorded/u);
  vi.spyOn(process, "argv", "get").mockReturnValue([
    "node",
    "ignored.ts",
    "recorded",
  ]);
  vi.stubEnv("GITHUB_SHA", "unsafe\nvalue");
  await expect(runEvaluationCli()).rejects.toThrow(/metadata/u);
});
it("runs identification offline and rejects live mode without configured credentials", async () => {
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  vi.spyOn(process, "argv", "get").mockReturnValue([
    "node",
    "ignored.ts",
    "offline",
  ]);
  await runIdentificationCli();
  expect(write).toHaveBeenCalledWith(expect.stringContaining('"falseExact":0'));
  vi.spyOn(process, "argv", "get").mockReturnValue([
    "node",
    "ignored.ts",
    "unsupported",
  ]);
  await expect(runIdentificationCli()).rejects.toThrow(/explicitly/u);
  vi.spyOn(process, "argv", "get").mockReturnValue([
    "node",
    "ignored.ts",
    "live",
  ]);
  vi.stubEnv("AI_GATEWAY_ACCOUNT_ID", "");
  await expect(runIdentificationCli()).rejects.toThrow(
    "Missing AI_GATEWAY_ACCOUNT_ID",
  );
});
