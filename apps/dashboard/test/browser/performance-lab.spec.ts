import { readFile, writeFile, mkdir } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";

import { expect, test } from "@playwright/test";

import {
  assertBrowserBudget,
  measureAssets,
  percentile,
} from "../../scripts/performance-budget.mjs";
import { signIn } from "../support/browser-journey.js";

test("fixed Chromium browser lab: route bytes, cold/warm SSR, filters, refresh and 200 findings", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "CDP lab is Chromium only; the functional matrix covers all engines.",
  );
  // This new profiling scenario has an explicit wall-clock budget; no retries mask its first result.
  test.setTimeout(120_000);
  const sdk = await readFile(
    "node_modules/web-vitals/dist/web-vitals.iife.js",
    "utf8",
  );
  const instrumentation =
    sdk +
    `;window.holonLab={cls:0,lcp:0,inp:null};for(const [name,key] of [['onCLS','cls'],['onLCP','lcp'],['onINP','inp']])webVitals[name](metric=>{window.holonLab[key]=metric.value},{reportAllChanges:true});`;
  const subject = 303001,
    workspace = await signIn(page, subject);
  expect(
    (
      await page.request.post("/__test/reviews/seed", {
        data: { subject, count: 2, findingCount: 200 },
      })
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/__test/reviews/proof?subject=${subject}`)
          ).json()
        ).completed,
    )
    .toBe(2);
  const state = await page.context().storageState();
  const scope = `workspace=${workspace}&installation=${subject + 100000}&repository=${subject + 200000}&lang=en`;
  const { assets, measured } = await measureAssets("build/client/assets");
  const routes = {
    welcome: "/?lang=en",
    account: "/account?lang=en",
    list: `/reviews?${scope}`,
    detail: `/reviews/detail?${scope}&pullRequest=1`,
  };
  const results: Record<
    string,
    {
      cold: { p50: number; p95: number };
      warm: { p50: number; p95: number };
      lcp_p75: number;
      cls_p75: number;
      maxDOM: number;
      [key: string]: unknown;
    }
  > = {};
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 320, height: 720 },
  ])
    for (const [name, path] of Object.entries(routes)) {
      const cold: number[] = [],
        warm: number[] = [],
        cls: number[] = [],
        lcp: number[] = [],
        dom: number[] = [],
        ttfb: number[] = [],
        loaded = new Set<string>();
      for (let sample = 0; sample < 5; sample++) {
        const context = await browser.newContext({
          storageState: state,
          ignoreHTTPSErrors: true,
          viewport,
          extraHTTPHeaders: { "X-Holon-Test-Client": String(subject) },
        });
        const view = await context.newPage(),
          cdp = await context.newCDPSession(view);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        // Loopback network, no network shaping. Server CPU and remote region are not emulated.
        view.on("request", (request) => {
          const assetPath = new URL(request.url()).pathname;
          if (assets[assetPath]) loaded.add(assetPath);
        });
        await view.addInitScript({ content: instrumentation });
        for (const phase of ["cold", "warm"]) {
          const start = Date.now();
          await view.goto(`https://127.0.0.1:8795${path}`);
          await expect(view.getByRole("heading", { level: 1 })).toBeVisible();
          if (name === "detail")
            await expect(view.locator('li[id^="finding-"]')).toHaveCount(10);
          await view.waitForLoadState("load");
          await view.evaluate(() => document.fonts.ready);
          (phase === "cold" ? cold : warm).push(Date.now() - start);
          await expect
            .poll(() =>
              view.evaluate(
                () =>
                  (window as typeof window & { holonLab: { lcp: number } })
                    .holonLab.lcp,
              ),
            )
            .toBeGreaterThan(0);
          const metrics = await view.evaluate(() => ({
            stats: (
              window as typeof window & {
                holonLab: { cls: number; lcp: number };
              }
            ).holonLab,
            dom: document.getElementsByTagName("*").length,
          }));
          cls.push(metrics.stats.cls);
          lcp.push(metrics.stats.lcp);
          dom.push(metrics.dom);
          const timing = await view.evaluate(() => {
            const n = performance.getEntriesByType(
              "navigation",
            )[0] as PerformanceNavigationTiming;
            return n.responseStart - n.requestStart;
          });
          ttfb.push(timing);
        }
        await context.close();
      }
      const bytes = { js: 0, css: 0, fonts: 0 };
      for (const assetPath of loaded) {
        const asset = assets[assetPath]!;
        bytes[asset.kind] += asset.bytes;
      }
      results[`${viewport.width}:${name}`] = {
        samples: 5,
        bytes,
        cold: { p50: percentile(cold, 0.5), p95: percentile(cold, 0.95) },
        warm: { p50: percentile(warm, 0.5), p95: percentile(warm, 0.95) },
        ttfb: { p50: percentile(ttfb, 0.5), p95: percentile(ttfb, 0.95) },
        lcp_p75: percentile(lcp, 0.75),
        cls_p75: percentile(cls, 0.75),
        maxDOM: Math.max(...dom),
      };
    }
  await page.addInitScript({ content: instrumentation });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(`/reviews?${scope}`);
  const filter: number[] = [],
    refresh: number[] = [];
  for (let sample = 0; sample < 5; sample++) {
    await page
      .getByLabel("Search title or PR number")
      .fill(String((sample % 2) + 1));
    const filtering = page.waitForResponse((response) =>
      response.url().includes("/api/reviews/list"),
    );
    let start = Date.now();
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    expect((await filtering).status()).toBe(200);
    await expect(
      page.getByRole("link", {
        name: `#${(sample % 2) + 1} · Synthetic revisão ${(sample % 2) + 1}`,
      }),
    ).toBeVisible();
    filter.push(Date.now() - start);
    const refreshing = page.waitForResponse((response) =>
      response.url().includes("/api/reviews/list"),
    );
    start = Date.now();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    expect((await refreshing).status()).toBe(200);
    await expect(page.getByRole("status")).toHaveCount(0);
    refresh.push(Date.now() - start);
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { holonLab: { inp: number | null } })
            .holonLab.inp,
      ),
    )
    .not.toBeNull();
  const inp = await page.evaluate(
    () =>
      (window as typeof window & { holonLab: { inp: number } }).holonLab.inp,
  );
  const report = {
    kind: "local-browser-lab",
    date: new Date().toISOString(),
    browser: browser.version(),
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    cpuThrottle: 4,
    network: "unshaped-loopback",
    viewports: [
      [1280, 800],
      [320, 720],
    ],
    remoteRegion: null,
    build: measured,
    routes: results,
    filter: { p50: percentile(filter, 0.5), p95: percentile(filter, 0.95) },
    refresh: { p50: percentile(refresh, 0.5), p95: percentile(refresh, 0.95) },
    inp,
  };
  await mkdir("proof-results", { recursive: true });
  await writeFile(
    "proof-results/performance-lab.json",
    JSON.stringify(report, null, 2),
  );
  await info.attach("performance-lab", {
    body: JSON.stringify(report),
    contentType: "application/json",
  });
  for (const route of Object.values(results))
    assertBrowserBudget(route, report);
});
