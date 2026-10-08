import { expect, it, vi } from "vitest";

import {
  createGatewayLanguageModel,
  createGatewayProviderSettings,
  createRepositoryModelTools,
  isNonRetryableModelError,
  isNonRetryableModelProviderError,
  ModelProviderRequestError,
  nonRetryableModelFailureCode,
  parseGatewayModelReference,
} from "../src/gateway.js";

const config = {
  accountId: "account id",
  apiToken: "token",
  gatewayId: "gateway/id",
  model: "dynamic/pr-review",
};

it("builds a bounded dynamic Gateway route with private payload collection", () => {
  const settings = createGatewayProviderSettings({
    ...config,
    metadata: { run_id: "r1" },
  });
  expect(settings.baseURL).toContain("account%20id/gateway%2Fid/compat");
  expect(settings.headers).toMatchObject({
    "cf-aig-collect-log-payload": "false",
    "cf-aig-metadata": '{"run_id":"r1"}',
    "cf-aig-skip-cache": "true",
  });
  expect(createGatewayLanguageModel(config).modelId).toBe("dynamic/pr-review");
  expect(parseGatewayModelReference("dynamic/test-model").modelId).toBe(
    "dynamic/test-model",
  );
  for (const invalid of [
    "openrouter/free",
    "dynamic/",
    "dynamic/../secrets",
    `dynamic/${"a".repeat(260)}`,
  ])
    expect(() => parseGatewayModelReference(invalid)).toThrow();
});

it("classifies permanent provider failures without treating transient or unknown errors as permanent", () => {
  const permanent = new ModelProviderRequestError(false, 401);
  const transient = new ModelProviderRequestError(true, 503);
  expect(permanent.name).toBe("ModelPermanentError");
  expect(transient.name).toBe("ModelTransientError");
  expect(isNonRetryableModelProviderError(permanent)).toBe(true);
  expect(isNonRetryableModelProviderError(transient)).toBe(false);
  expect(
    isNonRetryableModelProviderError(new Error("HOLON_MODEL_PERMANENT:403")),
  ).toBe(true);
  expect(isNonRetryableModelProviderError("not an error")).toBe(false);
  expect(nonRetryableModelFailureCode(permanent)).toBe("provider_permanent");
  expect(
    nonRetryableModelFailureCode(
      Object.assign(new Error("schema"), { name: "ZodError" }),
    ),
  ).toBe("schema_invalid");
  expect(nonRetryableModelFailureCode(new Error("unknown"))).toBeUndefined();
  expect(isNonRetryableModelError(permanent)).toBe(true);
  expect(isNonRetryableModelError(transient)).toBe(false);
});

it("forwards only the three read-only repository tools with abort and deadline context", async () => {
  const run = vi.fn(async () => ({ content: "safe", truncated: false }));
  const tools = createRepositoryModelTools({ run }, () => 123);
  expect(Object.keys(tools)).toEqual([
    "read_file",
    "search_structure",
    "search_text",
  ]);
  const signal = new AbortController().signal;
  for (const [name, args] of [
    ["read_file", { path: "src/index.ts" }],
    ["search_structure", { pattern: "foo($A)" }],
    ["search_text", { query: "foo" }],
  ] as const) {
    const execute = tools[name].execute as unknown as (
      input: unknown,
      options: unknown,
    ) => Promise<unknown>;
    await expect(execute(args, { abortSignal: signal })).resolves.toMatchObject(
      { content: "safe" },
    );
    expect(run).toHaveBeenLastCalledWith(
      { name, arguments: args },
      { abortSignal: signal, deadlineAt: 123 },
    );
  }
  const noDeadline = createRepositoryModelTools({ run });
  const execute = noDeadline.read_file.execute as unknown as (
    input: unknown,
    options: unknown,
  ) => Promise<unknown>;
  await execute({ path: "src/index.ts" }, {});
  expect(run).toHaveBeenLastCalledWith(
    { name: "read_file", arguments: { path: "src/index.ts" } },
    { abortSignal: undefined, deadlineAt: undefined },
  );
});

it("enforces strict provider parameters, reasoning disabled, and stream usage in Gateway settings", () => {
  const settings = createGatewayProviderSettings(config);
  expect(settings.includeUsage).toBe(true);
  expect(settings.transformRequestBody).toBeDefined();
  const transform = settings.transformRequestBody;
  if (!transform) throw new Error("Gateway request transform is missing");

  const baseBody = {
    messages: [{ role: "user", content: "hello" }],
    model: "dynamic/pr-review",
  };
  const transformed = transform(baseBody);
  expect(transformed).toMatchObject({
    model: "dynamic/pr-review",
    provider: { require_parameters: true },
    reasoning: { enabled: false },
  });

  const customBody = {
    ...baseBody,
    provider: { sort: "throughput" },
    reasoning: { effort: "high", max_tokens: 100 },
  };
  const transformedCustom = transform(customBody);
  expect(transformedCustom).toMatchObject({
    provider: { require_parameters: true, sort: "throughput" },
    reasoning: { enabled: false },
  });
  expect(transformedCustom.reasoning).toEqual({ enabled: false });
});

it("serializes require_parameters, reasoning off, and include_usage into actual streaming requests", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (typeof init?.body !== "string")
      throw new TypeError("Expected a serialized Gateway request");
    capturedBody = JSON.parse(init.body);
    return new Response(
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      },
    );
  });

  vi.stubGlobal("fetch", mockFetch);
  try {
    const model = createGatewayLanguageModel(config);
    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    await result.stream.cancel();

    expect(capturedBody).toBeDefined();
    expect(capturedBody).toMatchObject({
      provider: { require_parameters: true },
      reasoning: { enabled: false },
      stream: true,
      stream_options: { include_usage: true },
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
