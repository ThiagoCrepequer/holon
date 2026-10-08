import {
  sessionDeviceListDtoSchema,
  signOutOutputSchema,
  revokeSessionOutputSchema,
  revokeAllSessionsOutputSchema,
  type SessionDeviceDto,
} from "@holon/contracts/dashboard";

export type DeviceRead =
  | { status: "ready"; sessions: SessionDeviceDto[]; nextCursor: string | null }
  | { status: "lost" }
  | { status: "unavailable" };
export async function readDevices(
  signal: AbortSignal,
  expectedSessionId: string,
  cursor?: string | null,
): Promise<DeviceRead> {
  try {
    const path = cursor
      ? `/api/auth/sessions?cursor=${encodeURIComponent(cursor)}`
      : "/api/auth/sessions";
    const response = await fetch(path, {
      credentials: "same-origin",
      signal,
    });
    if (response.status === 401 || response.status === 403)
      return { status: "lost" };
    if (!response.ok) return { status: "unavailable" };
    const parsed = sessionDeviceListDtoSchema.safeParse(await response.json());
    if (!parsed.success) return { status: "unavailable" };
    if (parsed.data.currentSessionId !== expectedSessionId)
      return { status: "lost" };
    return {
      status: "ready",
      sessions: parsed.data.sessions,
      nextCursor: parsed.data.nextCursor,
    };
  } catch {
    return { status: "unavailable" };
  }
}
export async function revokeDevice(
  path: string,
  csrf: string,
  signal: AbortSignal,
): Promise<"done" | "lost" | "unavailable"> {
  try {
    const outputSchema =
      path === "/api/auth/sign-out"
        ? signOutOutputSchema
        : path === "/api/auth/sign-out/all"
          ? revokeAllSessionsOutputSchema
          : /^\/api\/auth\/sessions\/[a-zA-Z0-9_-]+\/revoke$/u.test(path)
            ? revokeSessionOutputSchema
            : null;
    if (!outputSchema) return "unavailable";
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: "{}",
      signal,
    });
    if (response.status === 401 || response.status === 403) return "lost";
    if (!response.ok) return "unavailable";
    return outputSchema.safeParse(await response.json()).success
      ? "done"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}
export async function githubSignIn(
  callbackURL: string,
): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "github",
        callbackURL,
        disableRedirect: true,
      }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("url" in body) ||
      typeof body.url !== "string"
    )
      return null;
    const url = new URL(body.url);
    return url.origin === "https://github.com" &&
      url.pathname === "/login/oauth/authorize"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
