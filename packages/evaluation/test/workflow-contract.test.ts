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
    ["evaluation-harness-comparison.yml", "harness-comparison.json"],
  ])("writes and uploads %s from the GitHub workspace", async (name, file) => {
    const source = await workflow(name);
    const absoluteReportPath = `\${{ github.workspace }}/artifacts/evaluation/${file}`;

    expect(source.split(absoluteReportPath)).toHaveLength(3);
    expect(source).toContain(`hashFiles('artifacts/evaluation/${file}') != ''`);
  });

  it("deploys and compares the exact same main revision behind protected environments", async () => {
    const source = await workflow("evaluation-harness-comparison.yml");

    expect(source).toContain("environment: harness-evaluation");
    expect(source).toContain("environment: live-evaluation");
    expect(source).toContain('--var "SOURCE_REVISION:${GITHUB_SHA}"');
    expect(source).toContain("needs: deploy-harness");
    expect(source).toContain(
      "THINK_EVALUATION_API_TOKEN: ${{ secrets.THINK_EVALUATION_API_TOKEN }}",
    );
    expect(source).toContain(
      "EVALUATION_RUN_ID: ${{ format('{0}.{1}', github.run_id, github.run_attempt) }}",
    );
  });
});
