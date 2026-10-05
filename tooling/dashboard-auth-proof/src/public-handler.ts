import { origin, type ProofAuth } from "./auth.js";

export type PublicProofAuth = Pick<ProofAuth, "handler"> & {
  api: Pick<ProofAuth["api"], "getSession">;
};

const privateHeaders = { "Cache-Control": "private, no-store" };

// Minimal proof composition. Not an auth implementation for apps/dashboard.
export async function handlePublicAuth(
  auth: PublicProofAuth,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== origin) return new Response(null, { status: 404 });
  if (request.method === "GET" && url.pathname === "/session") {
    const { response: context, headers } = await auth.api.getSession({
      headers: request.headers,
      returnHeaders: true,
    });
    const output = context
      ? {
          user: { id: context.user.id, name: context.user.name },
          session: {
            id: context.session.id,
            expiresAt: context.session.expiresAt,
          },
        }
      : null;
    const result = Response.json(output, { headers: privateHeaders });
    for (const cookie of headers.getSetCookie())
      result.headers.append("Set-Cookie", cookie);
    return result;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/auth/sign-in/social"
  ) {
    if (request.headers.get("Origin") !== origin)
      return new Response(null, { status: 403, headers: privateHeaders });
    let payload: unknown;
    try {
      payload = await request.clone().json();
    } catch {
      return new Response(null, { status: 400 });
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      !("provider" in payload) ||
      payload.provider !== "github" ||
      Object.keys(payload).some(
        (key) => !["provider", "callbackURL", "disableRedirect"].includes(key),
      )
    ) {
      return new Response(null, { status: 400 });
    }
    // Native origin/state/redirect validation remains active.
    const response = await auth.handler(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (
    request.method === "GET" &&
    url.pathname === "/api/auth/callback/github"
  ) {
    const response = await auth.handler(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  return new Response(null, { status: 404, headers: privateHeaders });
}
