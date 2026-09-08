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
  runTool: unexpectedExecutorCall,
};
