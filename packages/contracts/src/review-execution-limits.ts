/** Work admission is independent from concurrent model execution. */
export const reviewExecutionLimits = {
  concurrency: 5,
  maxShards: 64,
  shardFiles: 8,
  shardLines: 384,
  shardPatchBytes: 48_000,
  shardEvidenceWindows: 48,
  contextFiles: 1_000,
  contextLines: 32_000,
  contextPatchBytes: 2_000_000,
  contextBytes: 8_000_000,
} as const;

/** Hard investigation limits shared by the model, service and durable ledger. */
export const reviewInvestigationLimits = {
  rounds: 25,
  stagnantRounds: 3,
  totalOutputTokens: 120_000,
  toolCalls: 24,
  outputTokens: 12_000,
} as const;
