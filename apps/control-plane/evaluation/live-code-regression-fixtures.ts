/** Fresh pair for the public-export inventory correction; labels precede inference. */
const aliasedConsumerFixtures = [true, false].map((positive, index) => {
  const baseProducer =
    'function produce(): { id: string } | null {\n  return { id: "ok" };\n}\nexport { produce as payload };';
  const headProducer =
    "function produce(): { id: string } | null {\n  return null;\n}\nexport { produce as payload };";
  const consumer = `import { payload } from "./producer.ts";\nexport function run() {\n  const value = payload();\n${positive ? "" : '  if (value === null) return "missing";\n'}  return ${positive ? "value!" : "value"}.id;\n}`;
  return {
    id: `aliased-consumer.${positive ? "positive" : "negative"}`,
    family: "aliased-consumer",
    positive,
    prNumber: 13 + index,
    baseProducer,
    headProducer,
    consumer,
    files: {
      "src/producer.ts": headProducer,
      "src/consumer.ts": consumer,
    },
    patch: `diff --git a/src/producer.ts b/src/producer.ts\n--- a/src/producer.ts\n+++ b/src/producer.ts\n@@ -1,4 +1,4 @@\n ${baseProducer.split("\n")[0]}\n-${baseProducer.split("\n")[1]}\n+${headProducer.split("\n")[1]}\n }\n export { produce as payload };`,
  };
});

/** Paired value export: a moved implementation is safe only with its runtime API preserved. */
const movedExportFixtures = [true, false].map((positive, index) => {
  const baseProducer = "export const runIdSchema = (value: string) => value;";
  const headProducer = `export ${positive ? "type " : ""}{ runIdSchema } from "./run-id.ts";`;
  const consumer = [
    'import * as producer from "./producer.ts";',
    "export function run() {",
    '  if (!("runIdSchema" in producer)) throw new Error("MISSING_RUNTIME_EXPORT");',
    "  const parse = producer.runIdSchema;",
    '  if (typeof parse !== "function") throw new Error("INVALID_RUNTIME_EXPORT");',
    '  return parse("valid-run");',
    "}",
  ].join("\n");
  return {
    id: `moved-export.${positive ? "positive" : "negative"}`,
    family: "moved-export",
    positive,
    prNumber: 73 + index,
    baseProducer,
    headProducer,
    consumer,
    files: {
      "src/producer.ts": headProducer,
      "src/run-id.ts": baseProducer,
      "src/consumer.ts": consumer,
    },
    patch: `diff --git a/src/producer.ts b/src/producer.ts\n--- a/src/producer.ts\n+++ b/src/producer.ts\n@@ -1 +1 @@\n-${baseProducer}\n+${headProducer}`,
  };
});

export const liveCodeRegressionFixtures = [
  ...aliasedConsumerFixtures,
  ...movedExportFixtures,
];
