import { z } from "zod";

import {
  gitShaSchema,
  positiveIntegerSchema,
  repositoryPathSchema,
  runIdSchema,
  timestampSchema,
} from "./shared.js";

export const memoryLimits = {
  rules: 64,
  observations: 10_000,
  snapshotObservations: 16,
  snapshotBytes: 64_000,
  shardBytes: 16_000,
  observationDays: 90,
  snapshotDays: 30,
  ruleDays: 180,
  recurrencePrs: 3,
} as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const memoryRootSchema = z.union([z.literal("."), repositoryPathSchema]);
export const memoryIdentitySchema = z.strictObject({
  installationId: positiveIntegerSchema,
  repositoryId: positiveIntegerSchema,
});
export const memoryRunIdentitySchema = memoryIdentitySchema
  .extend({
    runId: runIdSchema,
    pullRequestNumber: positiveIntegerSchema,
    headSha: gitShaSchema,
    baseSha: gitShaSchema,
  })
  .refine(
    (identity) =>
      identity.runId ===
      `github:${identity.repositoryId}:pr:${identity.pullRequestNumber}:head:${identity.headSha}:base:${identity.baseSha}`,
    "Memory run identity mismatch",
  );
export const memoryObservationSchema = z
  .strictObject({
    id: z.string().min(1).max(512),
    kind: z.enum(["finding", "investigation", "feedback"]),
    source: memoryRunIdentitySchema,
    path: repositoryPathSchema,
    line: positiveIntegerSchema.optional(),
    summary: z.string().trim().min(1).max(1500),
    createdAt: timestampSchema,
    fingerprint: z
      .string()
      .regex(/^fp:[a-f0-9]{64}$/u)
      .optional(),
    feedbackReason: z.string().trim().min(1).max(1000).optional(),
    authorLogin: z.string().min(1).max(100).optional(),
    commentId: positiveIntegerSchema.optional(),
    label: z
      .enum([
        "helpful",
        "false_positive",
        "wrong_severity",
        "duplicate",
        "not_actionable",
        "missed_defect",
        "thread_resolved",
      ])
      .optional(),
  })
  .refine(
    (record) =>
      record.kind !== "feedback" ||
      (record.authorLogin !== undefined &&
        record.commentId !== undefined &&
        record.label !== undefined),
    "Feedback requires human provenance",
  );
export const memoryRuleSchema = z.strictObject({
  id: digest,
  digest,
  topic: digest,
  root: memoryRootSchema,
  guidance: z.string().trim().min(10).max(1500),
  evidence: z.array(memoryObservationSchema).min(1).max(8),
  supersedes: digest.optional(),
  state: z.enum(["proposed", "active", "rejected", "revoked", "superseded"]),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  decidedBy: z.string().min(1).max(100).optional(),
  decidedAt: timestampSchema.optional(),
});
export const memorySnapshotSchema = z
  .strictObject({
    identity: memoryRunIdentitySchema,
    memoryName: z.string().min(1).max(200),
    revision: z.number().int().nonnegative().safe(),
    capturedAt: timestampSchema,
    expiresAt: timestampSchema,
    rules: z.array(memoryRuleSchema).max(memoryLimits.rules),
    observations: z
      .array(memoryObservationSchema)
      .max(memoryLimits.snapshotObservations),
  })
  .refine((snapshot) => {
    const sameRepository = (item: MemoryObservation) =>
      item.source.installationId === snapshot.identity.installationId &&
      item.source.repositoryId === snapshot.identity.repositoryId;
    return (
      snapshot.observations.every(sameRepository) &&
      snapshot.rules.every(
        (rule) =>
          rule.state === "active" &&
          rule.decidedBy !== undefined &&
          rule.decidedAt !== undefined &&
          rule.evidence.every(sameRepository),
      )
    );
  }, "Memory snapshot contains unapproved or foreign-repository content");
export const memoryRecordResultSchema = z.enum([
  "recorded",
  "expired",
  "capacity_exceeded",
]);
export const memoryDecisionSchema = z.strictObject({
  deliveryId: z.string().regex(/^github:[A-Za-z0-9._:-]+$/u),
  action: z.enum(["approve", "reject", "revoke"]),
  id: digest,
  digest,
  authorLogin: z.string().trim().min(1).max(100),
});
export const memoryDecisionReceiptSchema = z.strictObject({
  input: memoryDecisionSchema,
  result: memoryRuleSchema,
});
export const memoryDeliverySchema = z.strictObject({
  memoryName: z.string().min(1).max(200),
  observation: memoryObservationSchema,
});
export const investigationObservationSchema = z.strictObject({
  summary: z.string().trim().min(30).max(1000),
  path: repositoryPathSchema,
  line: positiveIntegerSchema,
  excerpt: z.string().min(1).max(1000),
});
export const memoryCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({
    action: z.literal("propose"),
    root: memoryRootSchema,
    guidance: z.string().trim().min(10).max(1500),
    supersedes: digest.optional(),
  }),
  z.strictObject({
    action: z.enum(["approve", "reject", "revoke", "inspect"]),
    id: digest,
    digest,
  }),
]);
export type MemoryCommand = z.infer<typeof memoryCommandSchema>;
export type MemoryIdentity = z.infer<typeof memoryIdentitySchema>;
export type MemoryRunIdentity = z.infer<typeof memoryRunIdentitySchema>;
export type MemoryObservation = z.infer<typeof memoryObservationSchema>;
export type MemoryRule = z.infer<typeof memoryRuleSchema>;
export type MemorySnapshot = z.infer<typeof memorySnapshotSchema>;
export type MemoryDelivery = z.infer<typeof memoryDeliverySchema>;
export type InvestigationObservation = z.infer<
  typeof investigationObservationSchema
>;
