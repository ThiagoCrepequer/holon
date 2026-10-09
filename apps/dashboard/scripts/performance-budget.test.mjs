const route = () => ({
  cold: { p95: 0 },
  warm: { p95: 0 },
  lcp_p75: 0,
  cls_p75: 0,
  maxDOM: 0,
});
const interactions = () => ({
  filter: { p95: 0 },
  refresh: { p95: 0 },
  inp: 0,
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import {
  assertBrowserBudget,
  browserBudget,
  assertAssetBudget,
  assetBudget,
  measureAssets,
  percentile,
} from "./performance-budget.mjs";
void test("actual asset bytes distinguish transport compression from already compressed fonts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "holon-budget-"));
  try {
    await writeFile(join(dir, "entry.js"), "export const data = 1;");
    await writeFile(join(dir, "style.css"), "body {color:red}");
    await writeFile(join(dir, "font.woff"), Buffer.alloc(100));
    await writeFile(join(dir, "favicon.svg"), "<svg/>");
    await mkdir(join(dir, "ignored"));
    const result = await measureAssets(dir);
    assert.deepEqual(result.measured, {
      js: gzipSync("export const data = 1;").length,
      css: gzipSync("body {color:red}").length,
      fonts: 100,
    });
    assert.equal(Object.keys(result.assets).length, 3);
    assertAssetBudget(result.measured);
  } finally {
    await rm(dir, { recursive: true });
  }
});
void test("all budgets reject independent bloat and invalid/missing measurements", () => {
  for (const kind of Object.keys(assetBudget)) {
    assertAssetBudget({ ...assetBudget });
    assert.throws(
      () =>
        assertAssetBudget({ ...assetBudget, [kind]: assetBudget[kind] + 1 }),
      /budget_exceeded/,
    );
    for (const invalid of [undefined, -1, NaN, 0.5])
      assert.throws(
        () => assertAssetBudget({ ...assetBudget, [kind]: invalid }),
        /invalid_/,
      );
  }
});
void test("latency samples remain honest, unordered and have a nearest-rank p50/p95", () => {
  const samples = [4, 1, 5, 2, 3];
  assert.equal(percentile(samples, 0.5), 3);
  assert.equal(percentile(samples, 0.95), 5);
  assert.deepEqual(samples, [4, 1, 5, 2, 3]);
  for (const invalid of [[], [NaN], [-1]])
    assert.throws(() => percentile(invalid, 0.5), /invalid_latency_sample/);
  for (const invalid of [0, 2])
    assert.throws(() => percentile([1], invalid), /invalid_percentile/);
});

void test("browser ceilings fail independently for latency, DOM and native vitals; missing measurements cannot pass", () => {
  assertBrowserBudget(route(), interactions());
  const mutations = {
    ssr: (r, i, v) => (r.warm.p95 = v),
    cold: (r, i, v) => (r.cold.p95 = v),
    interaction: (r, i, v) => (i.refresh.p95 = v),
    filter: (r, i, v) => (i.filter.p95 = v),
    lcp: (r, i, v) => (r.lcp_p75 = v),
    cls: (r, i, v) => (r.cls_p75 = v),
    inp: (r, i, v) => (i.inp = v),
    dom: (r, i, v) => (r.maxDOM = v),
  };
  for (const [kind, mutate] of Object.entries(mutations))
    for (const value of [
      browserBudget[
        kind === "cold" ? "ssr" : kind === "filter" ? "interaction" : kind
      ] + 1,
      NaN,
      undefined,
      -1,
    ]) {
      const r = route(),
        i = interactions();
      mutate(r, i, value);
      assert.throws(() => assertBrowserBudget(r, i));
    }
});
