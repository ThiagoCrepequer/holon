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

export const structuralImpactReportSchema = z.strictObject({
  changedSymbols: z.array(changedSymbolSchema).max(100),
  contractBreaks: z.array(contractBreakSignalSchema).max(50),
  downstreamReferences: z.array(downstreamReferenceSchema).max(100),
  repositoryScanTruncated: z.boolean().optional(),
  securitySurfaces: z.array(securitySurfaceSignalSchema).max(50),
  totalDownstreamReferencesCount: z.number().int().nonnegative().optional(),
});

export type StructuralImpactReport = z.infer<
  typeof structuralImpactReportSchema
>;
