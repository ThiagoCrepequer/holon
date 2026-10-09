import {
  structuralReportLimits,
  type StructuralImpactReport,
} from "@holon/contracts";

import { detectContractBreaks } from "./contract-break-detector.js";
import {
  findDownstreamReferences,
  type DownstreamTracerFile,
  type DownstreamTracerOptions,
} from "./downstream-tracer.js";
import { detectSecuritySurfaces } from "./security-surface-detector.js";
import { extractChangedSymbols } from "./symbol-extractor.js";

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
  const changedSymbols = extractChangedSymbols(
    input.changedFiles,
    input.repositoryFiles,
  );

  const downstream = findDownstreamReferences(
    changedSymbols,
    input.repositoryFiles,
    {
      maxReferences: structuralReportLimits.downstreamReferences,
      ...input.options,
    },
  );

  const contractBreaks = detectContractBreaks(
    input.changedFiles,
    changedSymbols,
    downstream.references,
    input.repositoryFiles,
  );
  const securitySurfaces = detectSecuritySurfaces(input.changedFiles);
  const omittedSignals = {
    changedSymbols: Math.max(
      0,
      changedSymbols.length - structuralReportLimits.changedSymbols,
    ),
    contractBreaks: Math.max(
      0,
      contractBreaks.length - structuralReportLimits.contractBreaks,
    ),
    downstreamReferences:
      downstream.totalCount -
      Math.min(
        structuralReportLimits.downstreamReferences,
        downstream.references.length,
      ),
    securitySurfaces: Math.max(
      0,
      securitySurfaces.length - structuralReportLimits.securitySurfaces,
    ),
  };

  return {
    changedSymbols: changedSymbols.slice(
      0,
      structuralReportLimits.changedSymbols,
    ),
    contractBreaks: contractBreaks.slice(
      0,
      structuralReportLimits.contractBreaks,
    ),
    downstreamReferences: downstream.references.slice(
      0,
      structuralReportLimits.downstreamReferences,
    ),
    repositoryScanTruncated: input.repositoryScanTruncated ?? false,
    securitySurfaces: securitySurfaces.slice(
      0,
      structuralReportLimits.securitySurfaces,
    ),
    totalDownstreamReferencesCount: downstream.totalCount,
    ...(Object.values(omittedSignals).some((count) => count > 0)
      ? { omittedSignals }
      : {}),
  };
}
