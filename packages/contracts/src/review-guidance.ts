import { z } from "zod";

import { repositoryPathSchema } from "./shared.js";
const root = z.union([z.literal("."), repositoryPathSchema]);
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
export type DocumentationReference = z.infer<
  typeof documentationReferenceSchema
>;
export const resolvedReviewGuidanceSchema = z.strictObject({
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
