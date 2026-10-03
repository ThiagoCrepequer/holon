/** Work admission is independent from concurrent model execution. */
export const reviewExecutionLimits = {
  concurrency: 3,
  maxShards: 64,
  shardFiles: 16,
  shardLines: 768,
  shardPatchBytes: 96_000,
  shardEvidenceWindows: 96,
  contextFiles: 1_000,
  contextLines: 32_000,
  contextPatchBytes: 2_000_000,
  contextBytes: 8_000_000,
} as const;

/** Hard investigation limits shared by the model, service and durable ledger. */
export const reviewInvestigationLimits = {
  toolCalls: 96,
  outputTokens: 12_000,
} as const;
