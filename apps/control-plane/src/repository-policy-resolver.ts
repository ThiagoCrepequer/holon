import {
  rawRepositoryPolicySchema,
  repositoryPolicySchema,
  type RepositoryPolicy,
  type RepositoryPolicySource,
} from "@holon/contracts";
import {
  RepositoryPolicyConflictError,
  RepositoryPolicySchemaError,
  RepositoryPolicyScopeError,
  RepositoryPolicySyntaxError,
} from "@holon/domain";
import type { GitHubInstallationSession } from "@holon/github";
import YAML from "yaml";

export async function computeSha256Hex(
  data: Uint8Array | string,
): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hashBuffer = await crypto.subtle.digest("SHA-256", copy.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createDefaultRepositoryPolicy(
  baseSha: string,
): Promise<RepositoryPolicy> {
  const canonicalObj = {
    additionalExcludes: [],
    verdictStrictness: "default",
    version: 1,
  };
  const canonicalJson = JSON.stringify(canonicalObj);
  const effectivePolicyDigest = await computeSha256Hex(canonicalJson);
  return repositoryPolicySchema.parse({
    additionalExcludes: [],
    baseSha,
    effectivePolicyDigest,
    source: "default",
    sourceDigest: null,
    verdictStrictness: "default",
    version: 1,
  });
}

function validateYamlNodeSecurity(node: unknown, depth = 0): void {
  if (depth > 5) {
    throw new RepositoryPolicySyntaxError(
      "YAML nesting depth exceeds safe limit of 5 levels",
    );
  }
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      validateYamlNodeSecurity(item, depth + 1);
    }
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    if (key === "<<" || key.startsWith("!")) {
      throw new RepositoryPolicySyntaxError(
        `Forbidden YAML construct detected: '${key}'`,
      );
    }
    validateYamlNodeSecurity(val, depth + 1);
  }
}

export async function parseAndValidatePolicy(
  rawText: string,
  rawBytes: Uint8Array,
  source: RepositoryPolicySource,
  baseSha: string,
): Promise<RepositoryPolicy> {
  const doc = YAML.parseDocument(rawText, {
    prettyErrors: false,
  });

  if (doc.errors.length > 0) {
    throw new RepositoryPolicySyntaxError(
      doc.errors[0]?.message ?? "Invalid YAML document",
    );
  }
  if (doc.warnings.length > 0) {
    throw new RepositoryPolicySyntaxError(
      doc.warnings[0]?.message ?? "YAML warnings encountered",
    );
  }

  let jsObject: unknown;
  try {
    jsObject = doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new RepositoryPolicySyntaxError(
      error instanceof Error
        ? error.message
        : "YAML alias resolution is disabled",
    );
  }

  if (
    jsObject === null ||
    jsObject === undefined ||
    typeof jsObject !== "object" ||
    Array.isArray(jsObject)
  ) {
    throw new RepositoryPolicySyntaxError(
      "Policy configuration must be a valid YAML mapping",
    );
  }

  validateYamlNodeSecurity(jsObject);

  const parsed = rawRepositoryPolicySchema.safeParse(jsObject);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message = firstIssue?.message ?? "Invalid repository policy schema";
    if (
      message.includes("Universal exclusions") ||
      message.includes("protected")
    ) {
      throw new RepositoryPolicyScopeError(message);
    }
    throw new RepositoryPolicySchemaError(message);
  }

  const additionalExcludes = [
    ...(parsed.data.review?.additional_excludes ?? []),
  ].toSorted();
  const verdictStrictness = parsed.data.verdict?.strictness ?? "default";

  const canonicalObj = {
    additionalExcludes,
    verdictStrictness,
    version: 1,
  };
  const canonicalJson = JSON.stringify(canonicalObj);
  const effectivePolicyDigest = await computeSha256Hex(canonicalJson);
  const sourceDigest = await computeSha256Hex(rawBytes);

  return repositoryPolicySchema.parse({
    additionalExcludes,
    baseSha,
    effectivePolicyDigest,
    source,
    sourceDigest,
    verdictStrictness,
    version: 1,
  });
}

export async function resolveRepositoryPolicy(
  session: GitHubInstallationSession,
  owner: string,
  repo: string,
  baseSha: string,
): Promise<RepositoryPolicy> {
  if (typeof session.readRepositoryPolicyFile !== "function") {
    return await createDefaultRepositoryPolicy(baseSha);
  }

  const primaryFile = await session.readRepositoryPolicyFile(
    owner,
    repo,
    baseSha,
    ".github/holon.yml",
  );
  const secondaryFile = await session.readRepositoryPolicyFile(
    owner,
    repo,
    baseSha,
    ".holon.yml",
  );

  if (primaryFile !== undefined && secondaryFile !== undefined) {
    throw new RepositoryPolicyConflictError();
  }

  if (primaryFile !== undefined) {
    return await parseAndValidatePolicy(
      primaryFile.content,
      primaryFile.rawBytes,
      ".github/holon.yml",
      baseSha,
    );
  }

  if (secondaryFile !== undefined) {
    return await parseAndValidatePolicy(
      secondaryFile.content,
      secondaryFile.rawBytes,
      ".holon.yml",
      baseSha,
    );
  }

  return await createDefaultRepositoryPolicy(baseSha);
}
