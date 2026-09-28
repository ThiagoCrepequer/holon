import {
  contextManifestSchema,
  contextPages,
  contextPageSchema,
  readContextPages,
} from "@holon/contracts";

import type { SandboxPort } from "./sandbox-port.js";

const manifestPath = "/workspace/holon-context-manifest.json";
const pagePath = (index: number, digest: string) =>
  `/workspace/holon-context-${digest}-${index}.json`;

export async function saveContext(
  sandbox: SandboxPort,
  text: string,
): Promise<void> {
  const { manifest, pages } = await contextPages(text);
  for (const [index, page] of pages.entries())
    await sandbox.writeFile(pagePath(index, manifest.digest), page);
  // Completion marker is published only after every page has been written.
  await sandbox.writeFile(manifestPath, JSON.stringify(manifest));
}
export async function loadContextManifest(sandbox: SandboxPort) {
  return contextManifestSchema.parse(
    JSON.parse(await sandbox.readFile(manifestPath)),
  );
}
export async function loadContextPage(
  sandbox: SandboxPort,
  index: number,
  digest: string,
) {
  const manifest = await loadContextManifest(sandbox);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= manifest.pages ||
    digest !== manifest.digest
  )
    throw new TypeError("Invalid context page request");
  return contextPageSchema.parse(
    await sandbox.readFile(pagePath(index, digest)),
  );
}
export async function loadStoredContext(sandbox: SandboxPort) {
  const manifest = await loadContextManifest(sandbox);
  return readContextPages(manifest, (index, digest) =>
    loadContextPage(sandbox, index, digest),
  );
}
export async function hasStoredContext(sandbox: SandboxPort) {
  return sandbox.exists(manifestPath);
}
