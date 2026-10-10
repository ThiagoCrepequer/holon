import { z } from "zod/mini";

import { dashboardLocaleSchema } from "./dashboard.js";

function isSupportedTimezone(value: string): boolean {
  if (!/^(?:UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/u.test(value))
    return false;
  try {
    const formatter = new Intl.DateTimeFormat("en", { timeZone: value });
    return Boolean(formatter.resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

/** IANA region/alias names and UTC; numeric offsets are not personal timezones. */
export const dashboardTimezoneSchema = z
  .string()
  .check(z.minLength(1))
  .check(z.maxLength(100))
  .check(z.refine(isSupportedTimezone));
export const updatePreferencesInputSchema = z.strictObject({
  locale: dashboardLocaleSchema,
  timezone: dashboardTimezoneSchema,
});
/** Both null means no saved preference; UTC can also be an explicit saved choice. */
export const personalPreferencesSchema = z.union([
  updatePreferencesInputSchema,
  z.strictObject({ locale: z.null(), timezone: z.null() }),
]);

export const personalPreferencesOutputSchema = z.strictObject({
  preferences: personalPreferencesSchema,
});
export const updatePreferencesOutputSchema = z.strictObject({
  preferences: updatePreferencesInputSchema,
});

export type UpdatePreferencesInput = z.infer<
  typeof updatePreferencesInputSchema
>;
export type PersonalPreferences = z.infer<typeof personalPreferencesSchema>;
