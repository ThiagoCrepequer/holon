import type { TestExecutionReport, TestFailure } from "@holon/domain";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const number = (value: unknown): number => {
  const valueNumber = Number(value ?? 0);
  if (!Number.isFinite(valueNumber) || valueNumber < 0)
    throw new Error("Invalid JUnit count");
  return valueNumber;
};

/** DTDs are rejected; the XML parser decodes only ordinary XML text/entities. */
export function parseJUnitXml(xmlContent: string): TestExecutionReport {
  if (
    new TextEncoder().encode(xmlContent).length > 2 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/iu.test(xmlContent)
  )
    throw new Error("Unsafe JUnit XML");
  if (XMLValidator.validate(xmlContent) !== true)
    throw new Error("Malformed JUnit XML");
  const parsed = object(
    new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: true,
      htmlEntities: false,
    }).parse(xmlContent),
  );
  if (parsed.testsuite === undefined && parsed.testsuites === undefined)
    throw new Error("Not a JUnit report");
  let passed = 0,
    failed = 0,
    skipped = 0,
    durationMs = 0,
    testcases = 0;
  const failures: TestFailure[] = [];
  const visit = (raw: unknown, depth = 0): void => {
    if (depth > 30) throw new Error("JUnit nesting limit exceeded");
    for (const entry of list(raw)) {
      const suite = object(entry);
      for (const rawCase of list(suite.testcase)) {
        if (++testcases > 50000)
          throw new Error("JUnit testcase limit exceeded");
        const testcase = object(rawCase);
        durationMs += number(testcase.time) * 1000;
        const failure = testcase.failure ?? testcase.error;
        if (failure !== undefined) {
          failed++;
          if (failures.length < 50) {
            const details = object(list(failure)[0]);
            const line = number(testcase.line);
            const filePath = text(testcase.file ?? testcase.filepath)
              .replaceAll("\\", "/")
              .replace(/^\.\//u, "");
            failures.push({
              testName: (
                text(testcase.name) ||
                text(testcase.classname) ||
                `test_${testcases}`
              ).slice(0, 300),
              message: (
                text(details.message) ||
                text(details["#text"]) ||
                text(failure) ||
                "Test failed"
              ).slice(0, 4000),
              ...(filePath ? { filePath } : {}),
              ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
            });
          }
        } else if (
          testcase.skipped !== undefined ||
          testcase.ignored !== undefined
        )
          skipped++;
        else passed++;
      }
      if (suite.testsuite !== undefined) visit(suite.testsuite, depth + 1);
      if (
        suite.testcase === undefined &&
        suite.testsuite === undefined &&
        suite.tests !== undefined
      ) {
        const total = number(suite.tests),
          bad = number(suite.failures) + number(suite.errors),
          ignored = number(suite.skipped);
        if (
          ![total, bad, ignored].every(Number.isSafeInteger) ||
          bad + ignored > total
        )
          throw new Error("Inconsistent JUnit counts");
        passed += total - bad - ignored;
        failed += bad;
        skipped += ignored;
        durationMs += number(suite.time) * 1000;
      }
    }
  };
  visit(parsed.testsuites ?? parsed.testsuite);
  return {
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    failures,
    ...(durationMs ? { durationMs: Math.round(durationMs) } : {}),
  };
}
