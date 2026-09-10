import { z } from "zod";

export const repositoryConfigLimits = {
  yamlBytes: 65_536,
  sourceBytes: 262_144,
  serializedBytes: 524_288,
  referenceBytes: 32_768,
  instructionBytes: 16_384,
  descriptionBytes: 4_096,
  guidanceBytes: 32_768,
  referenceFiles: 32,
  instructionEntries: 200,
  projects: 20,
  pathRules: 50,
  astDepth: 12,
  astNodes: 10_000,
} as const;

// Exportable syntax only. UTF-8 budgets, provenance and existence are checked by
// the compiler, never silently discarded during JSON Schema generation.
export const configPathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(
    // eslint-disable-next-line no-control-regex -- The exported JSON Schema must reject path control characters.
    /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\\:\u0000-\u001f\u007f])(?!.*\/\/)(?!.*\/$).+$/u,
    "Use a relative repository path without traversal, URLs or control characters",
  );
export const configRootSchema = z.union([z.literal("."), configPathSchema]);
const globSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9_.*?/-]+$/u);
const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);
const label = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.@/-]*$/u);
const technologyName = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9@][A-Za-z0-9_.:@/-]*$/u,
  );
const declarations = z.record(technologyName, text(256));

export const reviewOutputPreferencesSchema = z.strictObject({
  language: z.enum(["en", "pt-BR", "es"]),
  detail: z.enum(["concise", "detailed"]),
  maxInlineComments: z.number().int().min(0).max(40),
});
export type ReviewOutputPreferences = z.infer<
  typeof reviewOutputPreferencesSchema
>;
export type ReviewLanguage = ReviewOutputPreferences["language"];

export const instructionEntrySchema = z.union([
  text(repositoryConfigLimits.instructionBytes).describe(
    "Review guidance. Multiline YAML block strings are supported; runtime also enforces UTF-8 byte limits.",
  ),
  z.strictObject({
    path: configPathSchema.describe(
      "Instruction file relative to the project root, or repository root in global/path-rule instructions. Read from the base SHA; no recursive includes.",
    ),
  }),
]);
const instructions = z
  .array(instructionEntrySchema)
  .max(repositoryConfigLimits.instructionEntries);
export const projectCompatibilitySchema = z.strictObject({
  runtimes: declarations.optional(),
  frameworks: declarations.optional(),
});
export const reviewFocusSchema = z.enum([
  "correctness",
  "security",
  "concurrency",
  "performance",
  "accessibility",
]);

export const repositoryConfigInputSchema = z
  .strictObject({
    output: z
      .strictObject({
        language: z.enum(["en", "pt-BR", "es"]).optional().meta({
          default: "en",
          description:
            "Language of Holon comments and summaries. Code and evidence are never translated.",
        }),
        detail: z.enum(["concise", "detailed"]).optional().meta({
          default: "concise",
          description:
            "Narrative detail; verified findings and coverage limitations are preserved.",
        }),
        max_inline_comments: z.number().int().min(0).max(40).optional().meta({
          default: 40,
          description:
            "Maximum new inline comments per run. Zero keeps summary/check output. Does not change analysis or verdict.",
        }),
      })
      .optional(),
    review: z
      .strictObject({
        additional_excludes: z
          .array(globSchema)
          .max(50)
          .optional()
          .describe(
            "Additional exclusions; universal globs and protected paths are rejected by runtime policy validation.",
          ),
        focus: z
          .array(reviewFocusSchema)
          .max(5)
          .optional()
          .describe(
            "Review priorities. Other defect categories remain enabled.",
          ),
        reference_files: z
          .array(configPathSchema)
          .max(32)
          .optional()
          .describe(
            "Context documents relative to repository root; not instructions.",
          ),
      })
      .optional(),
    verdict: z
      .strictObject({
        strictness: z
          .enum(["default", "block_all_confident_medium"])
          .optional()
          .meta({ default: "default" }),
      })
      .optional(),
    instructions: instructions.optional(),
    projects: z
      .array(
        z.strictObject({
          name: label,
          root: configRootSchema.describe(
            "Project root relative to repository root. The deepest matching root governs each path.",
          ),
          description: text(repositoryConfigLimits.descriptionBytes).optional(),
          compatibility: projectCompatibilitySchema
            .optional()
            .describe(
              "Maintainer-declared compatibility; never replaces detected version evidence. Quote all version values.",
            ),
          instructions: instructions.optional(),
        }),
      )
      .max(repositoryConfigLimits.projects)
      .optional(),
    path_rules: z
      .array(
        z.strictObject({
          paths: z.array(globSchema).min(1).max(20),
          instructions,
        }),
      )
      .max(repositoryConfigLimits.pathRules)
      .optional(),
  })
  .describe(
    "Holon repository configuration. One current contract; read from the PR base SHA. Unknown properties are rejected.",
  );

export type RepositoryConfigInput = z.infer<typeof repositoryConfigInputSchema>;
export type InstructionEntry = z.infer<typeof instructionEntrySchema>;
