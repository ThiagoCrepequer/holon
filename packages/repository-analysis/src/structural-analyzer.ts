import type { StructuralImpactReport } from "@holon/contracts";

import { detectContractBreaks } from "./contract-break-detector.js";
import {
  findDownstreamReferences,
  type DownstreamTracerFile,
  type DownstreamTracerOptions,
} from "./downstream-tracer.js";
import { detectSecuritySurfaces } from "./security-surface-detector.js";
import { contractBreaksToFindings } from "./structural-findings.js";
import { extractChangedSymbols } from "./symbol-extractor.js";
import { detectTestGaps } from "./test-gap-detector.js";

export interface StructuralAnalysisInput {
  readonly changedFiles: readonly {
    readonly patch: string;
    readonly path: string;
  }[];
  readonly options?: DownstreamTracerOptions | undefined;
  readonly repositoryFiles: readonly DownstreamTracerFile[];
  readonly repositoryScanTruncated?: boolean | undefined;
}

export function analyzeStructuralImpact(
  input: StructuralAnalysisInput,
): StructuralImpactReport {
  const changedSymbols = extractChangedSymbols(input.changedFiles);

  const downstream = findDownstreamReferences(
    changedSymbols,
    input.repositoryFiles,
    input.options,
  );

  const contractBreaks = detectContractBreaks(
    input.changedFiles,
    changedSymbols,
    downstream.references,
  );
  const testGaps = detectTestGaps(input.changedFiles);
  const securitySurfaces = detectSecuritySurfaces(input.changedFiles);
  const deterministicFindings = contractBreaksToFindings(
    contractBreaks,
    input.changedFiles,
  );

  return {
    changedSymbols: changedSymbols.slice(0, 100),
    contractBreaks: contractBreaks.slice(0, 50),
    deterministicFindings: deterministicFindings.slice(0, 50),
    downstreamReferences: downstream.references.slice(0, 100),
    repositoryScanTruncated: input.repositoryScanTruncated ?? false,
    securitySurfaces: securitySurfaces.slice(0, 50),
    testGaps: testGaps.slice(0, 50),
    totalDownstreamReferencesCount: downstream.totalCount,
  };
}
