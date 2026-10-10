import { z } from "zod/mini";

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

export const runIdSchema = z
  .string()
  .check(
    z.regex(
      /^github:[1-9]\d*:pr:[1-9]\d*:head:[a-f0-9]{40}:base:[a-f0-9]{40}$/u,
    ),
  );

export const repositoryPathSchema = z
  .string()
  .check(z.minLength(1))
  .check(z.maxLength(1_024))
  .check(
    z.refine((path) => {
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
    }, "Expected a normalized repository-relative path"),
  );

export const positiveIntegerSchema = z
  .number()
  .check(z.int())
  .check(z.positive());
