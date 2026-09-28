import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { baselineCorpusV3 } from "../corpus/v3/index.js";
import { baselineRecordingsV3 } from "../recordings/v3/index.js";
import { evalRunConfigurationSchema } from "./contracts.js";
import { createEvaluationReport, renderEvaluationSummary } from "./report.js";
import { runEvaluationSuite } from "./runner.js";
import { createLiveModelSubject } from "./subjects/live-model.js";
import { createRecordedSubject } from "./subjects/recorded.js";

type CliMode = "live" | "recorded";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new TypeError(`required evaluation environment is missing: ${name}`);
  }
  return value;
}

function safeRunMetadata(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new TypeError(`evaluation metadata is invalid: ${name}`);
  }
  return value;
}

function parseMode(value: string | undefined): CliMode {
  if (value === "live" || value === "recorded") return value;
  throw new TypeError("evaluation mode must be live or recorded");
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

async function main(): Promise<void> {
  const mode = parseMode(process.argv[2]);
  const sourceRevision = safeRunMetadata("GITHUB_SHA", "local");
  const modelReference =
    mode === "recorded" ? null : requiredEnvironment("AI_MODEL_ID");
  const configuration = evalRunConfigurationSchema.parse({
    corpusVersion: "baseline-v3",
    mode: mode === "recorded" ? "recorded-output" : "live-model",
    modelReference,
    policyVersion: "review-policy-v1",
    promptVersion: "review-prompt-v1",
    subjectVersion:
      mode === "recorded"
        ? "recorded-output-v3"
        : "live-host-evidence-references",
  });
  const subject =
    mode === "live"
      ? createLiveModelSubject({
          accountId: requiredEnvironment("AI_GATEWAY_ACCOUNT_ID"),
          apiToken: requiredEnvironment("AI_GATEWAY_API_TOKEN"),
          evaluationRunId: safeRunMetadata("GITHUB_RUN_ID", "local"),
          gatewayId: requiredEnvironment("AI_GATEWAY_ID"),
          model: configuration.modelReference ?? "",
          sourceRevision,
        })
      : createRecordedSubject(baselineRecordingsV3);
  const suite = await runEvaluationSuite(
    baselineCorpusV3,
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

await main();
