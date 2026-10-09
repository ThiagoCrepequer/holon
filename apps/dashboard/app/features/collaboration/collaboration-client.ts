export type CollaborationResponse =
  | { status: "ready"; data: unknown }
  | {
      status:
        | "denied"
        | "reconnect"
        | "unconfirmed"
        | "rate_limited"
        | "unavailable";
    };
export async function collaborationRequest(
  path: string,
  signal: AbortSignal,
  command?: { csrf: string; body: unknown },
): Promise<CollaborationResponse> {
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      signal,
      ...(command
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": command.csrf,
            },
            body: JSON.stringify(command.body),
          }
        : {}),
    });
    if (response.status === 403) return { status: "denied" };
    if (response.status === 401) return { status: "reconnect" };
    if (response.status === 429) return { status: "rate_limited" };
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      return {
        status:
          body &&
          typeof body === "object" &&
          "error" in body &&
          body.error &&
          typeof body.error === "object" &&
          "code" in body.error &&
          body.error.code === "command_unknown"
            ? "unconfirmed"
            : "unavailable",
      };
    }
    return { status: "ready", data: await response.json() };
  } catch {
    return { status: command ? "unconfirmed" : "unavailable" };
  }
}
export async function connectionOAuth(
  workspaceId: string,
  installationId: number,
  action: "link" | "unlink",
  csrf: string,
  signal: AbortSignal,
): Promise<string | null> {
  const proof = await collaborationRequest("/api/github/reauth", signal, {
    csrf,
    body: { workspaceId, installationId, action },
  });
  if (
    proof.status !== "ready" ||
    !proof.data ||
    typeof proof.data !== "object" ||
    !("reauthIntentId" in proof.data) ||
    typeof proof.data.reauthIntentId !== "string"
  )
    return null;
  const parameters = new URLSearchParams({
    workspace: workspaceId,
    installation: String(installationId),
    connectionAction: action,
    reauth: proof.data.reauthIntentId,
  });
  if (typeof window !== "undefined") {
    const locale = new URL(window.location.href).searchParams.get("lang");
    if (locale) parameters.set("lang", locale);
  }
  return oauthRedirect(
    {
      provider: "github",
      callbackURL: `/account?${parameters}`,
      reauthIntentId: proof.data.reauthIntentId,
      disableRedirect: true,
    },
    signal,
  );
}
export function reconnectGitHub(signal: AbortSignal): Promise<string | null> {
  return oauthRedirect(
    {
      provider: "github",
      callbackURL: window.location.href,
      disableRedirect: true,
    },
    signal,
  );
}
export async function oauthRedirect(
  body: unknown,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "same-origin",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("url" in data) ||
      typeof data.url !== "string"
    )
      return null;
    const url = new URL(data.url);
    return url.origin === "https://github.com" &&
      url.pathname === "/login/oauth/authorize"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
