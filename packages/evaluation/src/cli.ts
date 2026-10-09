import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { baselineCorpusV4 } from "../corpus/v4/index.js";
import { baselineRecordingsV4 } from "../recordings/v4/index.js";
import { evalRunConfigurationSchema } from "./contracts.js";
import { createEvaluationReport, renderEvaluationSummary } from "./report.js";
import { runEvaluationSuite } from "./runner.js";
import { createRecordedSubject } from "./subjects/recorded.js";

function safeRunMetadata(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new TypeError(`evaluation metadata is invalid: ${name}`);
  }
  return value;
}

async function writeResult(
  reportPath: string,
  report: unknown,
  summary: string,
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }
  process.stdout.write(summary);
}

export async function runEvaluationCli(): Promise<void> {
  if (process.argv[2] !== "recorded")
    throw new TypeError("evaluation mode must be recorded");
  const sourceRevision = safeRunMetadata("GITHUB_SHA", "local");
  const configuration = evalRunConfigurationSchema.parse({
    corpusVersion: "baseline-v4",
    mode: "recorded-output",
    modelReference: null,
    policyVersion: "review-policy-v1",
    promptVersion: "review-prompt-v2",
    subjectVersion: "recorded-output-v4",
  });
  const subject = createRecordedSubject(baselineRecordingsV4);
  const suite = await runEvaluationSuite(
    baselineCorpusV4,
    subject,
    configuration,
  );
  const report = createEvaluationReport(suite, sourceRevision);
  const summary = renderEvaluationSummary(report);
  const reportPath =
    process.env.EVALUATION_REPORT_PATH ??
    `artifacts/evaluation/${configuration.mode}.json`;
  await writeResult(reportPath, report, summary);
  if (suite.failedCases > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runEvaluationCli();
