import { z } from "zod/mini";

import { reviewTextLimits } from "./review-limits.js";
import {
  positiveIntegerSchema,
  repositoryPathSchema,
} from "./review-primitives.js";

export const reviewFindingSchema = z.strictObject({
  confidence: z.number().check(z.gte(0)).check(z.lte(1)),
  diagnostic: z
    .string()
    .check(z.trim())
    .check(z.minLength(30))
    .check(z.maxLength(reviewTextLimits.diagnostic)),
  evidence: z
    .array(
      z
        .strictObject({
          endLine: z.optional(positiveIntegerSchema),
          excerpt: z
            .string()
            .check(z.minLength(1))
            .check(z.maxLength(reviewTextLimits.excerpt)),
          path: repositoryPathSchema,
          reason: z
            .string()
            .check(z.minLength(1))
            .check(z.maxLength(reviewTextLimits.reason)),
          startLine: positiveIntegerSchema,
        })
        .check(
          z.refine(
            (evidence) =>
              evidence.endLine === undefined ||
              evidence.endLine >= evidence.startLine,
            {
              message: "endLine must not precede startLine",
              path: ["endLine"],
            },
          ),
        ),
    )
    .check(z.minLength(1))
    .check(z.maxLength(reviewTextLimits.evidence)),
  location: z
    .strictObject({
      line: positiveIntegerSchema,
      path: repositoryPathSchema,
      side: z.literal("RIGHT"),
      startLine: z.optional(positiveIntegerSchema),
    })
    .check(
      z.refine(
        (location) =>
          location.startLine === undefined ||
          location.startLine <= location.line,
        {
          message: "startLine must not follow line",
          path: ["startLine"],
        },
      ),
    ),
  severity: z.enum(["critical", "high", "medium", "low"]),
  suggestion: z.optional(
    z
      .string()
      .check(z.trim())
      .check(z.minLength(1))
      .check(z.maxLength(reviewTextLimits.suggestion)),
  ),
});
