import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  extractSafeZipArtifact,
  ingestCiArtifactZips,
  ingestRawArtifactFiles,
  MAX_COMPRESSED_BYTES,
  parseJUnitXml,
  parseLcov,
} from "../src/index.js";

describe("CI Evidence Ingestion & Parsers", () => {
  describe("lcov-parser", () => {
    it("parses valid LCOV content with multiple files", () => {
      const lcov = `
TN:
SF:./src/math.ts
DA:1,3
DA:2,3
DA:3,0
LF:3
LH:2
end_of_record
SF:src\\utils\\helper.ts
DA:10,1
DA:11,1
LF:2
LH:2
end_of_record
`;

      const result = parseLcov(lcov);
      expect(result).toHaveLength(2);

      expect(result[0]!.path).toBe("src/math.ts");
      expect(result[0]!.totalFound).toBe(3);
      expect(result[0]!.totalHit).toBe(2);
      expect(result[0]!.hitsByLine).toEqual({ 1: 3, 2: 3, 3: 0 });

      expect(result[1]!.path).toBe("src/utils/helper.ts");
      expect(result[1]!.totalFound).toBe(2);
      expect(result[1]!.totalHit).toBe(2);
      expect(result[1]!.hitsByLine).toEqual({ 10: 1, 11: 1 });
    });

    it("parses LCOV with missing LF/LH and trailing record without end_of_record", () => {
      const lcov = `
SF:src/unclosed.ts
DA:5,10
DA:6,0
`;
      const result = parseLcov(lcov);
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe("src/unclosed.ts");
      expect(result[0]!.totalFound).toBe(2);
      expect(result[0]!.totalHit).toBe(1);
    });

    it("handles empty or invalid LCOV lines gracefully", () => {
      const lcov = `
invalid_line_without_token
DA:invalid,format
`;
      const result = parseLcov(lcov);
      expect(result).toHaveLength(0);
    });
  });

  describe("junit-parser", () => {
    it("parses JUnit XML with testcases, failures, and skipped tests", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Some comment -->
<testsuites name="vitest tests" tests="3" failures="1" errors="0" skipped="1" time="1.25">
  <testsuite name="math.test.ts" tests="3" failures="1">
    <testcase name="should add numbers" classname="math" file="test/math.test.ts" line="10" time="0.05" />
    <testcase name="should subtract numbers" classname="math" file="test/math.test.ts" line="20" time="0.10">
      <failure message="AssertionError: expected 5 to be 4">
        details of failure stack trace
      </failure>
    </testcase>
    <testcase name="should divide numbers" classname="math" file="test/math.test.ts" line="30" time="0.00">
      <skipped />
    </testcase>
  </testsuite>
</testsuites>`;

      const result = parseJUnitXml(xml);
      expect(result.total).toBe(3);
      expect(result.passed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.durationMs).toBe(150); // 0.05 + 0.10 = 0.15s = 150ms

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]!.testName).toBe("should subtract numbers");
      expect(result.failures[0]!.filePath).toBe("test/math.test.ts");
      expect(result.failures[0]!.line).toBe(20);
      expect(result.failures[0]!.message).toContain(
        "AssertionError: expected 5 to be 4",
      );
    });

    it("falls back to suite attributes when no testcase tags exist", () => {
      const xml = `<testsuite name="simple" tests="5" failures="2" errors="0" skipped="1" time="2.5" />`;
      const result = parseJUnitXml(xml);
      expect(result.total).toBe(5);
      expect(result.failed).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.passed).toBe(2);
      expect(result.durationMs).toBe(2500);
      expect(result.failures).toHaveLength(0);
    });

    it("handles empty or malformed XML gracefully", () => {
      expect(() =>
        parseJUnitXml("<not-a-test-report></not-a-test-report>"),
      ).toThrow("Not a JUnit report");
    });
  });

  describe("zip-extractor", () => {
    it("extracts allowed files from a valid zip buffer", () => {
      const zipData = zipSync({
        "coverage/lcov.info": new TextEncoder().encode(
          "SF:src/a.ts\nDA:1,1\nend_of_record",
        ),
        "ignore-me.exe": new TextEncoder().encode("binary content"),
        "results/junit.xml": new TextEncoder().encode(
          '<testsuite tests="1" />',
        ),
      });

      const extracted = extractSafeZipArtifact(zipData);
      expect(extracted).toHaveLength(2);

      const paths = extracted.map((e) => e.path);
      expect(paths).toContain("coverage/lcov.info");
      expect(paths).toContain("results/junit.xml");
      expect(paths).not.toContain("ignore-me.exe");
    });

    it("handles empty zip buffer", () => {
      const emptyZip = new Uint8Array(0);
      const extracted = extractSafeZipArtifact(emptyZip);
      expect(extracted).toEqual([]);
    });

    it("rejects zip exceeding maximum compressed size", () => {
      const fakeLargeZip = new Uint8Array(MAX_COMPRESSED_BYTES + 1);
      expect(() => extractSafeZipArtifact(fakeLargeZip)).toThrow(
        "exceeds safety limit",
      );
    });

    it("rejects zip that uncompresses beyond maximum threshold (Zip Bomb defense)", () => {
      // Test with custom low threshold to avoid allocating/compressing 30 MB in CI test runners
      const content = new Uint8Array(2048);
      const zipData = zipSync({
        "big-report.xml": content,
      });

      expect(() =>
        extractSafeZipArtifact(zipData, { maxUncompressedBytes: 1024 }),
      ).toThrow("Artifact uncompressed size");
    });
  });

  describe("ci-evidence-service", () => {
    it("ingests raw artifact files and combines test suites", () => {
      const files = [
        {
          content: "SF:src/a.ts\nDA:1,1\nend_of_record",
          path: "coverage.lcov",
        },
        {
          content:
            '<testsuite tests="2" failures="0" skipped="0" time="0.5" />',
          path: "unit-tests.xml",
        },
        {
          content:
            '<testsuite tests="3" failures="1" errors="0" skipped="0" time="1.0" />',
          path: "integration-tests.xml",
        },
      ];

      const evidence = ingestRawArtifactFiles(files, {
        source: "github-actions",
        workflowName: "CI Test",
        workflowRunId: 100200,
      });

      expect(evidence.status).toBe("available");
      expect(evidence.coverage).toHaveLength(1);
      expect(evidence.tests?.total).toBe(5);
      expect(evidence.tests?.failed).toBe(1);
      expect(evidence.tests?.passed).toBe(4);
      expect(evidence.tests?.durationMs).toBe(1500);
      expect(evidence.source).toBe("github-actions");
      expect(evidence.workflowName).toBe("CI Test");
      expect(evidence.workflowRunId).toBe(100200);
    });

    it("ingests zip buffers directly and handles partial or unavailable status", () => {
      // Coverage only -> partial
      const coverageZip = zipSync({
        "lcov.info": new TextEncoder().encode(
          "SF:src/a.ts\nDA:1,1\nend_of_record",
        ),
      });

      const partialEvidence = ingestCiArtifactZips([coverageZip]);
      expect(partialEvidence.status).toBe("partial");
      expect(partialEvidence.coverage).toBeDefined();
      expect(partialEvidence.tests).toBeUndefined();

      // Empty / corrupted zip -> not_available
      const corruptedZip = new Uint8Array([1, 2, 3, 4, 5]);
      const notAvailable = ingestCiArtifactZips([corruptedZip]);
      expect(notAvailable.status).toBe("not_available");
    });
  });
});

describe("parser edge cases and branch coverage", () => {
  it("handles classname, filepath, self-closing failure, error tag, and ignored tag", () => {
    const xml = `
<testsuite name="edge-cases">
  <testcase classname="pkg.Calculator" filepath="src/calc.ts" line="0" time="0.1">
    <error>Crash in calculator</error>
  </testcase>
  <testcase name="test-without-message" file="src/b.ts">
    <failure />
  </testcase>
  <testcase name="ignored-test">
    <ignored />
  </testcase>
</testsuite>`;

    const result = parseJUnitXml(xml);
    expect(result.total).toBe(3);
    expect(result.failed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failures[0]!.testName).toBe("pkg.Calculator");
    expect(result.failures[0]!.filePath).toBe("src/calc.ts");
    expect(result.failures[0]!.line).toBeUndefined(); // line was 0
    expect(result.failures[0]!.message).toContain("Crash in calculator");
    expect(result.failures[1]!.message).toBe("Test failed");
  });

  it("filters out traversal paths and accepts all allowed extensions in zip extractor", () => {
    const zipData = zipSync({
      "../escape.xml": new TextEncoder().encode("<testsuite />"),
      "..\\escape-win.xml": new TextEncoder().encode("<testsuite />"),
      "report.sarif": new TextEncoder().encode('{"runs": []}'),
      "data.json": new TextEncoder().encode("{}"),
    });

    const extracted = extractSafeZipArtifact(zipData);
    const paths = extracted.map((e) => e.path);
    expect(paths).toContain("report.sarif");
    expect(paths).toContain("data.json");
    expect(paths).not.toContain("../escape.xml");
    expect(paths).not.toContain("..\\escape-win.xml");
  });
});
