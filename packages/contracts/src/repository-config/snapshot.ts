import { z } from "zod";

import {
  repositoryPolicyGlobSchema,
  repositoryPolicySourceSchema,
  repositoryVerdictStrictnessSchema,
} from "../repository-policy.js";
import { documentationReferenceSchema } from "../review-guidance.js";
import {
  configPathSchema,
  configRootSchema,
  projectCompatibilitySchema,
  repositoryConfigLimits,
  reviewFocusSchema,
  reviewOutputPreferencesSchema,
} from "./input.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
export const configurationIdentitySchema = z.strictObject({
  installationId: z.number().int().positive(),
  repositoryId: z.number().int().positive(),
  pullRequestNumber: z.number().int().positive(),
  runId: z.string().max(256),
  baseSha: sha,
  headSha: sha,
});
export type ConfigurationIdentity = z.infer<typeof configurationIdentitySchema>;
export const resolvedGuidanceEntrySchema = z.strictObject({
  origin: z.string().max(256),
  path: configPathSchema.nullable(),
  text: z.string().max(repositoryConfigLimits.referenceBytes),
  digest,
});
export const resolvedRepositoryConfigSchema = z.strictObject({
  source: repositoryPolicySourceSchema,
  output: reviewOutputPreferencesSchema,
  additionalExcludes: z.array(repositoryPolicyGlobSchema).max(50),
  focus: z.array(reviewFocusSchema).max(5),
  documentation: z.array(documentationReferenceSchema).max(4),
  verdictStrictness: repositoryVerdictStrictnessSchema,
  instructions: z.array(resolvedGuidanceEntrySchema).max(200),
  references: z.array(resolvedGuidanceEntrySchema).max(32),
  projects: z
    .array(
      z.strictObject({
        name: z.string().max(128),
        root: configRootSchema,
        description: z.string().max(4096).nullable(),
        compatibility: projectCompatibilitySchema,
        instructions: z.array(resolvedGuidanceEntrySchema).max(200),
      }),
    )
    .max(20),
  pathRules: z
    .array(
      z.strictObject({
        paths: z.array(z.string().max(200)).min(1).max(20),
        instructions: z.array(resolvedGuidanceEntrySchema).max(200),
      }),
    )
    .max(50),
});
export type ResolvedRepositoryConfig = z.infer<
  typeof resolvedRepositoryConfigSchema
>;
export const runConfigurationSnapshotSchema = z.strictObject({
  identity: configurationIdentitySchema,
  compilerIdentity: z.string().min(1).max(128),
  sourceDigest: digest,
  configDigest: digest,
  scopeDigest: digest,
  config: resolvedRepositoryConfigSchema,
});
export type RunConfigurationSnapshot = z.infer<
  typeof runConfigurationSnapshotSchema
>;
export const runConfigurationRefSchema = z.strictObject({
  sourceDigest: digest,
  identity: configurationIdentitySchema,
  configDigest: digest,
  scopeDigest: digest,
});
export type RunConfigurationRef = z.infer<typeof runConfigurationRefSchema>;

/** Public projection: deliberately excludes YAML, descriptions, instruction and reference bodies. */
export const runConfigurationSummarySchema = runConfigurationRefSchema.extend({
  source: repositoryPolicySourceSchema,
  sourceDigest: digest,
  output: reviewOutputPreferencesSchema,
  additionalExcludes: z.array(repositoryPolicyGlobSchema).max(50),
  focus: z.array(reviewFocusSchema).max(5),
  verdictStrictness: repositoryVerdictStrictnessSchema,
  projects: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(128),
        root: configRootSchema,
        compatibility: projectCompatibilitySchema,
      }),
    )
    .max(20),
  instructionCount: z.number().int().min(0).max(200),
  referenceCount: z.number().int().min(0).max(32),
  pathRuleCount: z.number().int().min(0).max(50),
});
export type RunConfigurationSummary = z.infer<
  typeof runConfigurationSummarySchema
>;
