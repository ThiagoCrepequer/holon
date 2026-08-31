import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function workflow(name: string): Promise<string> {
  return await readFile(
    new URL(`../../../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );
}

describe("evaluation workflow artifact contract", () => {
  it.each([
    ["evaluation-live.yml", "live-model.json"],
    ["evaluation-offline.yml", "recorded-output.json"],
  ])("writes and uploads %s from the GitHub workspace", async (name, file) => {
    const source = await workflow(name);
    const absoluteReportPath = `\${{ github.workspace }}/artifacts/evaluation/${file}`;

    expect(source.split(absoluteReportPath)).toHaveLength(3);
    expect(source).toContain(`hashFiles('artifacts/evaluation/${file}') != ''`);
  });
});
