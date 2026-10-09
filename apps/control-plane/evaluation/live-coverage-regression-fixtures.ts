/** Labels and coordinates declared before inference; base/head are executable. */
export const liveCoverageRegressionFixtures = [true, false].map(
  (positive, index) => {
    const prefix =
      "function produce(): { id: string } | null {\n" +
      "  // Unchanged body padding.\n".repeat(35);
    const baseProducer =
      prefix + '  return { id: "ok" };\n}\nexport { produce as payload };\n';
    const declarations = Array.from(
      { length: 129 },
      (_, number) => `export const constant${number} = ${number};`,
    );
    const headProducer =
      prefix +
      "  return null;\n}\nexport { produce as payload };\n" +
      declarations.join("\n") +
      "\n";
    const baseConsumer = `import { payload } from "./producer.ts";\nexport function run() {\n  const value = payload();\n${positive ? "" : '  if (value === null) return "missing";\n'}  return ${positive ? "value!" : "value"}.id;\n}\n`;
    const consumer = baseConsumer.replace(
      "\nexport function",
      "\n// Caller documentation updated.\nexport function",
    );
    return {
      id: `coverage-consumer.${positive ? "positive" : "negative"}`,
      family: "aliased-consumer",
      positive,
      findingLine: 37,
      prNumber: 15 + index,
      baseProducer,
      headProducer,
      consumer,
      baseFiles: {
        "src/producer.ts": baseProducer,
        "src/consumer.ts": baseConsumer,
      },
      files: { "src/producer.ts": headProducer, "src/consumer.ts": consumer },
      patch:
        'diff --git a/src/producer.ts b/src/producer.ts\n--- a/src/producer.ts\n+++ b/src/producer.ts\n@@ -37,3 +37,132 @@\n-  return { id: "ok" };\n+  return null;\n }\n export { produce as payload };\n' +
        declarations.map((line) => "+" + line).join("\n") +
        "\ndiff --git a/src/consumer.ts b/src/consumer.ts\n--- a/src/consumer.ts\n+++ b/src/consumer.ts\n@@ -1,0 +2,1 @@\n+// Caller documentation updated.\n",
    };
  },
);
