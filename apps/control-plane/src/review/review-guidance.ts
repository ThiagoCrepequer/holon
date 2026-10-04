import { configurationDigest } from "@holon/application";
import {
  resolvedReviewGuidanceSchema,
  type ProjectIdentificationResult,
  type DocumentationReference,
  type ResolvedReviewGuidance,
} from "@holon/contracts";
import { redactSecrets } from "@holon/domain";
const within = (root: string, path: string) =>
  root === "." || path === root || path.startsWith(root + "/");
/** Fetches only hash-pinned official documentation selected by observed exact versions. */
export async function resolveReviewGuidance(
  references: readonly DocumentationReference[] | undefined,
  paths: readonly string[],
  identification: ProjectIdentificationResult | undefined,
  fetcher: typeof fetch = fetch,
): Promise<ResolvedReviewGuidance> {
  const result: ResolvedReviewGuidance = {
    documentation: [],
    limitations: [],
  };
  for (const reference of references ?? []) {
    if (!paths.some((path) => within(reference.root, path))) continue;
    const matched = identification?.projects.some(
      (project) =>
        project.root === reference.root &&
        project.technologies.some(
          (technology) =>
            technology.name === reference.technology &&
            technology.declarations.some(
              (declaration) =>
                ["locked", "declared-exact"].includes(declaration.kind) &&
                declaration.value === reference.version,
            ),
        ),
    );
    if (!matched) {
      result.limitations.push(
        `Documentation omitted: no exact observed version for ${reference.technology} at ${reference.root}.`,
      );
      continue;
    }
    try {
      const response = await fetcher(reference.url, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { accept: "text/plain, text/markdown, text/html" },
      });
      if (!response.ok || !response.body)
        throw new Error("Documentation unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 64000) throw new Error("Documentation too large");
          chunks.push(chunk.value);
        }
      } catch (error) {
        await reader.cancel();
        throw error;
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      if ((await configurationDigest(bytes)) !== reference.sha256)
        throw new Error("Documentation digest mismatch");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const content = redactSecrets(
        raw
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
          .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "")
          .replace(/<[^>]+>/gu, " "),
      ).slice(0, 8000);
      result.documentation.push({ ...reference, content });
      if (content.length === 8000)
        result.limitations.push(
          `Documentation excerpt limited for ${reference.technology}.`,
        );
    } catch {
      result.limitations.push(
        `Pinned documentation unavailable for ${reference.technology} ${reference.version}.`,
      );
    }
  }
  const size = () => new TextEncoder().encode(JSON.stringify(result)).length;
  if (size() > 24000) {
    result.limitations.push(
      "Supplementary project guidance exceeds the context budget; complete entries were omitted.",
    );
    while (size() > 24000 && result.documentation.length)
      result.documentation.pop();
  }
  return resolvedReviewGuidanceSchema.parse(result);
}
