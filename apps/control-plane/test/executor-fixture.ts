import { contextPages, contextStream } from "@holon/contracts";

import type { RepositoryExecutorBinding } from "../src/review-services.js";

function unexpectedExecutorCall(): never {
  throw new TypeError("Unexpected executor call in test");
}

export const unconfiguredExecutor: RepositoryExecutorBinding = {
  cleanup: unexpectedExecutorCall,
  hasContext: unexpectedExecutorCall,
  discoverProjectMetadata: unexpectedExecutorCall,
  openContext: unexpectedExecutorCall,
  prepareRepository: unexpectedExecutorCall,
  resolveContainerId: unexpectedExecutorCall,
  runTool: unexpectedExecutorCall,
};

export function pagedContext(read: () => Promise<unknown>) {
  return {
    openContext: async () => {
      const snapshot = await contextPages(JSON.stringify(await read()));
      return contextStream(
        snapshot.manifest,
        async (index) => snapshot.pages[index],
      );
    },
  };
}
