import { it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  generate: vi.fn(),
  provider: vi.fn().mockReturnValue(() => ({})),
}));
vi.mock("ai", () => ({
  generateText: mock.generate,
  Output: { object: (v: unknown) => v },
  stepCountIs: vi.fn(),
  APICallError: class extends Error {},
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mock.provider,
}));
import type { IdentifiedProject } from "@holon/contracts";

import { GatewayProjectIdentificationModel } from "../src/project-identification.js";
const project: IdentifiedProject = {
  id: "node:.",
  root: ".",
  ecosystem: "node",
  fingerprint: "a".repeat(64),
  status: "complete",
  facts: [],
  technologies: [],
  sourcePaths: [],
  limitations: [],
  interpretation: "deterministic",
};
it("uses bounded structured output with no automatic retries and reports usage", async () => {
  mock.provider.mockReturnValue(() => ({}));
  mock.generate.mockResolvedValue({
    output: { selectedFactIds: [] },
    usage: { inputTokens: 12, outputTokens: 5 },
  });
  const usage = vi.fn();
  const model = new GatewayProjectIdentificationModel(
    {
      accountId: "account",
      apiToken: "token",
      gatewayId: "gateway",
      model: "dynamic/review",
    },
    usage,
  );
  expect(await model.identify(project)).toEqual({ selectedFactIds: [] });
  expect(usage).toHaveBeenCalledWith(12, 5);
  expect(mock.generate).toHaveBeenCalledWith(
    expect.objectContaining({ maxRetries: 0, maxOutputTokens: 4000 }),
  );
  expect(mock.provider).toHaveBeenCalledWith(
    expect.objectContaining({
      headers: expect.objectContaining({
        "cf-aig-collect-log-payload": "false",
      }),
    }),
  );
});
it("refuses over-budget prompts before contacting the provider", async () => {
  mock.generate.mockClear();
  const p: IdentifiedProject = {
    ...project,
    facts: Array.from({ length: 500 }, (_, index) => ({
      id: `f${index}`,
      path: "package.json",
      digest: "a".repeat(64),
      selector: "dependencies.x",
      kind: "declared-exact",
      category: "library",
      condition: null,
      name: "x".repeat(200),
      value: "x".repeat(200),
    })),
  };
  const model = new GatewayProjectIdentificationModel({
    accountId: "a",
    apiToken: "t",
    gatewayId: "g",
    model: "dynamic/review",
  });
  await expect(model.identify(p)).rejects.toThrow("BUDGET");
  expect(mock.generate).not.toHaveBeenCalled();
});
it("accounts missing usage and preserves caller cancellation", async () => {
  mock.provider.mockReturnValue(() => ({}));
  mock.generate.mockResolvedValue({
    output: { selectedFactIds: [] },
    usage: {},
  });
  const usage = vi.fn(),
    signal = new AbortController().signal;
  const model = new GatewayProjectIdentificationModel(
    { accountId: "a", apiToken: "t", gatewayId: "g", model: "dynamic/review" },
    usage,
  );
  await model.identify(project, signal);
  expect(usage).toHaveBeenCalledWith(0, 0);
  expect(mock.generate).toHaveBeenCalledWith(
    expect.objectContaining({ abortSignal: signal }),
  );
});
