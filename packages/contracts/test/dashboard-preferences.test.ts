import { describe, expect, it } from "vitest";

import {
  personalPreferencesSchema,
  updatePreferencesInputSchema,
} from "../src/dashboard-preferences.js";

describe("personal dashboard preferences", () => {
  it.each(["en", "pt-BR"])("accepts %s with an IANA timezone", (locale) => {
    expect(
      updatePreferencesInputSchema.parse({
        locale,
        timezone: "America/Sao_Paulo",
      }),
    ).toEqual({ locale, timezone: "America/Sao_Paulo" });
    expect(
      updatePreferencesInputSchema.parse({ locale, timezone: "UTC" }).timezone,
    ).toBe("UTC");
  });

  it.each(["es", "pt", "", null])("rejects unsupported locale %s", (locale) => {
    expect(
      updatePreferencesInputSchema.safeParse({ locale, timezone: "UTC" })
        .success,
    ).toBe(false);
  });

  it.each([
    "+02:00",
    "Mars/Olympus",
    "America/Sao_Paulo\n",
    "",
    "a".repeat(101),
    null,
  ])("rejects unsupported timezone %s", (timezone) => {
    expect(
      updatePreferencesInputSchema.safeParse({ locale: "en", timezone })
        .success,
    ).toBe(false);
  });

  it("has no user/workspace authority or review output language in its input", () => {
    for (const extra of [
      { userId: "other" },
      { workspaceId: "other" },
      { "output.language": "pt-BR" },
    ]) {
      expect(
        updatePreferencesInputSchema.safeParse({
          locale: "en",
          timezone: "UTC",
          ...extra,
        }).success,
      ).toBe(false);
    }
    expect(
      personalPreferencesSchema.parse({ locale: null, timezone: null }),
    ).toEqual({ locale: null, timezone: null });
    expect(
      personalPreferencesSchema.safeParse({
        locale: "en",
        timezone: "Mars/Olympus",
      }).success,
    ).toBe(false);
  });
});
