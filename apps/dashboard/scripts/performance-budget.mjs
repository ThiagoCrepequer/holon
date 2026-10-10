import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

// M7: Base UI menus authorized on 2026-10-10; whole-build gzip still bounds every route.
export const assetBudget = Object.freeze({
  js: 240_000,
  css: 12_000,
  fonts: 160_000,
});
export function assertAssetBudget(measured) {
  for (const [kind, limit] of Object.entries(assetBudget)) {
    assert(
      Number.isSafeInteger(measured[kind]) && measured[kind] >= 0,
      `invalid_${kind}_measurement`,
    );
    assert(
      measured[kind] <= limit,
      `${kind}_budget_exceeded:${measured[kind]}/${limit}`,
    );
  }
}
export async function measureAssets(directory) {
  const measured = { js: 0, css: 0, fonts: 0 };
  const assets = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const kind = entry.name.endsWith(".js")
      ? "js"
      : entry.name.endsWith(".css")
        ? "css"
        : entry.name.endsWith(".woff")
          ? "fonts"
          : null;
    if (!kind) continue;
    const bytes = await readFile(`${directory}/${entry.name}`);
    const size = kind === "fonts" ? bytes.length : gzipSync(bytes).length;
    measured[kind] += size;
    assets[`/assets/${entry.name}`] = { kind, bytes: size };
  }
  return { measured, assets };
}
export function percentile(samples, fraction) {
  assert(
    samples.length > 0 &&
      samples.every((value) => Number.isFinite(value) && value >= 0),
    "invalid_latency_sample",
  );
  assert(fraction > 0 && fraction <= 1, "invalid_percentile");
  return samples.toSorted((a, b) => a - b)[
    Math.ceil(samples.length * fraction) - 1
  ];
}

// Chromium local lab: CPU 4x, loopback, five cold/warm samples, 200 long findings.
// CI ceilings retain headroom over the measured baseline, without claiming field CWV.
export const browserBudget = Object.freeze({
  ssr: 1500,
  interaction: 500,
  lcp: 2500,
  cls: 0.1,
  inp: 200,
  dom: 1200,
});
export function assertBrowserBudget(route, interactions) {
  assert(
    [route.cold.p95, route.warm.p95].every(
      (value) => Number.isFinite(value) && value >= 0,
    ),
    "invalid_ssr_measurement",
  );
  assert(
    [interactions.filter.p95, interactions.refresh.p95].every(
      (value) => Number.isFinite(value) && value >= 0,
    ),
    "invalid_interaction_measurement",
  );
  const measurements = {
    ssr: Math.max(route.cold.p95, route.warm.p95),
    interaction: Math.max(interactions.filter.p95, interactions.refresh.p95),
    lcp: route.lcp_p75,
    cls: route.cls_p75,
    inp: interactions.inp,
    dom: route.maxDOM,
  };
  for (const [kind, limit] of Object.entries(browserBudget)) {
    assert(
      Number.isFinite(measurements[kind]) && measurements[kind] >= 0,
      `invalid_${kind}_measurement`,
    );
    assert(
      measurements[kind] <= limit,
      `${kind}_budget_exceeded:${measurements[kind]}/${limit}`,
    );
  }
}
