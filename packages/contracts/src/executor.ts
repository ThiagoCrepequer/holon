import { z } from "zod";

import {
  gitShaSchema,
  positiveIntegerSchema,
  repositoryPathSchema,
  runIdSchema,
} from "./shared.js";

const maxResultsSchema = z.number().int().min(1).max(100);

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
  language: z.enum(["typescript", "tsx", "javascript", "jsx"]),
  maxResults: maxResultsSchema,
  pattern: z.string().min(2).max(1_000),
  paths: z.array(repositoryPathSchema).max(20).optional(),
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

export const reviewContextSchema = z.strictObject({
  changedLines: z
    .array(
      z.strictObject({
        line: positiveIntegerSchema,
        path: repositoryPathSchema,
        side: z.literal("RIGHT"),
      }),
    )
    .max(20_000),
  diff: z.string().max(2_000_000),
  surface: z
    .array(
      z.strictObject({
        change: z.enum(["added", "removed"]),
        excerpt: z.string().min(1).max(300),
        kind: z.enum(["contract", "control_flow", "persistence", "security"]),
        line: positiveIntegerSchema,
        path: repositoryPathSchema,
      }),
    )
    .max(100)
    .optional(),
  truncated: z.boolean().optional(),
});

export const preparedRepositorySchema = z.strictObject({
  changedLineCount: z.number().int().nonnegative().max(20_000),
  contextBytes: positiveIntegerSchema.max(30_000_000),
  fileCount: z.number().int().nonnegative().max(100),
  runId: runIdSchema,
  schemaVersion: z.literal(1),
  truncated: z.boolean(),
});

const githubCloneUrlSchema = z
  .url({ protocol: /^https$/u, hostname: /^github\.com$/iu })
  .regex(
    /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\.git$/u,
    "Expected a credential-free GitHub HTTPS clone URL",
  );

export const executorRequestSchema = z
  .strictObject({
    baseSha: gitShaSchema,
    cloneUrl: githubCloneUrlSchema,
    headSha: gitShaSchema,
    pullRequestNumber: positiveIntegerSchema,
    repositoryId: positiveIntegerSchema,
    runId: runIdSchema,
    schemaVersion: z.literal(1),
  })
  .superRefine((request, context) => {
    if (
      !request.runId.startsWith(
        `github:${request.repositoryId}:pr:${request.pullRequestNumber}:`,
      ) ||
      !request.runId.endsWith(`:head:${request.headSha}`)
    ) {
      context.addIssue({
        code: "custom",
        message: "runId does not match repositoryId and headSha",
        path: ["runId"],
      });
    }
  });

export type RepositoryToolCall = z.infer<typeof repositoryToolCallSchema>;
export type RepositoryToolResult = z.infer<typeof repositoryToolResultSchema>;
export type ReviewContext = z.infer<typeof reviewContextSchema>;
export type PreparedRepository = z.infer<typeof preparedRepositorySchema>;
export type ExecutorRequest = z.infer<typeof executorRequestSchema>;
