import { dashboardLocaleSchema } from "@holon/contracts/dashboard";
import {
  dashboardTimezoneSchema,
  updatePreferencesInputSchema,
  updatePreferencesOutputSchema,
  type UpdatePreferencesInput,
} from "@holon/contracts/dashboard-preferences";

export type PreferenceFields = { language: string; timezone: string };
export function preferenceFields(
  fields: PreferenceFields,
): UpdatePreferencesInput | null {
  const language = dashboardLocaleSchema.safeParse(fields.language);
  const timezone = dashboardTimezoneSchema.safeParse(fields.timezone);
  return language.success && timezone.success
    ? { locale: language.data, timezone: timezone.data }
    : null;
}
export function inferDeviceTimezone(
  read = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  try {
    const parsed = dashboardTimezoneSchema.safeParse(read());
    return parsed.success ? parsed.data : "UTC";
  } catch {
    return "UTC";
  }
}
export type PreferenceCommandResult =
  | { status: "saved"; value: UpdatePreferencesInput }
  | { status: "session-lost" }
  | { status: "unconfirmed" };
export async function preferencesCommand(
  input: UpdatePreferencesInput,
  csrf: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PreferenceCommandResult> {
  try {
    const response = await fetcher("/api/preferences", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(updatePreferencesInputSchema.parse(input)),
      signal,
    });
    if (response.status === 401 || response.status === 403)
      return { status: "session-lost" };
    if (!response.ok) return { status: "unconfirmed" };
    const parsed = updatePreferencesOutputSchema.safeParse(
      await response.json(),
    );
    return parsed.success
      ? { status: "saved", value: parsed.data.preferences }
      : { status: "unconfirmed" };
  } catch {
    return { status: "unconfirmed" };
  }
}
