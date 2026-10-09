/** Fresh pair for the public-export inventory correction; labels precede inference. */
export const liveCodeRegressionFixtures = [true, false].map(
  (positive, index) => {
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
  },
);
