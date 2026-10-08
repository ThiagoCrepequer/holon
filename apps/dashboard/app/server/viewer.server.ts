import type { PersonalPreferencesPort } from "@holon/application/preferences-port";
import type { AuthService } from "@holon/auth/server";
import { admittedUserSchema } from "@holon/contracts/dashboard";
import {
  personalPreferencesSchema,
  type PersonalPreferences,
} from "@holon/contracts/dashboard-preferences";

import {
  HttpBoundaryError,
  issueSessionCsrfToken,
} from "./http-security.server.js";

export type DashboardViewer =
  | { status: "disabled" | "anonymous" | "disconnected" }
  | {
      status: "authenticated";
      user: { id: string; name: string };
      sessionId: string;
      csrf: string;
      preferences: PersonalPreferences;
    };
export interface ViewerServices {
  authService?: AuthService | undefined;
  authSecret?: string | undefined;
  preferencesPersistence?: PersonalPreferencesPort | undefined;
}

/** Server-only resolution. Only the projection returned here is serialized into the page. */
export async function readDashboardViewer(
  request: Request,
  services: ViewerServices,
): Promise<{ viewer: DashboardViewer; headers: Headers }> {
  if (!services.authService)
    return { viewer: { status: "disabled" }, headers: new Headers() };
  const resolution = await services.authService.getAdmittedUser(request);
  if (!resolution.user)
    return {
      viewer: {
        status:
          resolution.status === "disconnected" ? "disconnected" : "anonymous",
      },
      headers: resolution.headers,
    };
  if (!services.authSecret || !services.preferencesPersistence)
    throw new HttpBoundaryError("unavailable", 503);
  const actor = admittedUserSchema.parse(resolution.user);
  const preferences = personalPreferencesSchema.parse(
    await services.preferencesPersistence.readPreferences(actor),
  );
  const csrf = await issueSessionCsrfToken(
    actor.sessionId,
    services.authSecret,
  );
  const headers = new Headers(resolution.headers);
  headers.append(
    "Set-Cookie",
    `holon_csrf=${csrf}; Path=/; SameSite=Lax; Secure`,
  );
  return {
    viewer: {
      status: "authenticated",
      user: { id: actor.id, name: actor.name },
      sessionId: actor.sessionId,
      csrf,
      preferences,
    },
    headers,
  };
}
