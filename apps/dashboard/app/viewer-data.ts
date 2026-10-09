import type { DashboardLocale } from "@holon/contracts/dashboard";
import type { PersonalPreferences } from "@holon/contracts/dashboard-preferences";
export type DashboardViewer =
  | { status: "disabled" | "anonymous" | "disconnected" }
  | {
      status: "authenticated";
      user: { id: string; name: string };
      sessionId: string;
      csrf: string;
      preferences: PersonalPreferences;
    };

/** Serializable data consumed by features, without a dependency on the root composition. */
export interface DashboardViewerData {
  viewer: DashboardViewer;
  locale: DashboardLocale;
  timezone: string;
}
