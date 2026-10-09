import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { posix } from "node:path";

const names = [
  "diagnostic-probe",
  "ablation",
  "context-rejected",
  "thinking",
  "price-parameters-rejected",
  "price-parameters-rejected-again",
  "native-positive-probe",
  "native-baseline",
  "schema-clarity",
  "structural-positive-probe",
  "structural-context",
  "canonical-anchors",
  "copyable-causal",
  "holdout",
  "copyable-causal-ablation",
  "isolated-causal-context",
  "confirmation",
  "reachability",
  "temperature-zero",
  "receipt-selection",
  "schema-typing",
  "code-regression",
  "code-regression-repeat",
];
const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const sum = (items, select) =>
  items.reduce((total, item) => total + select(item), 0);
const median = (values) => {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const key = (caseId, variant) => `${caseId}:${variant}`;
function expectedCases(configuration) {
  if (configuration.probe)
    return [{ ...configuration.cases[0], variant: "receipts" }];
  return configuration.cases.flatMap((item) =>
    (item.variants ?? configuration.variants).map((variant) => ({
      ...item,
      variant,
    })),
  );
}
function metrics(report, results, expected, events) {
  const positives = expected.filter((item) => item.positive);
  const negatives = expected.filter((item) => !item.positive);
  const matched = (item) =>
    results.find(
      (result) =>
        key(result.caseId, result.variant) === key(item.id, item.variant),
    );
  const detectedPositive = positives.filter(
    (item) => matched(item)?.passed,
  ).length;
  const preparation = results.map(
    (result) =>
      report.configuration.preparation?.find(
        (item) => item.caseId === result.caseId,
      )?.metrics.durationMs ?? 0,
  );
  return {
    expectedReviews: expected.length,
    completedReviews: results.length,
    missingReviews: expected.length - results.length,
    passed: results.filter((result) => result.passed).length,
    detectedPositive,
    expectedPositive: positives.length,
    operationalRecall: positives.length
      ? detectedPositive / positives.length
      : null,
    passedNegative: negatives.filter((item) => matched(item)?.passed).length,
    expectedNegative: negatives.length,
    negativeReviewsWithFindings: results.filter(
      (result) => !result.expectedDefect && result.final?.findings.length > 0,
    ).length,
    failures: results.filter((result) => result.failure !== null).length,
    rejectedCandidates: sum(results, (result) => result.rejections.length),
    causalReviews: results.filter((result) =>
      result.phases.some((phase) => phase.phase === "causal_verification"),
    ).length,
    generations: events.length,
    inputBytes: sum(events, (event) => event.inputBytes),
    inputTokensReported: sum(events, (event) => event.inputTokens ?? 0),
    outputTokensReported: sum(events, (event) => event.outputTokens ?? 0),
    reasoningTokensReported: sum(events, (event) => event.reasoningTokens ?? 0),
    requestsWithoutUsage: events.filter(
      (event) => event.outputTokens === undefined,
    ).length,
    providerCostReportedUSD: sum(events, (event) => event.cost ?? 0),
    requestsWithoutCost: events.filter((event) => event.cost === undefined)
      .length,
    statusCounts: Object.fromEntries(
      [...new Set(events.map((event) => event.status))].map((status) => [
        status,
        events.filter((event) => event.status === status).length,
      ]),
    ),
    reservedOutputTokens: sum(events, (event) => event.maxOutputTokens),
    logicalToolsReserved: sum(results, (result) => result.usage.logicalTools),
    executorLogicalTools: sum(
      results,
      (result) => result.executor.logicalTools,
    ),
    physicalTools: sum(results, (result) => result.executor.physicalTools),
    cacheHits: sum(results, (result) => result.executor.cacheHits),
    totalDurationMs: sum(results, (result) => result.durationMs),
    medianDurationMs: median(results.map((result) => result.durationMs)),
    medianInitialInventoryMs: report.configuration.structuralContext
      ? median(preparation)
      : null,
    medianReviewPlusInitialInventoryMs: report.configuration.structuralContext
      ? median(
          results.map(
            (result, index) => result.durationMs + preparation[index],
          ),
        )
      : null,
    // Historical graders checked detection/location; the current lexical rubric still needs independent adjudication.
    publishedPrecision: null,
  };
}
async function checkSources(name, configuration) {
  let manifest;
  try {
    manifest = await readJson(`./${name}/source-files.json`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let verified = 0;
  const missing = [];
  for (const [path, expected] of Object.entries(
    configuration.sourceDigests ?? {},
  )) {
    const repositoryPath = posix.normalize(
      posix.join("apps/control-plane", path),
    );
    const entry = manifest?.[`${repositoryPath}.source`];
    let content;
    try {
      content = await readFile(
        new URL(
          entry
            ? `./${name}/${entry.snapshot}`
            : `./${name}/sources/${repositoryPath}.source`,
          import.meta.url,
        ),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(repositoryPath);
      continue;
    }
    const digest = createHash("sha256").update(content).digest("hex");
    assert.equal(digest, expected, `${name}: source ${repositoryPath}`);
    if (entry) assert.equal(digest, entry.sha256);
    verified++;
  }
  return { verified, missing, fullGitSnapshot: false };
}
const spend = await readJson("./campaign-spend.json");
const records = new Map(spend.records.map((record) => [record.id, record]));
assert.equal(records.size, spend.records.length);
const seenSpend = new Set();
function checkSpend(id, cost) {
  const record = records.get(id);
  assert(record, `Missing spending reservation: ${id}`);
  assert(!seenSpend.has(id), `Duplicate request: ${id}`);
  seenSpend.add(id);
  if (cost === undefined) assert.equal(record.chargedNanodollars, undefined);
  else
    assert.equal(
      record.chargedNanodollars,
      Math.ceil((cost * 1e9 * spend.policy.marginPercent) / 100),
    );
}
const cohorts = [];
for (const name of names) {
  const report = await readJson(`./${name}/results.json`);
  assert.equal(report.budget.calls, report.modelEvents.length);
  assert.equal(
    report.budget.inputBytes,
    sum(report.modelEvents, (event) => event.inputBytes),
  );
  assert.equal(
    report.budget.reservedOutputTokens,
    sum(report.modelEvents, (event) => event.maxOutputTokens),
  );
  assert(report.budget.calls <= report.configuration.limits.calls);
  assert(report.budget.inputBytes <= report.configuration.limits.inputBytes);
  assert(
    report.budget.reservedOutputTokens <=
      report.configuration.limits.outputTokens,
  );
  const expected = expectedCases(report.configuration);
  assert.equal(
    new Set(report.results.map((result) => key(result.caseId, result.variant)))
      .size,
    report.results.length,
  );
  let start = 0;
  const eventsByResult = new Map();
  for (const result of report.results) {
    assert(
      expected.some(
        (item) =>
          key(item.id, item.variant) === key(result.caseId, result.variant),
      ),
    );
    assert.equal(
      result.expectedDefect,
      expected.find((item) => item.id === result.caseId).positive,
    );
    assert(
      result.modelEventEnd >= start &&
        result.modelEventEnd <= report.modelEvents.length,
    );
    eventsByResult.set(
      result,
      report.modelEvents.slice(start, result.modelEventEnd),
    );
    start = result.modelEventEnd;
  }
  for (const [index, event] of report.modelEvents.entries()) {
    assert([200, 422].includes(event.status));
    if (event.model)
      assert(
        [
          "google/gemma-4-26b-a4b-it",
          "google/gemma-4-26b-a4b-it:free",
        ].includes(event.model),
      );
    assert.equal(event.maxOutputTokens, 2051);
    checkSpend(event.spendId ?? `${name}:${index}`, event.cost);
  }
  for (const oracle of report.configuration.oracles ?? []) {
    assert.equal(oracle.base.failed, false);
    assert.equal(oracle.head.failed, oracle.caseId.endsWith(".positive"));
    if (name.startsWith("code-regression")) {
      assert.equal(oracle.baseTypecheck.passed, true);
      assert.equal(oracle.headTypecheck.passed, true);
    }
  }
  if (name.startsWith("code-regression"))
    for (const result of report.results) {
      assert.equal(result.passed, result.grade.passed);
      assert.equal(result.grade.passed, result.grade.failures.length === 0);
    }
  cohorts.push({
    name,
    ...metrics(report, report.results, expected, report.modelEvents),
    sources: await checkSources(name, report.configuration),
    variants: Object.fromEntries(
      [...new Set(expected.map((item) => item.variant))].map((variant) => {
        const results = report.results.filter(
          (result) => result.variant === variant,
        );
        return [
          variant,
          metrics(
            report,
            results,
            expected.filter((item) => item.variant === variant),
            results.flatMap((result) => eventsByResult.get(result)),
          ),
        ];
      }),
    ),
  });
}
const protocol = await readJson("./price-probe.json");
for (const event of protocol.results) {
  assert.equal(event.maxOutputTokens, 16);
  checkSpend(event.id, event.cost);
}
assert.equal(
  seenSpend.size,
  records.size,
  "Every reservation must have an archived request",
);
const exposureNanodollars = sum(
  spend.records,
  (record) => record.chargedNanodollars ?? record.reservedNanodollars,
);
assert.equal(exposureNanodollars, spend.exposureNanodollars);
assert(exposureNanodollars <= spend.policy.limitUSD * 1e9);
const totals = {
  requests:
    sum(cohorts, (cohort) => cohort.generations) + protocol.results.length,
  providerCostReportedUSD:
    sum(cohorts, (cohort) => cohort.providerCostReportedUSD) +
    sum(protocol.results, (event) => event.cost ?? 0),
  requestsWithoutCost: sum(cohorts, (cohort) => cohort.requestsWithoutCost),
  reservedOutputTokens:
    sum(cohorts, (cohort) => cohort.reservedOutputTokens) +
    sum(protocol.results, (event) => event.maxOutputTokens),
  inputTokensReported: sum(cohorts, (cohort) => cohort.inputTokensReported),
  outputTokensReported: sum(cohorts, (cohort) => cohort.outputTokensReported),
  campaignExposureUSD: exposureNanodollars / 1e9,
  campaignLimitUSD: spend.policy.limitUSD,
};
const summary = {
  model: "google/gemma-4-26b-a4b-it",
  excludedFromTotals:
    "initial-partial is already included in ablation; unauthenticated 401 probe generated no confirmed inference",
  limits:
    "Distinct experiments and tuned families cannot be pooled as an independent quality sample. Inventory plus review duration is an accounting projection; preparation was performed once per fixture, not once per variant. Historical negative fixtures can contain type errors; the code-regression cohort adds strict typecheck and lexical diagnosis/severity grading without regrading history.",
  totals,
  protocolOnlyRequests: protocol.results.length,
  cohorts,
};
await writeFile(
  new URL("./summary.json", import.meta.url),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      totals,
      cohorts: cohorts.map(
        ({
          name,
          passed,
          expectedReviews,
          detectedPositive,
          expectedPositive,
          passedNegative,
          expectedNegative,
          cacheHits,
        }) => ({
          name,
          passed,
          expectedReviews,
          detectedPositive,
          expectedPositive,
          passedNegative,
          expectedNegative,
          cacheHits,
        }),
      ),
    },
    null,
    2,
  ),
);
