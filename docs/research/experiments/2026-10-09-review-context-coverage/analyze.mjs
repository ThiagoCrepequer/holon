import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";

import { unpackEvidence } from "../../../../tooling/evidence/archive.mjs";

const json = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const sum = (items, select) =>
  items.reduce((total, item) => total + select(item), 0);
const files = unpackEvidence(
  await json("./evidence-manifest.json"),
  await readFile(new URL("./evidence.json.gz", import.meta.url)),
);
if (process.argv[2] === "--read") {
  const bytes = files.get(process.argv[3]);
  assert(bytes, "Unknown evidence path");
  process.stdout.write(bytes);
} else {
  assert.equal(process.argv.length, 2);
  const seed = await json("./campaign-spend.json");
  const historical = await json(
    "../2026-10-08-live-review/campaign-spend.json",
  );
  assert.deepEqual(seed.policy, historical.policy);
  const records = new Map(seed.records.map((record) => [record.id, record]));
  assert.equal(records.size, seed.records.length);
  for (const record of historical.records)
    assert.deepEqual(records.get(record.id), record);
  const seen = new Set(historical.records.map((record) => record.id));
  const cohorts = [];
  for (const name of [...files.keys()]
    .filter((path) => /^live-[^/]+\/results\.json$/u.test(path))
    .map((path) => path.split("/")[0])
    .toSorted((left, right) => left.localeCompare(right))) {
    const result = JSON.parse(files.get(`${name}/results.json`));
    const plan = JSON.parse(files.get(`${name}/plan.json`));
    assert.deepEqual(result.configuration, plan);
    assert.equal(plan.tracePayloads, false);
    assert.equal(plan.cacheBypassed, true);
    for (const [path, hash] of Object.entries(plan.sourceDigests)) {
      const source = files.get(
        `${name}/sources/${posix.normalize(posix.join("apps/control-plane", path))}.source`,
      );
      assert(source, `Missing source: ${name}/${path}`);
      assert.equal(createHash("sha256").update(source).digest("hex"), hash);
    }
    assert.equal(result.budget.calls, result.modelEvents.length);
    assert.equal(
      result.budget.inputBytes,
      sum(result.modelEvents, (event) => event.inputBytes),
    );
    assert.equal(
      result.budget.reservedOutputTokens,
      sum(result.modelEvents, (event) => event.maxOutputTokens),
    );
    assert(result.budget.calls <= plan.limits.calls);
    assert(result.budget.inputBytes <= plan.limits.inputBytes);
    assert(result.budget.reservedOutputTokens <= plan.limits.outputTokens);
    assert.equal(
      new Set(result.results.map((item) => item.caseId)).size,
      result.results.length,
    );
    if (result.modelEvents.length) {
      assert.deepEqual(
        result.results.map((item) => item.caseId),
        plan.cases.map((item) => item.id),
      );
      for (const oracle of plan.oracles) {
        assert(oracle.baseTypecheck.passed && oracle.headTypecheck.passed);
        assert(
          oracle.base.executed && !oracle.base.failed && oracle.head.executed,
        );
        assert.equal(
          oracle.head.failed,
          plan.cases.find((item) => item.id === oracle.caseId).positive,
        );
      }
    }
    for (const event of result.modelEvents) {
      assert.equal(event.status, 200);
      assert(!seen.has(event.spendId));
      seen.add(event.spendId);
      assert.equal(
        records.get(event.spendId)?.chargedNanodollars,
        Math.ceil((event.cost * 1e9 * seed.policy.marginPercent) / 100),
      );
    }
    cohorts.push({
      name,
      requests: result.modelEvents.length,
      passed: result.results.filter((item) => item.passed).length,
      executedCases: result.results.length,
      costReportedUSD: sum(result.modelEvents, (event) => event.cost),
      inputTokens: sum(result.modelEvents, (event) => event.inputTokens),
      outputTokens: sum(result.modelEvents, (event) => event.outputTokens),
      denied: result.budget.denied,
      campaignExposureUSD: result.campaignExposureUSD,
    });
  }
  assert.equal(seen.size, records.size, "Unaccounted reservation");
  assert.equal(
    seed.exposureNanodollars,
    sum(
      seed.records,
      (record) => record.chargedNanodollars ?? record.reservedNanodollars,
    ),
  );
  assert(seed.exposureNanodollars <= seed.policy.limitUSD * 1e9);
  const summary = {
    cohorts,
    newRequests: sum(cohorts, (item) => item.requests),
    newCostReportedUSD: sum(cohorts, (item) => item.costReportedUSD),
    campaignRequests: records.size,
    campaignExposureUSD: seed.exposureNanodollars / 1e9,
    campaignLimitUSD: seed.policy.limitUSD,
  };
  assert.deepEqual(summary, JSON.parse(files.get("summary.json")));
  const replay = await json("./context-budget-replay.json");
  assert.equal(replay.baseSha, "929ed5b8eaed671f7c6d5da3e8cdb1a117ba5ce0");
  assert.equal(replay.headSha, "0dcf243be6f8f1a6c8135b01e7285c5f247bce56");
  assert.equal(replay.beforeEngineCommit, replay.headSha);
  assert.equal(
    replay.replayScriptDigest,
    createHash("sha256")
      .update(
        await readFile(new URL("./context-budget-replay.mts", import.meta.url)),
      )
      .digest("hex"),
  );
  for (const digest of Object.values(replay.sourceDigests))
    assert.match(digest, /^[a-f0-9]{64}$/u);
  for (const key of [
    "files",
    "bytes",
    "symbols",
    "allSymbols",
    "references",
    "totalRefs",
  ])
    assert.equal(replay.before[key], replay.after[key]);
  assert.equal(replay.before.plan.shards, 13);
  assert.equal(replay.after.plan.shards, 11);
  assert.equal(
    sum(replay.before.projection, (part) => part.omitted),
    56,
  );
  assert.equal(
    sum(replay.after.projection, (part) => part.omitted),
    0,
  );
  assert.equal(replay.after.projection.length, replay.after.plan.shards);
  assert(replay.after.projection.every((part) => part.bytes <= 24000));
  assert.deepEqual(replay.after.plan.omissions, [
    { code: "structural_inventory", count: 0, repositoryScanTruncated: true },
  ]);
  console.log(JSON.stringify(summary, null, 2));
}
