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
  "edited",
  "closed",
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

export const webhookEnvelopeSchema = z.strictObject({
  ...envelopeShape,
  pullRequest: z.strictObject({
    baseSha: gitShaSchema,
    headSha: gitShaSchema,
    number: positiveIntegerSchema,
    title: z.string().max(1024),
    author: z.string().min(1).max(100),
    state: z.enum(["open", "closed", "merged"]),
    updatedAt: z.iso.datetime({ offset: true }),
  }),
});

export const reviewJobSchema = z
  .strictObject({
    envelope: webhookEnvelopeSchema,
    runId: runIdSchema,
  })
  .superRefine(validateReviewJobIdentity);

function validateReviewJobIdentity(
  job: {
    readonly envelope: {
      readonly pullRequest: {
        readonly headSha: string;
        readonly baseSha: string;
        readonly number: number;
      };
      readonly repository: { readonly id: number };
    };
    readonly runId: string;
  },
  context: z.core.$RefinementCtx,
): void {
  const expected = `github:${job.envelope.repository.id}:pr:${job.envelope.pullRequest.number}:head:${job.envelope.pullRequest.headSha}:base:${job.envelope.pullRequest.baseSha}`;
  if (job.runId !== expected) {
    context.addIssue({
      code: "custom",
      input: job.runId,
      message: "runId does not match the webhook coordinates",
      path: ["runId"],
    });
  }
}

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export type ReviewJob = z.infer<typeof reviewJobSchema>;
