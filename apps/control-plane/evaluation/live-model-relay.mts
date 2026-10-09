import type { IncomingMessage, ServerResponse } from "node:http";

import { runIdSchema } from "@holon/contracts";
import { z } from "zod";

import { LiveBenchmarkBudget } from "./live-benchmark-budget.js";
import { finalValidationMetadata } from "./live-final-validation.js";
import { liveBenchmarkPlan } from "./live-fixtures.js";
import { LiveModelSpend } from "./live-model-spend.js";

const requestSchema = z.looseObject({
  temperature: z.number().min(0).max(2).optional(),
  model: z.literal(liveBenchmarkPlan.route),
  stream: z.literal(true),
  max_tokens: z.number().int().positive().max(12_000),
});
export const liveModelEventSchema = z.looseObject({
  temperature: z.number().optional(),
  status: z.number().int().nonnegative(),
  inputBytes: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive().max(12_000),
  durationMs: z.number().nonnegative(),
  firstByteMs: z.number().nonnegative().optional(),
  model: z.string().optional(),
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  reasoningTokens: z.number().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  spendId: z.string().optional(),
  returnedTools: z.array(z.string()).optional(),
  finishReason: z.string().optional(),
  streamDone: z.boolean().optional(),
  providerErrorHints: z.array(z.string()).optional(),
  finalValidation: z.unknown().optional(),
  phase: z.enum(["investigation", "causal_verification"]).optional(),
  toolChoice: z.unknown().optional(),
  toolNames: z.array(z.string()).optional(),
});
interface LiveRelayOptions {
  readonly gateway: { accountId: string; gatewayId: string; token: string };
  readonly budget: LiveBenchmarkBudget;
  readonly spend: LiveModelSpend;
  readonly events: Array<z.infer<typeof liveModelEventSchema>>;
  readonly cohortId: string;
  readonly thinking: boolean;
  readonly temperature: number | null;
  readonly requestMs: number;
  readonly knownRun: (runId: string) => boolean;
  readonly persistSpend: () => Promise<void>;
  readonly checkpoint: () => Promise<void>;
}

/** Authenticated external transport, accounting and diagnostic metadata share one owner. */
export class LiveModelRelay {
  private halted = false;
  constructor(private readonly options: LiveRelayOptions) {}
  async respond(
    request: IncomingMessage,
    raw: unknown,
    response: ServerResponse,
  ) {
    const {
      gateway: config,
      budget,
      spend,
      events: modelEvents,
      cohortId,
      thinking,
      knownRun,
      persistSpend,
      checkpoint,
    } = this.options;
    const limits = { requestMs: this.options.requestMs };
    if (this.halted) {
      response
        .writeHead(503)
        .end('{"error":{"message":"BENCHMARK_TRANSPORT_HALTED"}}');
      return;
    }
    const model = requestSchema.parse(raw);
    // Experiment at the external transport seam only; production settings stay unchanged.
    const provider = z
      .looseObject({ provider: z.record(z.string(), z.unknown()).optional() })
      .parse(model).provider;
    const upstreamBody = JSON.stringify({
      ...model,
      ...(this.options.temperature !== null
        ? { temperature: this.options.temperature }
        : {}),
      ...(thinking ? { reasoning: { enabled: true } } : {}),
      provider,
    });
    const inputBytes = Buffer.byteLength(upstreamBody);
    const spendId = `${cohortId}:${modelEvents.length}`;
    if (
      !budget.admit(inputBytes, model.max_tokens, () =>
        spend.reserve(spendId, inputBytes, model.max_tokens),
      )
    ) {
      response.writeHead(429).end('{"error":{"message":"BENCHMARK_LIMIT"}}');
      return;
    }
    await persistSpend(); // Persist the worst-case reservation before any paid request.
    const event: z.infer<typeof liveModelEventSchema> = {
      ...(this.options.temperature !== null || model.temperature !== undefined
        ? { temperature: this.options.temperature ?? model.temperature }
        : {}),
      status: 0,
      inputBytes,
      maxOutputTokens: model.max_tokens,
      durationMs: 0,
      spendId,
      returnedTools: [],
      streamDone: false,
    };
    const metadataHeader = request.headers["cf-aig-metadata"];
    if (typeof metadataHeader === "string") {
      const metadata = z
        .strictObject({
          run_id: runIdSchema,
          shard_index: z.literal("0"),
          stage: z.enum(["investigation", "causal_verification"]),
        })
        .parse(JSON.parse(metadataHeader));
      if (!knownRun(metadata.run_id)) throw new Error("Unknown model run");
      event.phase = metadata.stage;
    }
    const transport = z
      .looseObject({
        tool_choice: z.unknown().optional(),
        tools: z
          .array(
            z.looseObject({ function: z.looseObject({ name: z.string() }) }),
          )
          .optional(),
      })
      .parse(raw);
    event.toolChoice = transport.tool_choice;
    event.toolNames = transport.tools?.map((item) => item.function.name) ?? [];
    modelEvents.push(event);
    const start = performance.now();
    try {
      const upstream = await fetch(
        `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}/compat/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-aig-authorization": `Bearer ${config.token}`,
            "cf-aig-skip-cache": "true",
            "cf-aig-collect-log-payload": "false",
          },
          body: upstreamBody,
          signal: AbortSignal.timeout(limits.requestMs),
        },
      );
      event.status = upstream.status;
      event.firstByteMs = performance.now() - start;
      if (!upstream.ok || !upstream.body) {
        this.halted = true;
        const errorText = await upstream.text();
        event.providerErrorHints = [
          "No endpoints",
          "tool_choice",
          "parallel_tool_calls",
          "max_price",
          "allow_fallbacks",
          "parameters",
          "schema",
          "required",
          "provider",
        ].filter((hint) => errorText.includes(hint));
        response
          .writeHead(upstream.status)
          .end('{"error":{"message":"BENCHMARK_PROVIDER_FAILED"}}');
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      const returnedArguments = new Map<
        number,
        { name: string; text: string }
      >();
      let receivedBytes = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        receivedBytes += part.value.byteLength;
        if (receivedBytes > 300_000) {
          await reader.cancel();
          throw new Error("Response too large");
        }
        response.write(part.value);
        pending += decoder.decode(part.value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop()!;
        for (const line of lines) {
          if (line === "data: [DONE]") {
            event.streamDone = true;
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          const chunk = z
            .looseObject({
              choices: z
                .array(
                  z.looseObject({
                    finish_reason: z.string().nullable().optional(),
                    delta: z
                      .looseObject({
                        tool_calls: z
                          .array(
                            z.looseObject({
                              index: z.number().int().nonnegative(),
                              function: z
                                .looseObject({
                                  name: z.string().optional(),
                                  arguments: z.string().optional(),
                                })
                                .optional(),
                            }),
                          )
                          .optional(),
                      })
                      .optional(),
                  }),
                )
                .optional(),
              model: z
                .string()
                .regex(/^[A-Za-z0-9/_.:-]{1,150}$/u)
                .optional(),
              usage: z
                .looseObject({
                  prompt_tokens: z.number().nonnegative().optional(),
                  completion_tokens: z.number().nonnegative().optional(),
                  completion_tokens_details: z
                    .looseObject({
                      reasoning_tokens: z.number().nonnegative().optional(),
                    })
                    .nullable()
                    .optional(),
                  cost: z.number().nonnegative().optional(),
                })
                .nullable()
                .optional(),
            })
            .parse(JSON.parse(line.slice(6)));
          for (const choice of chunk.choices ?? []) {
            if (choice.finish_reason)
              event.finishReason = [
                "stop",
                "length",
                "tool_calls",
                "error",
                "content_filter",
              ].includes(choice.finish_reason)
                ? choice.finish_reason
                : "other";
            for (const tool of choice.delta?.tool_calls ?? []) {
              const item = returnedArguments.get(tool.index) ?? {
                name: "",
                text: "",
              };
              item.name += tool.function?.name ?? "";
              item.text += tool.function?.arguments ?? "";
              returnedArguments.set(tool.index, item);
              if (tool.function?.name)
                event.returnedTools!.push(
                  [
                    "read_file",
                    "search_text",
                    "search_structure",
                    "think_final_answer",
                  ].includes(tool.function.name)
                    ? tool.function.name
                    : "other",
                );
            }
          }
          if (chunk.model) event.model = chunk.model;
          if (chunk.usage?.prompt_tokens !== undefined)
            event.inputTokens = chunk.usage.prompt_tokens;
          if (chunk.usage?.completion_tokens !== undefined)
            event.outputTokens = chunk.usage.completion_tokens;
          if (
            chunk.usage?.completion_tokens_details?.reasoning_tokens !==
            undefined
          )
            event.reasoningTokens =
              chunk.usage.completion_tokens_details.reasoning_tokens;
          if (chunk.usage?.cost !== undefined) event.cost = chunk.usage.cost;
        }
      }
      if (event.phase) {
        const final = [...returnedArguments.values()].find(
          (item) => item.name === "think_final_answer",
        );
        if (final)
          event.finalValidation = finalValidationMetadata(
            final.text,
            event.phase,
          );
      }
      response.end();
    } finally {
      event.durationMs = performance.now() - start;
      if (event.streamDone && event.cost !== undefined)
        spend.settle(spendId, event.cost);
      await persistSpend();
      await checkpoint();
    }
  }
}
