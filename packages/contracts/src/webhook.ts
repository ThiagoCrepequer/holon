import { z } from "zod";

import {
  deliveryIdSchema,
  gitShaSchema,
  positiveIntegerSchema,
  runIdSchema,
} from "./shared.js";

export const pullRequestActions = [
  "opened",
  "reopened",
  "synchronize",
] as const;

export const webhookEnvelopeSchema = z.strictObject({
  action: z.enum(pullRequestActions),
  deliveryId: deliveryIdSchema,
  event: z.literal("pull_request"),
  installationId: positiveIntegerSchema,
  pullRequest: z.strictObject({
    baseSha: gitShaSchema,
    headSha: gitShaSchema,
    number: positiveIntegerSchema,
  }),
  receivedAt: z.iso.datetime({ offset: true }),
  repository: z
    .strictObject({
      fullName: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/u),
      id: positiveIntegerSchema,
      name: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[A-Za-z0-9_.-]+$/u)
        .refine((name) => name !== "." && name !== ".."),
      owner: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[A-Za-z0-9-]+$/u),
    })
    .refine(
      (repository) =>
        repository.fullName === `${repository.owner}/${repository.name}`,
      { message: "fullName must match owner and name", path: ["fullName"] },
    ),
  schemaVersion: z.literal(1),
});

export const reviewJobSchema = z
  .strictObject({
    envelope: webhookEnvelopeSchema,
    runId: runIdSchema,
    schemaVersion: z.literal(1),
  })
  .superRefine((job, context) => {
    const expected = `github:${job.envelope.repository.id}:pr:${job.envelope.pullRequest.number}:head:${job.envelope.pullRequest.headSha}`;
    if (job.runId !== expected) {
      context.addIssue({
        code: "custom",
        message: "runId does not match the webhook coordinates",
        path: ["runId"],
      });
    }
  });

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;
export type ReviewJob = z.infer<typeof reviewJobSchema>;
