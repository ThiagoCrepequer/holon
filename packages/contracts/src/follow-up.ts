import { z } from "zod";

import { deliveryIdSchema, positiveIntegerSchema } from "./shared.js";
const repository = z.strictObject({
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
});
const feedbackBase = {
  deliveryId: deliveryIdSchema.transform(
    (value) => value as `github:${string}`,
  ),
  installationId: positiveIntegerSchema,
  pullRequestNumber: positiveIntegerSchema,
  repository: repository
    .extend({ fullName: z.string().min(1).max(201) })
    .refine((value) => value.fullName === `${value.owner}/${value.name}`),
  authorLogin: z.string().min(1).max(100),
};
export const feedbackCommentEventSchema = z.strictObject({
  ...feedbackBase,
  action: z.literal("created"),
  authorAssociation: z.string().max(40).optional(),
  body: z.string().max(65536),
  commentId: positiveIntegerSchema,
  createdAt: z.iso.datetime(),
  inReplyToId: z.optional(positiveIntegerSchema),
});
export const feedbackThreadEventSchema = z.strictObject({
  ...feedbackBase,
  action: z.literal("resolved"),
  rootCommentId: positiveIntegerSchema,
});
export const followUpMessageSchema = z
  .discriminatedUnion("event", [
    z.strictObject({
      event: z.literal("feedback_comment"),
      payload: feedbackCommentEventSchema,
    }),
    z.strictObject({
      event: z.literal("feedback_thread"),
      payload: feedbackThreadEventSchema,
    }),
  ])
  .refine(
    (message) =>
      new TextEncoder().encode(JSON.stringify(message)).length <= 120000,
    "Follow-up exceeds queue byte budget",
  );
export type FollowUpMessage = z.infer<typeof followUpMessageSchema>;
