import { Hono } from "hono";

import {
  assertRequestOrigin,
  configuredOrigin,
  errorResponse,
  HttpBoundaryError,
  nonce,
  secureResponse,
} from "./http-security.server.js";

export function createDashboardHandler(
  render: (request: Request, requestNonce: string) => Promise<Response>,
) {
  const api = new Hono();
  api.get("/api/health", (context) => context.json({ status: "ok" }));
  api.notFound(() =>
    errorResponse(new HttpBoundaryError("invalid_request", 404)),
  );
  return async (request: Request, appOrigin: string) => {
    const requestNonce = nonce();
    try {
      const origin = configuredOrigin(appOrigin);
      assertRequestOrigin(request, origin);
      // Mutations are introduced by their owner with session/CSRF gates, not SSR actions.
      if (!["GET", "HEAD"].includes(request.method))
        throw new HttpBoundaryError("invalid_request", 405);
      if (new URL(request.url).search.length > 2_048)
        throw new HttpBoundaryError("invalid_request", 414);
      const response = new URL(request.url).pathname.startsWith("/api/")
        ? await api.fetch(request)
        : await render(request, requestNonce);
      return secureResponse(response, requestNonce);
    } catch (error) {
      return secureResponse(errorResponse(error), requestNonce);
    }
  };
}
