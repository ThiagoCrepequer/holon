import { z } from "zod";

import { positiveIntegerSchema, repositoryPathSchema } from "./shared.js";

export const changedSymbolKindSchema = z.enum([
  "function",
  "method",
  "class",
  "interface",
  "type",
  "constant",
  "variable",
]);

export type ChangedSymbolKind = z.infer<typeof changedSymbolKindSchema>;

export const changedSymbolSchema = z.strictObject({
  change: z.enum(["added", "modified", "deleted"]),
  isExported: z.boolean(),
  kind: changedSymbolKindSchema,
  line: positiveIntegerSchema,
  // A body edit can be canonical even when the declaration line is outside the diff.
  patchLine: positiveIntegerSchema.optional(),
  name: z.string().min(1).max(150),
  path: repositoryPathSchema,
});

export type ChangedSymbol = z.infer<typeof changedSymbolSchema>;

export const downstreamReferenceSchema = z.strictObject({
  callerLine: positiveIntegerSchema,
  callerPath: repositoryPathSchema,
  excerpt: z.string().min(1).max(300),
  symbolName: z.string().min(1).max(150),
  targetPath: repositoryPathSchema,
});

export type DownstreamReference = z.infer<typeof downstreamReferenceSchema>;

export const contractBreakKindSchema = z.enum([
  "exported_symbol_removed",
  "signature_changed",
  "schema_field_removed",
  "sql_destructive_migration",
]);

export type ContractBreakKind = z.infer<typeof contractBreakKindSchema>;

export const contractBreakSignalSchema = z.strictObject({
  description: z.string().min(1).max(300),
  kind: contractBreakKindSchema,
  line: positiveIntegerSchema,
  path: repositoryPathSchema,
  severity: z.enum(["critical", "high", "medium"]),
});

export type ContractBreakSignal = z.infer<typeof contractBreakSignalSchema>;

export const securitySurfaceKindSchema = z.enum([
  "new_dependency",
  "manifest_modified",
  "network_egress",
  "secret_or_env_access",
]);

export type SecuritySurfaceKind = z.infer<typeof securitySurfaceKindSchema>;

export const securitySurfaceSignalSchema = z.strictObject({
  excerpt: z.string().min(1).max(300),
  kind: securitySurfaceKindSchema,
  line: positiveIntegerSchema,
  path: repositoryPathSchema,
});

export type SecuritySurfaceSignal = z.infer<typeof securitySurfaceSignalSchema>;

/** Inventory transport caps; prompt projections retain their separate byte budget. */
export const structuralReportLimits = {
  changedSymbols: 1000,
  contractBreaks: 500,
  downstreamReferences: 1000,
  securitySurfaces: 500,
} as const;

export const structuralImpactReportSchema = z.strictObject({
  changedSymbols: z
    .array(changedSymbolSchema)
    .max(structuralReportLimits.changedSymbols),
  contractBreaks: z
    .array(contractBreakSignalSchema)
    .max(structuralReportLimits.contractBreaks),
  downstreamReferences: z
    .array(downstreamReferenceSchema)
    .max(structuralReportLimits.downstreamReferences),
  repositoryScanTruncated: z.boolean().optional(),
  securitySurfaces: z
    .array(securitySurfaceSignalSchema)
    .max(structuralReportLimits.securitySurfaces),
  totalDownstreamReferencesCount: z.number().int().nonnegative().optional(),
  omittedSignals: z
    .strictObject({
      changedSymbols: z.number().int().nonnegative().safe(),
      contractBreaks: z.number().int().nonnegative().safe(),
      downstreamReferences: z.number().int().nonnegative().safe(),
      securitySurfaces: z.number().int().nonnegative().safe(),
    })
    .optional(),
});

export type StructuralImpactReport = z.infer<
  typeof structuralImpactReportSchema
>;
