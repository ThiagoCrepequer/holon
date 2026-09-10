import { z } from "zod";

import {
  gitShaSchema,
  repositoryPathSchema,
  runIdSchema,
  positiveIntegerSchema,
} from "./shared.js";
const label = z
  .string()
  .min(1)
  .max(256)
  .refine((value) =>
    Array.from(value).every(
      (c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127,
    ),
  );
export const projectRootSchema = z.union([
  z.literal("."),
  repositoryPathSchema,
]);
export const versionKindSchema = z.enum([
  "declared-exact",
  "declared-range",
  "locked",
  "configured-target",
  "configured-runtime",
  "conditional",
  "unknown",
]);
export const identificationFactSchema = z.strictObject({
  id: label,
  path: repositoryPathSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  selector: label,
  name: label,
  value: label,
  kind: versionKindSchema,
  category: z.enum([
    "language",
    "compiler",
    "runtime",
    "framework",
    "library",
    "package-manager",
  ]),
  condition: label.nullable(),
});
export const identifiedTechnologySchema = z.strictObject({
  classificationSource: z.enum(["catalog", "model"]).optional(),
  name: label,
  category: identificationFactSchema.shape.category,
  declarations: z
    .array(
      z.strictObject({
        value: label,
        kind: versionKindSchema,
        evidenceIds: z.array(label).min(1).max(20),
        condition: label.nullable(),
      }),
    )
    .min(1)
    .max(100),
});
export const identifiedProjectSchema = z
  .strictObject({
    id: label,
    root: projectRootSchema,
    ecosystem: z.enum(["node", "maven", "gradle", "python"]),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    status: z.enum(["complete", "partial", "unavailable"]),
    facts: z.array(identificationFactSchema).max(500),
    technologies: z.array(identifiedTechnologySchema).max(100),
    limitations: z.array(label).max(100),
    sourcePaths: z.array(repositoryPathSchema).max(2000),
    interpretation: z.enum(["deterministic", "model-verified"]),
  })
  .superRefine((project, context) => {
    const ids = new Set(project.facts.map((f) => f.id));
    if (ids.size !== project.facts.length)
      context.addIssue({ code: "custom", message: "Duplicate evidence IDs" });
    for (const fact of project.facts)
      if (!project.sourcePaths.includes(fact.path))
        context.addIssue({
          code: "custom",
          message: "Evidence source outside project inputs",
        });
    for (const technology of project.technologies)
      for (const declaration of technology.declarations) {
        if (
          declaration.evidenceIds.some((id) => !ids.has(id)) ||
          !project.facts.some(
            (f) =>
              declaration.evidenceIds.includes(f.id) &&
              f.name === technology.name &&
              f.value === declaration.value &&
              f.kind === declaration.kind,
          )
        )
          context.addIssue({
            code: "custom",
            message: "Version declaration lacks matching evidence",
          });
      }
  });
export const configuredCompatibilitySchema = z
  .array(
    z.strictObject({
      name: label,
      root: projectRootSchema,
      projectIds: z.array(label).max(20),
      declarations: z
        .array(
          z.strictObject({
            category: z.enum(["runtimes", "frameworks"]),
            name: label,
            expected: label,
            status: z.enum(["matches", "conflicts", "unknown", "not_detected"]),
            detected: z
              .array(
                z.strictObject({
                  projectId: label,
                  technology: label,
                  value: label,
                  kind: versionKindSchema,
                  evidenceIds: z.array(label).min(1).max(20),
                  condition: label.nullable(),
                }),
              )
              .max(2000),
          }),
        )
        .max(10000),
    }),
  )
  .max(20);
export const projectIdentificationResultSchema = z.strictObject({
  configuredCompatibility: configuredCompatibilitySchema.optional(),
  snapshotSha: gitShaSchema,
  metadataChanged: z.boolean().optional(),
  usage: z
    .strictObject({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      modelCalls: z.number().int().nonnegative(),
    })
    .optional(),
  inventoryDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  detectorRevision: label,
  baseline: z
    .strictObject({
      snapshotSha: gitShaSchema,
      status: z.enum(["complete", "partial", "unavailable"]),
      projects: z.array(identifiedProjectSchema).max(20),
      limitations: z.array(label).max(100),
    })
    .optional(),
  status: z.enum(["complete", "partial", "unavailable", "disabled"]),
  projects: z.array(identifiedProjectSchema).max(20),
  limitations: z.array(label).max(100),
});
export const projectIdentificationModelOutputSchema = z.strictObject({
  selectedFactIds: z.array(label).max(500),
  classifications: z
    .array(
      z.strictObject({
        name: label,
        category: identificationFactSchema.shape.category,
        evidenceIds: z.array(label).min(1).max(20),
      }),
    )
    .max(100)
    .optional(),
});
export const projectMetadataRequestSchema = z.strictObject({
  deadlineAt: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  runId: runIdSchema,
  installationId: positiveIntegerSchema,
  repositoryId: positiveIntegerSchema,
  snapshotSha: gitShaSchema,
  policyDigest: z.string().min(1).max(128),
  modelRevision: label,
  mode: z.enum(["affected", "all-projects"]).default("affected"),
});
export type IdentificationFact = z.infer<typeof identificationFactSchema>;
export type IdentifiedProject = z.infer<typeof identifiedProjectSchema>;
export type ProjectIdentificationResult = z.infer<
  typeof projectIdentificationResultSchema
>;
export type ProjectMetadataRequest = z.infer<
  typeof projectMetadataRequestSchema
>;
export type ProjectIdentificationModelOutput = z.infer<
  typeof projectIdentificationModelOutputSchema
>;

export const projectMetadataAuthoritySchema = projectMetadataRequestSchema
  .omit({
    snapshotSha: true,
    modelRevision: true,
    mode: true,
    deadlineAt: true,
  })
  .extend({
    headSha: gitShaSchema,
    baseSha: gitShaSchema,
    changedPaths: z.array(repositoryPathSchema).max(10000).optional(),
  });

export const identificationRevocationSchema = z.object({
  action: z.string(),
  installation: z.object({ id: positiveIntegerSchema }),
  repositories_added: z
    .array(z.object({ id: positiveIntegerSchema }))
    .max(10000)
    .optional(),
  repositories_removed: z
    .array(z.object({ id: positiveIntegerSchema }))
    .max(10000)
    .optional(),
});
