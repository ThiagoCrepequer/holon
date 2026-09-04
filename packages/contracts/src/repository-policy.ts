import { z } from "zod";

export const PROTECTED_POLICY_PATHS = [
  ".github/holon.yml",
  ".github/holon.yaml",
  ".holon.yml",
  ".holon.yaml",
  ".github/workflows",
  "security.md",
  ".github/security.md",
  "codeowners",
  ".github/codeowners",
  "docs/codeowners",
] as const;

export function isProtectedPath(path: string): boolean {
  const normalized = path.toLowerCase().replace(/^\/+/u, "");
  return PROTECTED_POLICY_PATHS.some((protectedPath) => {
    return (
      normalized === protectedPath ||
      normalized.startsWith(`${protectedPath}/`) ||
      normalized.startsWith(`${protectedPath}.`)
    );
  });
}

const universalWildcards = new Set([
  "*",
  "**",
  "***",
  "*/*",
  "**/*",
  "*.*",
  "**/*.*",
  ".*",
  "**/.*",
]);

export const repositoryPolicyGlobSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z0-9_.*?/-]+$/u,
    "Glob pattern contains forbidden characters (only alphanumeric, _, -, ., /, *, ** and ? allowed)",
  )
  .refine((glob) => !glob.startsWith("/"), "Glob pattern must be relative")
  .refine(
    (glob) => !glob.includes(".."),
    "Glob pattern must not contain traversal ('..')",
  )
  .refine(
    (glob) => !universalWildcards.has(glob.trim()),
    "Universal exclusions (e.g. *, **, **/*) are prohibited as they compromise review coverage",
  )
  .refine((glob) => {
    const trimmed = glob.trim().replace(/^\/+/u, "");
    return !isProtectedPath(trimmed);
  }, "Exclusion of protected policy, workflow, security, or CODEOWNERS files is prohibited");

export const repositoryVerdictStrictnessSchema = z.enum([
  "default",
  "block_all_confident_medium",
]);

export type RepositoryVerdictStrictness = z.infer<
  typeof repositoryVerdictStrictnessSchema
>;

export const rawRepositoryPolicySchema = z.strictObject({
  review: z
    .strictObject({
      additional_excludes: z
        .array(repositoryPolicyGlobSchema)
        .max(50)
        .optional(),
    })
    .optional(),
  verdict: z
    .strictObject({
      strictness: repositoryVerdictStrictnessSchema.optional(),
    })
    .optional(),
  version: z.literal(1),
});

export type RawRepositoryPolicy = z.infer<typeof rawRepositoryPolicySchema>;

export const repositoryPolicySourceSchema = z.enum([
  ".github/holon.yml",
  ".holon.yml",
  "default",
]);

export type RepositoryPolicySource = z.infer<
  typeof repositoryPolicySourceSchema
>;

export const repositoryPolicySchema = z.strictObject({
  additionalExcludes: z.array(repositoryPolicyGlobSchema),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/u),
  effectivePolicyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  source: repositoryPolicySourceSchema,
  sourceDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  verdictStrictness: repositoryVerdictStrictnessSchema,
  version: z.literal(1),
});

export type RepositoryPolicy = z.infer<typeof repositoryPolicySchema>;
