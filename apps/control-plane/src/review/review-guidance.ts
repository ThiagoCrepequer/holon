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
async function resolve(
  references: readonly DocumentationReference[] | undefined,
  paths: readonly string[],
  identification: ProjectIdentificationResult | undefined,
  load: (
    reference: DocumentationReference,
  ) => Promise<{ content: string; truncated: boolean }>,
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
      const { content, truncated } = await load(reference);
      result.documentation.push({ ...reference, content });
      if (truncated)
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

async function fetchPinnedDocumentation(
  reference: DocumentationReference,
  fetcher: typeof fetch,
) {
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
  return { content, truncated: raw.length > content.length };
}

/** One request owns at most four bounded documents; no cross-run or tenant cache. */
export function createReviewGuidanceResolver(fetcher: typeof fetch = fetch) {
  const pending = new Map<
    string,
    Promise<{ content: string; truncated: boolean }>
  >();
  let active = 0;
  const waiters: Array<() => void> = [];
  const load = (reference: DocumentationReference) => {
    const key = JSON.stringify([
      reference.url,
      reference.version,
      reference.sha256,
    ]);
    let result = pending.get(key);
    if (!result) {
      result = (async () => {
        if (active >= 2)
          await new Promise<void>((resume) => {
            waiters.push(resume);
          });
        else active++;
        try {
          return await fetchPinnedDocumentation(reference, fetcher);
        } finally {
          const next = waiters.shift();
          if (next) next();
          else active--;
        }
      })();
      if (pending.size < 4) pending.set(key, result);
    }
    return result;
  };
  return (
    references: readonly DocumentationReference[] | undefined,
    paths: readonly string[],
    identification: ProjectIdentificationResult | undefined,
  ) => resolve(references, paths, identification, load);
}

export function resolveReviewGuidance(
  references: readonly DocumentationReference[] | undefined,
  paths: readonly string[],
  identification: ProjectIdentificationResult | undefined,
  fetcher: typeof fetch = fetch,
): Promise<ResolvedReviewGuidance> {
  return createReviewGuidanceResolver(fetcher)(
    references,
    paths,
    identification,
  );
}
