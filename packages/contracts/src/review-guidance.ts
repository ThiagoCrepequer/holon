import { z } from "zod";

import { repositoryPathSchema } from "./shared.js";
const root = z.union([z.literal("."), repositoryPathSchema]);
const instructions = z.array(z.string().trim().min(1).max(1000)).max(8);
export const documentationHosts = [
  "nodejs.org",
  "www.typescriptlang.org",
  "react.dev",
  "nextjs.org",
  "docs.python.org",
  "docs.oracle.com",
  "quarkus.io",
  "docs.spring.io",
  "developer.mozilla.org",
  "developers.cloudflare.com",
] as const;
export const documentationReferenceSchema = z.strictObject({
  root,
  technology: z.string().min(1).max(100),
  version: z.string().min(1).max(100),
  url: z
    .url()
    .max(1000)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.search &&
        !url.hash &&
        documentationHosts.some((host) => host === url.hostname)
      );
    }, "Documentation must use a supported official HTTPS host without credentials, query or fragment"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const projectReviewGuidanceSchema = z.strictObject({
  root,
  instructions: instructions.optional(),
  compatibility: z
    .record(z.string().min(1).max(100), z.string().min(1).max(100))
    .refine((value) => Object.keys(value).length <= 20)
    .optional(),
});
export const repositoryReviewGuidanceSchema = z.strictObject({
  instructions: instructions.optional(),
  projects: z.array(projectReviewGuidanceSchema).max(20).optional(),
  documentation: z.array(documentationReferenceSchema).max(4).optional(),
});
export const resolvedReviewGuidanceSchema = z.strictObject({
  instructions,
  projects: z.array(projectReviewGuidanceSchema).max(20),
  documentation: z
    .array(
      documentationReferenceSchema.extend({ content: z.string().max(8000) }),
    )
    .max(4),
  limitations: z.array(z.string().max(300)).max(10),
});
export type ResolvedReviewGuidance = z.infer<
  typeof resolvedReviewGuidanceSchema
>;
