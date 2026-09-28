import type { RepositoryExecutorBinding } from "../src/review-services.js";

function unexpectedExecutorCall(): never {
  throw new TypeError("Unexpected executor call in test");
}

export const unconfiguredExecutor: RepositoryExecutorBinding = {
  cleanup: unexpectedExecutorCall,
  hasContext: unexpectedExecutorCall,
  discoverProjectMetadata: unexpectedExecutorCall,
  loadContext: unexpectedExecutorCall,
  prepareRepository: unexpectedExecutorCall,
  resolveContainerId: unexpectedExecutorCall,
  startTool: unexpectedExecutorCall,
  acquireReviewLease: async () => {},
};

export function toolOperation(
  run: (...args: never[]) => Promise<{ content: string; truncated: boolean }>,
): RepositoryExecutorBinding["startTool"] {
  return async () => ({
    result: () => run(),
    cancel: async () => {},
    [Symbol.dispose]: () => {},
  });
}
