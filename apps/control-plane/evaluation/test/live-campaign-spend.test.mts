import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { it } from "node:test";

import { openModelCampaign } from "../live-campaign-spend.mjs";
import { LiveModelSpend } from "../live-model-spend.js";

async function withFiles(
  test: (files: { spendPath: string; seedPath: string }) => Promise<void>,
) {
  const directory = await mkdtemp(resolve(tmpdir(), "holon-spend-test-"));
  try {
    await test({
      spendPath: resolve(directory, "spend.json"),
      seedPath: resolve(directory, "seed.json"),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await it("seeds conservatively, persists reservations and prevents another process from owning the same campaign", async () => {
  await withFiles(async ({ spendPath, seedPath }) => {
    const initial = new LiveModelSpend([
      { id: "uncertain-previous-request", reservedNanodollars: 490_000_000 },
    ]);
    await writeFile(seedPath, JSON.stringify(initial.snapshot()));
    {
      await using campaign = await openModelCampaign(spendPath, seedPath);
      assert.equal(campaign.spend.snapshot().exposureNanodollars, 490_000_000);
      await assert.rejects(openModelCampaign(spendPath, seedPath), {
        code: "EEXIST",
      });
      assert.equal(campaign.spend.reserve("accepted", 1, 1), true);
      await campaign.persistSpend();
      assert.equal(campaign.spend.reserve("over-limit", 100_000, 1), false);
      const saved = JSON.parse(await readFile(spendPath, "utf8"));
      assert.equal(saved.records.length, 2);
    }
    await using reopened = await openModelCampaign(spendPath, seedPath);
    assert.equal(reopened.spend.snapshot().records.length, 2);
    assert.equal(reopened.spend.reserve("accepted", 1, 1), false);
    assert.equal(reopened.spend.reserve("over-limit", 100_000, 1), false);
  });
});

await it("fails closed on corrupt checkpoints without replacing them with the seed and releases its own lock", async () => {
  await withFiles(async ({ spendPath, seedPath }) => {
    await writeFile(
      seedPath,
      JSON.stringify(new LiveModelSpend([]).snapshot()),
    );
    await writeFile(spendPath, "invalid checkpoint");
    await assert.rejects(openModelCampaign(spendPath, seedPath), SyntaxError);
    assert.equal(await readFile(spendPath, "utf8"), "invalid checkpoint");
    await writeFile(
      spendPath,
      JSON.stringify(new LiveModelSpend([]).snapshot()),
    );
    await using campaign = await openModelCampaign(spendPath, seedPath);
    assert.equal(campaign.spend.snapshot().records.length, 0);
  });
});

await it("refuses missing seeds, changed policies and unreconciled totals instead of starting from zero", async () => {
  await withFiles(async ({ spendPath, seedPath }) => {
    await assert.rejects(openModelCampaign(spendPath, seedPath), {
      code: "ENOENT",
    });
    const seed = new LiveModelSpend([
      { id: "known", reservedNanodollars: 1_000_000 },
    ]).snapshot();
    await writeFile(
      seedPath,
      JSON.stringify({ ...seed, policy: { ...seed.policy, limitUSD: 1 } }),
    );
    await assert.rejects(
      openModelCampaign(spendPath, seedPath),
      /price policy changed/u,
    );
    await writeFile(
      seedPath,
      JSON.stringify({ ...seed, exposureNanodollars: 0 }),
    );
    await assert.rejects(
      openModelCampaign(spendPath, seedPath),
      /totals disagree/u,
    );
    await writeFile(seedPath, JSON.stringify(seed));
    await using campaign = await openModelCampaign(spendPath, seedPath);
    assert.equal(campaign.spend.snapshot().exposureNanodollars, 1_000_000);
  });
});
