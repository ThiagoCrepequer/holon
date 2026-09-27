import {
  isUniversalRepositoryPolicyGlob,
  repositoryPolicyGlobCanMatchProtectedPath,
} from "@holon/domain";
import { z } from "zod";

export { PROTECTED_POLICY_PATHS, isProtectedPath } from "@holon/domain";

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
    (glob) => !isUniversalRepositoryPolicyGlob(glob),
    "Universal exclusions (e.g. *, **, **/*) are prohibited as they compromise review coverage",
  )
  .refine(
    (glob) => !repositoryPolicyGlobCanMatchProtectedPath(glob),
    "Exclusion of protected policy, workflow, security, or CODEOWNERS files is prohibited",
  );

export const repositoryVerdictStrictnessSchema = z.enum([
  "default",
  "block_all_confident_medium",
]);

export type RepositoryVerdictStrictness = z.infer<
  typeof repositoryVerdictStrictnessSchema
>;

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
});

export type RepositoryPolicy = z.infer<typeof repositoryPolicySchema>;
