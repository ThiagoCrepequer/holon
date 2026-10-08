import {
  sessionDeviceListDtoSchema,
  type SessionDeviceDto,
} from "@holon/contracts/dashboard";

export type DeviceRead =
  | { status: "ready"; sessions: SessionDeviceDto[] }
  | { status: "lost" }
  | { status: "unavailable" };
export async function readDevices(
  signal: AbortSignal,
  expectedSessionId: string,
): Promise<DeviceRead> {
  try {
    const response = await fetch("/api/auth/sessions", {
      credentials: "same-origin",
      signal,
    });
    if (response.status === 401 || response.status === 403)
      return { status: "lost" };
    if (!response.ok) return { status: "unavailable" };
    const parsed = sessionDeviceListDtoSchema.safeParse(await response.json());
    if (!parsed.success) return { status: "unavailable" };
    if (
      parsed.data.sessions.find((device) => device.isCurrent)?.id !==
      expectedSessionId
    )
      return { status: "lost" };
    return { status: "ready", sessions: parsed.data.sessions };
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
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: "{}",
      signal,
    });
    if (response.status === 401 || response.status === 403) return "lost";
    return response.ok ? "done" : "unavailable";
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
