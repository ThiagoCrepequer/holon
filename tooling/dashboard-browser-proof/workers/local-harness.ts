import { Hono } from "hono";
import { createRequestHandler, RouterContextProvider } from "react-router";

import { nonceContext, readsContext } from "../app/request-context.js";
import { readAuthorized } from "../app/use-case.server.js";
const handler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);
const api = new Hono();
api.get("/api/read/:resource", (context) =>
  context.json(readAuthorized(context.req.raw), 200, {
    "X-Proof-Use-Case-Reads": "1",
  }),
);
export default {
  async fetch(request: Request) {
    if (!["127.0.0.1", "localhost"].includes(new URL(request.url).hostname))
      return new Response("Local synthetic proof only", { status: 404 });
    if (new URL(request.url).pathname === "/favicon.ico")
      return new Response(null, { status: 204 });
    const nonce = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))),
    );
    const context = new RouterContextProvider();
    context.set(nonceContext, nonce);
    const reads = { count: 0 };
    context.set(readsContext, reads);
    const response = new URL(request.url).pathname.startsWith("/api/")
      ? await api.fetch(request)
      : await handler(request, context);
    const headers = new Headers(response.headers);
    if (!new URL(request.url).pathname.startsWith("/api/"))
      headers.set("X-Proof-Use-Case-Reads", String(reads.count));
    headers.set("Cache-Control", "no-store");
    headers.set(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    );
    return new Response(response.body, { status: response.status, headers });
  },
};
