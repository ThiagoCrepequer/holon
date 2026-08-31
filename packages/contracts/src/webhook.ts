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

const actionSchema = z.enum(pullRequestActions);
const repositorySchema = z
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
  );

const envelopeShape = {
  action: actionSchema,
  deliveryId: deliveryIdSchema,
  event: z.literal("pull_request"),
  installationId: positiveIntegerSchema,
  receivedAt: z.iso.datetime({ offset: true }),
  repository: repositorySchema,
} as const;

export const webhookEnvelopeV1Schema = z.strictObject({
  ...envelopeShape,
  pullRequest: z.strictObject({
    baseSha: gitShaSchema,
    headSha: gitShaSchema,
    number: positiveIntegerSchema,
  }),
  schemaVersion: z.literal(1),
});

export const webhookEnvelopeV2Schema = z.strictObject({
  ...envelopeShape,
  pullRequest: z.strictObject({
    baseSha: gitShaSchema,
    headSha: gitShaSchema,
    number: positiveIntegerSchema,
    updatedAt: z.iso.datetime({ offset: true }),
  }),
  schemaVersion: z.literal(2),
});

export const webhookEnvelopeSchema = z.union([
  webhookEnvelopeV2Schema,
  webhookEnvelopeV1Schema,
]);

export const reviewJobV1Schema = z
  .strictObject({
    envelope: webhookEnvelopeV1Schema,
    runId: runIdSchema,
    schemaVersion: z.literal(1),
  })
  .superRefine(validateReviewJobIdentity);

export const reviewJobV2Schema = z
  .strictObject({
    envelope: webhookEnvelopeV2Schema,
    runId: runIdSchema,
    schemaVersion: z.literal(2),
  })
  .superRefine(validateReviewJobIdentity);

function validateReviewJobIdentity(
  job: {
    readonly envelope: {
      readonly pullRequest: {
        readonly headSha: string;
        readonly number: number;
      };
      readonly repository: { readonly id: number };
    };
    readonly runId: string;
  },
  context: z.core.$RefinementCtx,
): void {
  const expected = `github:${job.envelope.repository.id}:pr:${job.envelope.pullRequest.number}:head:${job.envelope.pullRequest.headSha}`;
  if (job.runId !== expected) {
    context.addIssue({
      code: "custom",
      input: job.runId,
      message: "runId does not match the webhook coordinates",
      path: ["runId"],
    });
  }
}

export const reviewJobSchema = z.union([reviewJobV2Schema, reviewJobV1Schema]);

export type WebhookEnvelopeV1 = z.infer<typeof webhookEnvelopeV1Schema>;
export type WebhookEnvelopeV2 = z.infer<typeof webhookEnvelopeV2Schema>;
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;
export type ReviewJobV1 = z.infer<typeof reviewJobV1Schema>;
export type ReviewJobV2 = z.infer<typeof reviewJobV2Schema>;
export type ReviewJob = z.infer<typeof reviewJobSchema>;
