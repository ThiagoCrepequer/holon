/** Work admission is independent from concurrent model execution. */
export const reviewExecutionLimits = {
  concurrency: 5,
  maxShards: 64,
  shardFiles: 4,
  shardLines: 192,
  shardPatchBytes: 24_000,
  contextFiles: 1_000,
  contextLines: 32_000,
  contextPatchBytes: 2_000_000,
  contextBytes: 8_000_000,
} as const;
