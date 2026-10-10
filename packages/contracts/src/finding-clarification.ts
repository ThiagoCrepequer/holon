import { z } from "zod";

import { trackedFindingSchema } from "./finding-lifecycle.js";
import { feedbackCommentEventSchema } from "./follow-up.js";
import { repositoryPolicyGlobSchema } from "./repository-policy.js";
import {
  gitShaSchema,
  positiveIntegerSchema,
  prKeySchema,
  repositoryPathSchema,
  runIdSchema,
} from "./shared.js";

export const clarificationLimits = {
  questionCharacters: 4000,
  deadlineMs: 5 * 60_000,
  publicationRetryMs: 24 * 60 * 60_000,
  toolCalls: 8,
  fileBytes: 65_536,
  readBytes: 65_536,
  readLines: 200,
  generationCalls: 8,
  inputBytes: 300_000,
  outputTokens: 16_000,
  turnOutputTokens: 2000,
  questionsPerHead: 20,
  questionsPerFinding: 5,
} as const;
export const clarificationAnswerSchema = z.strictObject({
  outcome: z.enum(["confirmed", "narrowed", "refuted", "inconclusive"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string().trim().min(1).max(5000),
  scenario: z.string().trim().min(1).max(2000),
  evidence: z
    .array(
      z
        .strictObject({
          path: repositoryPathSchema,
          startLine: positiveIntegerSchema,
          endLine: positiveIntegerSchema,
          excerpt: z.string().min(1).max(2000),
        })
        .refine(
          (evidence) =>
            evidence.endLine >= evidence.startLine &&
            evidence.endLine - evidence.startLine < 200,
        ),
    )
    .max(6),
});
export type ClarificationAnswer = z.infer<typeof clarificationAnswerSchema>;
export const clarificationHistorySchema = z
  .array(
    z.strictObject({
      question: z.string().min(1).max(clarificationLimits.questionCharacters),
      outcome: clarificationAnswerSchema.shape.outcome,
      explanation: clarificationAnswerSchema.shape.explanation,
      scenario: clarificationAnswerSchema.shape.scenario,
    }),
  )
  .max(2);
export type ClarificationHistory = z.infer<typeof clarificationHistorySchema>;
export const clarificationReadSchema = z.strictObject({
  path: repositoryPathSchema,
  startLine: positiveIntegerSchema,
  content: z.string().max(clarificationLimits.readBytes),
});
export type ClarificationRead = z.infer<typeof clarificationReadSchema>;
export const clarificationAdmissionSchema = z.strictObject({
  event: feedbackCommentEventSchema,
  question: z
    .string()
    .trim()
    .min(1)
    .max(clarificationLimits.questionCharacters),
  headSha: gitShaSchema,
  baseSha: gitShaSchema,
  additionalExcludes: z.array(repositoryPolicyGlobSchema).max(100),
});
export type ClarificationAdmission = z.infer<
  typeof clarificationAdmissionSchema
>;
export const clarificationRecordSchema = z.strictObject({
  id: positiveIntegerSchema,
  prKey: prKeySchema,
  event: feedbackCommentEventSchema,
  question: z.string().min(1).max(clarificationLimits.questionCharacters),
  headSha: gitShaSchema,
  baseSha: gitShaSchema,
  additionalExcludes: z.array(repositoryPolicyGlobSchema).max(100),
  runId: runIdSchema,
  finding: trackedFindingSchema,
  language: z.enum(["en", "pt-BR", "es"]),
  deadlineAt: z.number().int().positive(),
  state: z.enum(["pending", "answered", "published", "obsolete"]),
  answer: clarificationAnswerSchema.optional(),
  correctionApplied: z.boolean(),
  replyCommentId: z.optional(positiveIntegerSchema),
});
export type ClarificationRecord = z.infer<typeof clarificationRecordSchema>;
export const clarificationAgentConfigSchema = z.strictObject({
  prKey: prKeySchema,
  questionId: positiveIntegerSchema,
});
export type ClarificationAgentConfig = z.infer<
  typeof clarificationAgentConfigSchema
>;

const user = z.object({
  login: z.string().min(1).max(100),
  type: z.enum(["User", "Bot", "Organization"]),
});
export const findingDiscussionCommentSchema = z.object({
  id: positiveIntegerSchema,
  body: z.string().max(65536),
  path: repositoryPathSchema,
  commit_id: gitShaSchema,
  in_reply_to_id: z.optional(positiveIntegerSchema),
  pull_request_url: z.string().max(1000),
  user,
});
export const findingDiscussionPullRequestSchema = z.object({
  number: positiveIntegerSchema,
  state: z.enum(["open", "closed"]),
  user,
  head: z.object({ sha: gitShaSchema }),
  base: z.object({ sha: gitShaSchema }),
});
export type FindingDiscussionComment = z.infer<
  typeof findingDiscussionCommentSchema
>;
export type FindingDiscussionPullRequest = z.infer<
  typeof findingDiscussionPullRequestSchema
>;
