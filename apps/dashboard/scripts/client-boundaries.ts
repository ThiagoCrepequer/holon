/** Inspect module identities before minification can hide a server SDK's symbols. */
export function assertClientModules(moduleIds: readonly string[]): void {
  for (const id of moduleIds) {
    if (
      /\.server\.[tj]sx?(?:$|\?)/u.test(id) ||
      /\/packages\/(?:db|auth)\//u.test(id) ||
      /(?:^|\/)(?:better-auth|@better-auth|drizzle-orm)(?:\/|$)/u.test(id) ||
      id.includes("cloudflare:") ||
      id.startsWith("node:") ||
      id.includes("__vite-browser-external")
    ) {
      throw new Error(`Server module in client bundle: ${id}`);
    }
  }
}
