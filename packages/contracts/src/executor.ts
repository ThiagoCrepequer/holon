import { z } from "zod";

import { projectIdentificationResultSchema } from "./project-identification.js";
import {
  repositoryPolicySchema,
  repositoryPolicySourceSchema,
  repositoryVerdictStrictnessSchema,
} from "./repository-policy.js";
import {
  gitShaSchema,
  positiveIntegerSchema,
  repositoryPathSchema,
  runIdSchema,
  timestampSchema,
} from "./shared.js";
import { structuralImpactReportSchema } from "./structural-analysis.js";

const maxResultsSchema = z.number().int().min(1).max(100);

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}

export const readFileArgumentsSchema = z
  .strictObject({
    endLine: positiveIntegerSchema.optional(),
    path: repositoryPathSchema,
    startLine: positiveIntegerSchema.optional(),
  })
  .superRefine((input, context) => {
    const startLine = input.startLine ?? 1;
    const endLine = input.endLine ?? startLine + 199;
    if (
      input.endLine !== undefined &&
      input.startLine !== undefined &&
      input.endLine < input.startLine
    ) {
      context.addIssue({
        code: "custom",
        message: "endLine must not precede startLine",
        path: ["endLine"],
      });
    }
    if (endLine - startLine + 1 > 500) {
      context.addIssue({
        code: "custom",
        message: "read_file is limited to 500 lines",
        path: ["endLine"],
      });
    }
  });

export const readFileToolSchema = z.strictObject({
  arguments: readFileArgumentsSchema,
  name: z.literal("read_file"),
});

export const searchTextArgumentsSchema = z.strictObject({
  maxResults: maxResultsSchema,
  paths: z.array(repositoryPathSchema).max(20).optional(),
  query: z.string().min(2).max(500),
});

export const searchTextToolSchema = z.strictObject({
  arguments: searchTextArgumentsSchema,
  name: z.literal("search_text"),
});

export const searchStructureArgumentsSchema = z.strictObject({
  language: z.enum([
    "typescript",
    "tsx",
    "javascript",
    "jsx",
    "python",
    "go",
    "rust",
    "java",
    "csharp",
    "ruby",
    "php",
    "kotlin",
  ]),
  maxResults: maxResultsSchema,
  paths: z.array(repositoryPathSchema).max(20).optional(),
  pattern: z.string().min(2).max(1_000),
});

export const searchStructureToolSchema = z.strictObject({
  arguments: searchStructureArgumentsSchema,
  name: z.literal("search_structure"),
});

export const repositoryToolCallSchema = z.discriminatedUnion("name", [
  readFileToolSchema,
  searchTextToolSchema,
  searchStructureToolSchema,
]);

export const repositoryToolResultSchema = z.strictObject({
  content: z.string().max(100_000),
  truncated: z.boolean(),
});

export const reviewFileModeSchema = z.enum(["structural", "textual"]);

export const changedLinesSchema = z
  .array(
    z.strictObject({
      line: positiveIntegerSchema,
      path: repositoryPathSchema,
      side: z.literal("RIGHT"),
    }),
  )
  .max(5_000);

export const reviewSurfaceSchema = z
  .array(
    z.strictObject({
      change: z.enum(["added", "removed"]),
      excerpt: z.string().min(1).max(300),
      kind: z.enum(["contract", "control_flow", "persistence", "security"]),
      line: positiveIntegerSchema,
      path: repositoryPathSchema,
    }),
  )
  .max(50)
  .optional();

export const reviewContextFileSchema = z.strictObject({
  mode: reviewFileModeSchema,
  patch: z.string().min(1).max(120_000),
  path: repositoryPathSchema,
});

/**
 * Shard context keeps complete per-file patches so downstream prompt construction can omit
 * a whole patch instead of slicing a canonical Git hunk.
 */
export const reviewShardContextSchema = z
  .strictObject({
    projectIdentification: projectIdentificationResultSchema.optional(),
    changedLines: changedLinesSchema,
    files: z.array(reviewContextFileSchema).max(50),
    structuralImpact: structuralImpactReportSchema.optional(),
    surface: reviewSurfaceSchema,
    truncated: z.boolean(),
  })
  .superRefine((context, refinement) => {
    const modes = new Map(
      context.files.map((file) => [file.path, file.mode] as const),
    );
    const paths = new Set(modes.keys());
    if (paths.size !== context.files.length) {
      refinement.addIssue({
        code: "custom",
        message: "reviewed file paths must be unique",
        path: ["files"],
      });
    }
    const patchBytes = context.files.reduce(
      (total, file) => total + utf8ByteLength(file.patch),
      0,
    );
    if (patchBytes > 120_000) {
      refinement.addIssue({
        code: "custom",
        message: "review context patches exceed the 120000-byte budget",
        path: ["files"],
      });
    }
    for (const [index, changedLine] of context.changedLines.entries()) {
      if (!paths.has(changedLine.path)) {
        refinement.addIssue({
          code: "custom",
          message: "changed line path must identify a reviewed file",
          path: ["changedLines", index, "path"],
        });
      }
    }
    for (const [index, signal] of (context.surface ?? []).entries()) {
      if (modes.get(signal.path) !== "structural") {
        refinement.addIssue({
          code: "custom",
          message: "review surface path must identify a structural file",
          path: ["surface", index, "path"],
        });
      }
    }
  });

export const reviewContextSchema = z
  .strictObject({
    projectIdentification: projectIdentificationResultSchema.optional(),
    changedLines: changedLinesSchema,
    effectivePolicyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    files: z.array(reviewContextFileSchema).max(50),
    policySource: repositoryPolicySourceSchema,
    sourceDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    structuralImpact: structuralImpactReportSchema.optional(),
    surface: reviewSurfaceSchema,
    truncated: z.boolean(),
    verdictStrictness: repositoryVerdictStrictnessSchema,
    waiversCount: z.number().int().nonnegative(),
  })
  .superRefine((context, refinement) => {
    const modes = new Map(
      context.files.map((file) => [file.path, file.mode] as const),
    );
    const paths = new Set(modes.keys());
    if (paths.size !== context.files.length) {
      refinement.addIssue({
        code: "custom",
        message: "reviewed file paths must be unique",
        path: ["files"],
      });
    }
    const patchBytes = context.files.reduce(
      (total, file) => total + utf8ByteLength(file.patch),
      0,
    );
    if (patchBytes > 300_000) {
      refinement.addIssue({
        code: "custom",
        message: "review context patches exceed the 300000-byte budget",
        path: ["files"],
      });
    }
    for (const [index, file] of context.files.entries()) {
      if (utf8ByteLength(file.patch) > 60_000)
        refinement.addIssue({
          code: "custom",
          message: "review context file exceeds the 60000-byte budget",
          path: ["files", index, "patch"],
        });
    }
    for (const [index, changedLine] of context.changedLines.entries()) {
      if (!paths.has(changedLine.path)) {
        refinement.addIssue({
          code: "custom",
          message: "changed line path must identify a reviewed file",
          path: ["changedLines", index, "path"],
        });
      }
    }
    for (const [index, signal] of (context.surface ?? []).entries()) {
      if (modes.get(signal.path) !== "structural") {
        refinement.addIssue({
          code: "custom",
          message: "review surface path must identify a structural file",
          path: ["surface", index, "path"],
        });
      }
    }
  });
const preparedRepositoryShape = {
  changedLineCount: z.number().int().nonnegative().max(5_000),
  contextBytes: positiveIntegerSchema.max(500_000),
  fileCount: z.number().int().nonnegative().max(50),
  runId: runIdSchema,
  truncated: z.boolean(),
} as const;

export const preparedRepositorySchema = z.strictObject({
  ...preparedRepositoryShape,
  effectivePolicyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  waiversCount: z.number().int().nonnegative(),
});

const githubCloneUrlSchema = z
  .url({ protocol: /^https$/u, hostname: /^github\.com$/iu })
  .regex(
    /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\.git$/u,
    "Expected a credential-free GitHub HTTPS clone URL",
  );

const executorRequestShape = {
  baseSha: gitShaSchema,
  canonicalDiff: z.string().max(2_000_000),
  cloneUrl: githubCloneUrlSchema,
  headSha: gitShaSchema,
  pullRequestNumber: positiveIntegerSchema,
  repositoryId: positiveIntegerSchema,
  runId: runIdSchema,
} as const;

function validateRunCoordinates(
  request: {
    readonly headSha: string;
    readonly baseSha: string;
    readonly pullRequestNumber: number;
    readonly repositoryId: number;
    readonly runId: string;
  },
  context: z.core.$RefinementCtx,
): void {
  if (
    !request.runId.startsWith(
      `github:${request.repositoryId}:pr:${request.pullRequestNumber}:`,
    ) ||
    !request.runId.endsWith(`:head:${request.headSha}:base:${request.baseSha}`)
  ) {
    context.addIssue({
      code: "custom",
      message: "runId does not match repositoryId, headSha and baseSha",
      path: ["runId"],
      input: request.runId,
    });
  }
}

const repositoryOwnerSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9-]+$/u);
const repositoryNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/u)
  .refine((name) => name !== "." && name !== "..");

export const executorRequestSchema = z
  .strictObject({
    ...executorRequestShape,
    effectivePolicy: repositoryPolicySchema,
    installationId: positiveIntegerSchema,
    repositoryName: repositoryNameSchema,
    repositoryOwner: repositoryOwnerSchema,
  })
  .superRefine((request, context) => {
    validateRunCoordinates(request, context);
    if (utf8ByteLength(request.canonicalDiff) > 2_000_000) {
      context.addIssue({
        code: "custom",
        message: "canonicalDiff exceeds the 2000000-byte budget",
        path: ["canonicalDiff"],
      });
    }
    const expectedCloneUrl = `https://github.com/${request.repositoryOwner}/${request.repositoryName}.git`;
    if (request.cloneUrl !== expectedCloneUrl) {
      context.addIssue({
        code: "custom",
        message: "cloneUrl does not match repositoryOwner and repositoryName",
        path: ["cloneUrl"],
      });
    }
  });

export const githubCredentialRequestSchema = z
  .strictObject({
    containerId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    installationId: positiveIntegerSchema,
    repositoryId: positiveIntegerSchema,
    repositoryName: repositoryNameSchema,
    repositoryOwner: repositoryOwnerSchema,
    runId: runIdSchema,
  })
  .superRefine((request, context) => {
    if (!request.runId.startsWith(`github:${request.repositoryId}:pr:`)) {
      context.addIssue({
        code: "custom",
        message: "runId does not match repositoryId",
        path: ["runId"],
      });
    }
  });

export const githubCredentialResponseSchema = z.strictObject({
  expiresAt: timestampSchema,
  token: z.string().min(20).max(1_000),
});

export type RepositoryToolCall = z.infer<typeof repositoryToolCallSchema>;
export type RepositoryToolResult = z.infer<typeof repositoryToolResultSchema>;
export type ReviewFileMode = z.infer<typeof reviewFileModeSchema>;
export type ReviewContextFile = z.infer<typeof reviewContextFileSchema>;
export type ReviewSurfaceSignal = NonNullable<
  z.infer<typeof reviewSurfaceSchema>
>[number];

export type ReviewShardContext = z.infer<typeof reviewShardContextSchema>;

export type ReviewContext = z.infer<typeof reviewContextSchema>;

export type PreparedRepository = z.infer<typeof preparedRepositorySchema>;

export type ExecutorRequest = z.infer<typeof executorRequestSchema>;

export type GitHubCredentialRequest = z.infer<
  typeof githubCredentialRequestSchema
>;
export type GitHubCredentialResponse = z.infer<
  typeof githubCredentialResponseSchema
>;
