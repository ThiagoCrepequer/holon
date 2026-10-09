import type { PersonalPreferencesPort } from "@holon/application/preferences-port";
import type { AuthService } from "@holon/auth/server";
import { admittedUserSchema } from "@holon/contracts/dashboard";
import { personalPreferencesSchema } from "@holon/contracts/dashboard-preferences";

import type { DashboardViewer } from "../viewer-data.js";
import {
  errorResponse,
  HttpBoundaryError,
  issueSessionCsrfToken,
} from "./http-security.server.js";
import {
  consumeReadRateLimit,
  mapBoundaryError,
} from "./http-services.server.js";

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
  const headers = new Headers();
  try {
    await consumeReadRateLimit(request, services, "/api/auth/session");
    const resolution = await services.authService.getAdmittedUser(request);
    for (const cookie of resolution.headers.getSetCookie())
      headers.append("Set-Cookie", cookie);
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
    await consumeReadRateLimit(request, services, "/api/preferences");
    const preferences = personalPreferencesSchema.parse(
      await services.preferencesPersistence.readPreferences(actor),
    );
    const csrf = await issueSessionCsrfToken(
      actor.sessionId,
      services.authSecret,
    );
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
  } catch (error) {
    const response = errorResponse(mapBoundaryError(error));
    for (const cookie of headers.getSetCookie())
      response.headers.append("Set-Cookie", cookie);
    throw response;
  }
}
