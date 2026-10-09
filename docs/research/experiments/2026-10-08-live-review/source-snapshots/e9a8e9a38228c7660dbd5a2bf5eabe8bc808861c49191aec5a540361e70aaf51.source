/** Predeclared fresh families: never use their model answers to tune a candidate. */
export const liveHoldoutFixtures = [true, false]
  .flatMap((positive) => [
    {
      id: `cycle-index.${positive ? "positive" : "negative"}`,
      family: "cycle-index",
      positive,
      baseProducer:
        "export function next(index: number, size: number) {\n  return (index + 1) % size;\n}",
      headProducer:
        "export function next(index: number, size: number) {\n  return index + 1;\n}",
      consumer: `import { next } from "./producer.ts";\nexport function run() {\n  const values = ["a", "b"];\n  const index = next(1, values.length)${positive ? "" : " % values.length"};\n  const value = values[index];\n  if (value === undefined) throw new Error("INVALID_CYCLE_INDEX");\n  return value;\n}`,
    },
    {
      id: `caller-mutation.${positive ? "positive" : "negative"}`,
      family: "caller-mutation",
      positive,
      baseProducer:
        "export function normalize(values: string[]) {\n  return [...values].sort();\n}",
      headProducer:
        "export function normalize(values: string[]) {\n  return values.sort();\n}",
      consumer: `import { normalize } from "./producer.ts";\nexport function run() {\n  const original = ["b", "a"];\n  const normalized = normalize(${positive ? "original" : "[...original]"});\n  if (original.join(",") !== "b,a") throw new Error("CALLER_MUTATED");\n  return normalized;\n}`,
    },
  ])
  .map((fixture, index) => ({
    ...fixture,
    prNumber: index + 5,
    files: {
      "src/producer.ts": fixture.headProducer,
      "src/consumer.ts": fixture.consumer,
      ...Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [
          `src/unrelated-${i}.ts`,
          `export function unrelated${i}(value: number) { return value + ${i}; }`,
        ]),
      ),
    } as Readonly<Record<string, string>>,
    patch: `diff --git a/src/producer.ts b/src/producer.ts\n--- a/src/producer.ts\n+++ b/src/producer.ts\n@@ -1,3 +1,3 @@\n ${fixture.baseProducer.split("\n")[0]}\n-${fixture.baseProducer.split("\n")[1]}\n+${fixture.headProducer.split("\n")[1]}\n }`,
  }));
