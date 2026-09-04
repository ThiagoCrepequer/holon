import type { PrKey, RunId } from "@holon/domain";
import { z } from "zod";

export type { PrKey, RunId };

export const gitShaSchema = z
  .string()
  .regex(/^[a-f0-9]{40}$/u, "Expected a lowercase 40-character Git object ID");
export const deliveryIdSchema = z.string().regex(/^github:[A-Za-z0-9._:-]+$/u);
export const prKeySchema = z.string().regex(/^github:[1-9]\d*:pr:[1-9]\d*$/u);
export const runIdSchema = z
  .string()
  .regex(/^github:[1-9]\d*:pr:[1-9]\d*:head:[a-f0-9]{40}$/u);
export const findingIdSchema = z.string().regex(/^finding:[a-f0-9]{64}$/u);
export const publicationIdSchema = z
  .string()
  .regex(
    /^github:[1-9]\d*:pr:[1-9]\d*:head:[a-f0-9]{40}:publication:(?:finding:[a-f0-9]{64}|summary)$/u,
  );

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

export const repositoryPathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((path) => {
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      containsControlCharacter(path)
    )
      return false;
    const segments = path.split("/");
    return segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    );
  }, "Expected a normalized repository-relative path");

export const positiveIntegerSchema = z.number().int().positive().safe();
export const timestampSchema = z.iso.datetime({ offset: true });
