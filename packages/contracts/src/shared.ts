import type { PrKey, RunId } from "@holon/domain";
import { z } from "zod";

export type { PrKey, RunId };

export const gitShaSchema = z
  .string()
  .regex(/^[a-f0-9]{40}$/u, "Expected a lowercase 40-character Git object ID");
export const deliveryIdSchema = z.string().regex(/^github:[A-Za-z0-9._:-]+$/u);
export const prKeySchema = z.string().regex(/^github:[1-9]\d*:pr:[1-9]\d*$/u);

export const findingIdSchema = z.string().regex(/^finding:[a-f0-9]{64}$/u);
export const publicationIdSchema = z
  .string()
  .regex(
    /^github:[1-9]\d*:pr:[1-9]\d*:head:[a-f0-9]{40}:base:[a-f0-9]{40}:publication:(?:finding:[a-f0-9]{64}|summary)$/u,
  );

export const nonNegativeIntegerSchema = z.number().int().nonnegative().safe();
export const timestampSchema = z.iso.datetime({ offset: true });

export {
  runIdSchema,
  repositoryPathSchema,
  positiveIntegerSchema,
} from "./review-primitives.js";
