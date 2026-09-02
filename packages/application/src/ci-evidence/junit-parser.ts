import type { TestExecutionReport, TestFailure } from "@holon/domain";

function sanitizeXml(rawXml: string): string {
  return (
    rawXml
      // Strip DOCTYPE and ENTITY declarations to eliminate XXE vulnerabilities
      .replace(/<!DOCTYPE[\s\S]*?>/giu, "")
      .replace(/<!ENTITY[\s\S]*?>/giu, "")
      // Strip XML comments
      .replace(/<!--[\s\S]*?-->/gu, "")
  );
}

function parseAttributes(tagContent: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(tagContent)) !== null) {
    const key = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? "";
    attributes[key] = value;
  }

  return attributes;
}

function parseInteger(val: string | undefined): number {
  if (!val) return 0;
  const num = Number.parseInt(val, 10);
  return Number.isNaN(num) ? 0 : num;
}

function parseFloatNumber(val: string | undefined): number {
  if (!val) return 0;
  const num = Number.parseFloat(val);
  return Number.isNaN(num) ? 0 : num;
}

/**
 * Safely parses JUnit XML test execution reports without evaluating DTDs or external entities.
 */
export function parseJUnitXml(xmlContent: string): TestExecutionReport {
  const sanitized = sanitizeXml(xmlContent);

  let total = 0;
  let failed = 0;
  let skipped = 0;
  let passed = 0;
  let durationMs = 0;
  const failures: TestFailure[] = [];

  // Parse all <testcase> blocks
  const testcaseRegex = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/giu;
  let testcaseMatch: RegExpExecArray | null;
  let parsedTestcasesCount = 0;

  while ((testcaseMatch = testcaseRegex.exec(sanitized)) !== null) {
    parsedTestcasesCount++;
    const tagAttrs = testcaseMatch[1] ?? "";
    const body = testcaseMatch[2] ?? "";
    const attrs = parseAttributes(tagAttrs);

    const testName =
      attrs["name"] ?? attrs["classname"] ?? `test_${parsedTestcasesCount}`;
    const filePath = attrs["file"] ?? attrs["filepath"];
    const lineNum = parseInteger(attrs["line"]);
    const testTime = parseFloatNumber(attrs["time"]);
    durationMs += testTime * 1000;

    // Check for skipped / ignored
    const isSkipped = body.includes("<skipped") || body.includes("<ignored");

    // Check for failure or error
    const failureMatch =
      /<(?:failure|error)\b([^>]*)>([\s\S]*?)<\/(?:failure|error)>/iu.exec(
        body,
      );
    const selfClosingFailure = /<(?:failure|error)\b([^>]*)\/>/iu.exec(body);

    if (failureMatch || selfClosingFailure) {
      failed++;
      const failureAttrs = parseAttributes(
        (failureMatch ? failureMatch[1] : selfClosingFailure?.[1]) ?? "",
      );
      const failureBody = (failureMatch ? failureMatch[2] : "")?.trim() ?? "";
      const rawMessage =
        failureAttrs["message"] || failureBody || "Test failed";

      failures.push({
        filePath: filePath
          ? filePath.replace(/^(\.\/|\.\\)+/u, "").replace(/\\/gu, "/")
          : undefined,
        line: lineNum > 0 ? lineNum : undefined,
        message: rawMessage.slice(0, 4_000),
        testName: testName.slice(0, 300),
      });
    } else if (isSkipped) {
      skipped++;
    } else {
      passed++;
    }
  }

  total = passed + failed + skipped;

  // Fallback check on suite-level attributes if no testcases were found
  if (total === 0) {
    const suiteMatch = /<(?:testsuites|testsuite)\b([^>]*)>/iu.exec(sanitized);
    if (suiteMatch?.[1]) {
      const suiteAttrs = parseAttributes(suiteMatch[1]);
      const suiteTests = parseInteger(suiteAttrs["tests"]);
      const suiteFailures = parseInteger(suiteAttrs["failures"]);
      const suiteErrors = parseInteger(suiteAttrs["errors"]);
      const suiteSkipped = parseInteger(suiteAttrs["skipped"]);
      const suiteTime = parseFloatNumber(suiteAttrs["time"]);

      if (suiteTests > 0) {
        total = suiteTests;
        failed = suiteFailures + suiteErrors;
        skipped = suiteSkipped;
        passed = Math.max(0, total - failed - skipped);
        durationMs = suiteTime * 1000;
      }
    }
  }

  return {
    durationMs: durationMs > 0 ? Math.round(durationMs) : undefined,
    failed,
    failures,
    passed,
    skipped,
    total,
  };
}
