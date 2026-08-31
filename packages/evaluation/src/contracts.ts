import {
  modelReviewOutputSchema,
  reviewContextV2Schema,
  reviewFindingSchema,
  reviewJobSchema,
} from "@holon/contracts";
import { z } from "zod";

const evalIdentifierSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);

export const evalRunConfigurationSchema = z.strictObject({
  corpusVersion: evalIdentifierSchema,
  policyVersion: evalIdentifierSchema,
  promptVersion: evalIdentifierSchema,
  subjectVersion: evalIdentifierSchema,
});

const diagnosticTermSchema = z.string().trim().min(2).max(100);

const uniqueTermsSchema = z
  .array(diagnosticTermSchema)
  .max(20)
  .refine(
    (terms) =>
      new Set(terms.map((term) => term.toLocaleLowerCase("en-US"))).size ===
      terms.length,
    "diagnostic terms must be unique ignoring case",
  );

export const expectedFindingSchema = z.strictObject({
  id: evalIdentifierSchema,
  location: reviewFindingSchema.shape.location,
  minimumConfidence: z.number().min(0).max(1).optional(),
  requiredDiagnosticTerms: uniqueTermsSchema.default([]),
  severity: reviewFindingSchema.shape.severity,
  suggestionRequired: z.boolean().default(false),
});

const syntheticSourceSchema = z.strictObject({
  kind: z.literal("synthetic"),
  reviewedAt: z.iso.date(),
});

const publicHttpsUrlSchema = z.url({ protocol: /^https$/u }).refine((value) => {
  const authority = value.slice("https://".length).split(/[/?#]/u, 1)[0];
  return authority !== undefined && !authority.includes("@");
}, "public source URL must not contain credentials");

const publicSourceSchema = z.strictObject({
  kind: z.literal("public"),
  license: z.string().trim().min(1).max(100),
  reviewedAt: z.iso.date(),
  url: publicHttpsUrlSchema,
});

export const evalCaseSchema = z
  .strictObject({
    category: z.enum([
      "correctness",
      "security",
      "maintainability",
      "reliability",
      "no-finding",
      "budget",
      "adversarial",
    ]),
    expected: z.strictObject({
      findings: z.array(expectedFindingSchema).max(3),
      forbiddenOutputTerms: uniqueTermsSchema.default([]),
      partial: z.boolean(),
      requiredSummaryTerms: uniqueTermsSchema.default([]),
    }),
    id: evalIdentifierSchema,
    input: z.strictObject({
      context: reviewContextV2Schema,
      job: reviewJobSchema,
    }),
    schemaVersion: z.literal(1),
    partition: z.enum(["development", "holdout"]),
    source: z.discriminatedUnion("kind", [
      syntheticSourceSchema,
      publicSourceSchema,
    ]),
    tags: z
      .array(evalIdentifierSchema)
      .max(20)
      .refine((tags) => new Set(tags).size === tags.length, {
        message: "tags must be unique",
      }),
    title: z.string().trim().min(1).max(160),
  })
  .superRefine((evalCase, context) => {
    const findingIds = evalCase.expected.findings.map((finding) => finding.id);
    if (new Set(findingIds).size !== findingIds.length) {
      context.addIssue({
        code: "custom",
        message: "expected finding ids must be unique",
        path: ["expected", "findings"],
      });
    }

    const headSha = evalCase.input.job.envelope.pullRequest.headSha;
    if (!evalCase.input.job.runId.endsWith(`:head:${headSha}`)) {
      context.addIssue({
        code: "custom",
        message: "evaluation job runId must identify its head SHA",
        path: ["input", "job", "runId"],
      });
    }

    const changedLines = new Set(
      evalCase.input.context.changedLines.map(
        (line) => `${line.path}:${line.line}:${line.side}`,
      ),
    );
    for (const [index, finding] of evalCase.expected.findings.entries()) {
      const key = `${finding.location.path}:${finding.location.line}:${finding.location.side}`;
      if (!changedLines.has(key)) {
        context.addIssue({
          code: "custom",
          message: "expected finding must target a changed line",
          path: ["expected", "findings", index, "location"],
        });
      }
    }
  });

export const evalSubjectOutputSchema = z.strictObject({
  output: modelReviewOutputSchema,
  partial: z.boolean(),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalRunConfiguration = z.infer<typeof evalRunConfigurationSchema>;
export type EvalSubjectOutput = z.infer<typeof evalSubjectOutputSchema>;
export type ExpectedFinding = z.infer<typeof expectedFindingSchema>;
