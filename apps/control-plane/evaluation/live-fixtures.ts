export interface LiveReviewFixture {
  readonly id: string;
  readonly family: string;
  readonly positive: boolean;
  readonly findingLine?: number;
  readonly prNumber: number;
  readonly baseProducer: string;
  readonly headProducer: string;
  readonly consumer: string;
  readonly files: Readonly<Record<string, string>>;
  readonly baseFiles?: Readonly<Record<string, string>>;
  readonly patch: string;
}

/** Synthetic repositories only. Labels are checked by executing both snapshots before any paid request. */
export const liveFixtures = [true, false]
  .flatMap((positive) => [
    {
      id: `null-consumer.${positive ? "positive" : "negative"}`,
      family: "null-consumer",
      positive,
      baseProducer:
        'export function produce(): { id: string } | null {\n  return { id: "ok" };\n}',
      headProducer:
        "export function produce(): { id: string } | null {\n  return null;\n}",
      consumer: `import { produce } from "./producer.ts";\nexport function run() {\n  const value = produce();\n${positive ? "" : '  if (value === null) return "missing";\n'}  return ${positive ? "value!" : "value"}.id;\n}`,
    },
    {
      id: `literal-contract.${positive ? "positive" : "negative"}`,
      family: "literal-contract",
      positive,
      baseProducer: 'export function delimiter() {\n  return " ";\n}',
      headProducer: `export function delimiter() {\n  return "${positive ? "  " : "\\x20"}";\n}`,
      consumer:
        'import { delimiter } from "./producer.ts";\nexport function run() {\n  const result = ["a", "b"].join(delimiter());\n  if (result !== "a b") throw new Error("WIRE_FORMAT");\n  return result;\n}',
    },
  ])
  .map((fixture, index) => ({
    ...fixture,
    prNumber: index + 1,
    files: {
      "src/producer.ts": fixture.headProducer,
      "src/consumer.ts": fixture.consumer,
      ...Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [
          `src/unrelated-${i}.ts`,
          `export function unrelated${i}(value: number) {\n  return value + ${i};\n}\n// Independent utility; no imports and no use of the changed producer.\n${"// Arithmetic utility documentation.\n".repeat(12)}`,
        ]),
      ),
    } as Readonly<Record<string, string>>,
    patch: `diff --git a/src/producer.ts b/src/producer.ts\n--- a/src/producer.ts\n+++ b/src/producer.ts\n@@ -1,3 +1,3 @@\n ${fixture.baseProducer.split("\n")[0]}\n-${fixture.baseProducer.split("\n")[1]}\n+${fixture.headProducer.split("\n")[1]}\n }`,
  }));

export const liveVariants = [
  "repeated",
  "receipts",
  "full",
  "selective",
] as const;
export type LiveVariant = (typeof liveVariants)[number];
export const liveCaseVariants = (family: string): readonly LiveVariant[] =>
  family === "null-consumer" ? liveVariants : ["repeated", "receipts"];
export const liveBenchmarkPlan = {
  date: "2026-10-08",
  route: "dynamic/pr-review",
  shardCount: 9,
  limits: {
    calls: 56,
    inputBytes: 1_500_000,
    outputTokens: 120_000,
    requestMs: 45_000,
    suiteMs: 15 * 60_000,
  },
  cases: liveFixtures.map(({ id, family, positive }) => ({
    id,
    family,
    positive,
    variants: liveCaseVariants(family),
  })),
  variants: liveVariants,
  gates: {
    receipts:
      "No case regression or incomplete positive; reduce duplicate causal tools and generation rounds on identical cases.",
    prefetch:
      "Three-way patch-only/full/selective comparison. No case regression, lower rounds and no increase in total bytes/tools without benefit.",
    weighted:
      "Observe live envelopes; no production activation without allocation-pressure and durable borrowing evidence.",
    reuse:
      "No production activation without independently established dependency closure and invalidation evidence.",
    specialists:
      "No production activation without adjudicated incremental gain at fixed total effort.",
  },
} as const;
