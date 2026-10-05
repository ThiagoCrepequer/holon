// Narrow policy of this fixture: repository links belong to the GitHub origin.
export const urlFixtures = [
  "javascript:globalThis.proofXss=true",
  'data:text/html,<svg onload="globalThis.proofXss=true">',
  "https://github.com@evil.test/",
  "https://github.com.evil.test/",
  "//evil.test/",
  "https://github.com/holon/proof",
];
export function repositoryHref(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.port
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
