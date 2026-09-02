import type {
  CiEvidence,
  LineCoverage,
  TestExecutionReport,
} from "@holon/domain";

import { parseJUnitXml } from "./junit-parser.js";
import { parseLcov } from "./lcov-parser.js";
import { extractSafeZipArtifact } from "./zip-extractor.js";

export interface IngestCiArtifactsOptions {
  readonly source?: string | undefined;
  readonly workflowName?: string | undefined;
  readonly workflowRunId?: number | undefined;
}

export interface RawArtifactFile {
  readonly content: string;
  readonly path: string;
}

function isLcovContent(path: string, content: string): boolean {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".lcov") || lowerPath.endsWith(".info")) return true;
  return content.includes("SF:") && content.includes("end_of_record");
}

function isJUnitXmlContent(path: string, content: string): boolean {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".xml")) return true;
  return content.includes("<testsuite") || content.includes("<testsuites");
}

/**
 * Ingests and parses CI artifacts (LCOV coverage and JUnit XML test reports)
 * from one or more raw zip buffers.
 */
export function ingestCiArtifactZips(
  zipBuffers: readonly (ArrayBuffer | Uint8Array)[],
  options: IngestCiArtifactsOptions = {},
): CiEvidence {
  const extractedFiles: RawArtifactFile[] = [];

  for (const zipBuffer of zipBuffers) {
    try {
      const files = extractSafeZipArtifact(zipBuffer);
      for (const file of files) {
        extractedFiles.push({
          content: file.content,
          path: file.path,
        });
      }
    } catch {
      // If a zip fails extraction (e.g. malformed or oversized), skip it safely
      continue;
    }
  }

  return ingestRawArtifactFiles(extractedFiles, options);
}

/**
 * Ingests and parses pre-extracted artifact files.
 */
export function ingestRawArtifactFiles(
  files: readonly RawArtifactFile[],
  options: IngestCiArtifactsOptions = {},
): CiEvidence {
  const coverageReports: LineCoverage[] = [];
  const testReports: TestExecutionReport[] = [];

  for (const file of files) {
    if (isLcovContent(file.path, file.content)) {
      try {
        const parsed = parseLcov(file.content);
        coverageReports.push(...parsed);
      } catch {
        // Ignore parsing errors on individual invalid files
      }
    } else if (isJUnitXmlContent(file.path, file.content)) {
      try {
        const parsed = parseJUnitXml(file.content);
        testReports.push(parsed);
      } catch {
        // Ignore parsing errors on individual invalid files
      }
    }
  }

  // Combine test execution reports if multiple suites exist
  let combinedTests: TestExecutionReport | undefined;
  if (testReports.length > 0) {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let durationMs: number | undefined;
    const failures: TestExecutionReport["failures"][number][] = [];

    for (const report of testReports) {
      total += report.total;
      passed += report.passed;
      failed += report.failed;
      skipped += report.skipped;
      if (report.durationMs !== undefined) {
        durationMs = (durationMs ?? 0) + report.durationMs;
      }
      failures.push(...report.failures);
    }

    combinedTests = {
      durationMs,
      failed,
      failures,
      passed,
      skipped,
      total,
    };
  }

  const hasCoverage = coverageReports.length > 0;
  const hasTests = combinedTests !== undefined;

  let status: CiEvidence["status"] = "not_available";
  if (hasCoverage && hasTests) {
    status = "available";
  } else if (hasCoverage || hasTests) {
    status = "partial";
  }

  return {
    coverage: hasCoverage ? coverageReports : undefined,
    source: options.source,
    status,
    tests: combinedTests,
    workflowName: options.workflowName,
    workflowRunId: options.workflowRunId,
  };
}
