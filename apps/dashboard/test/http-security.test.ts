import { dashboardErrorSchema } from "@holon/contracts/dashboard";
import { expect, it } from "vitest";

import { createDashboardHandler } from "../app/server/http-app.server.js";
import {
  configuredOrigin,
  safeReturnPath,
  readCommand,
  secureResponse,
  errorResponse,
  HttpBoundaryError,
  nonce,
} from "../app/server/http-security.server.js";
const origin = "https://dashboard.example.invalid";
const session = {
  sessionId: "synthetic-session",
  csrfToken: "synthetic-csrf-token-at-least-32-bytes",
};
function command(
  body: BodyInit | null = JSON.stringify({ language: "en" }),
  extra: HeadersInit = {},
  method = "POST",
) {
  const headers = new Headers({
    Origin: origin,
    "Content-Type": "application/json; charset=utf-8",
    "X-CSRF-Token": session.csrfToken,
    "Sec-Fetch-Site": "same-origin",
  });
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Request(
    `${origin}/api/preferences`,
    method === "GET" || method === "HEAD"
      ? { method, headers }
      : { method, headers, body },
  );
}
it("origin/redirect authority comes from config, rejecting ambiguous or hostile destinations", () => {
  expect(configuredOrigin(origin)).toBe(origin);
  expect(configuredOrigin("http://127.0.0.1:8794")).toBe(
    "http://127.0.0.1:8794",
  );
  for (const value of [
    "http://evil.test",
    "https://user:pass@dashboard.example.invalid",
    "https://dashboard.example.invalid/path",
    "https://dashboard.example.invalid?q=1",
    "https://dashboard.example.invalid/#hash",
  ])
    expect(() => configuredOrigin(value)).toThrow(HttpBoundaryError);
  expect(safeReturnPath("/w/opaque/reviews?sort=newest", origin)).toBe(
    "/w/opaque/reviews?sort=newest",
  );
  expect(
    safeReturnPath("/w/opaque/reviews?search=needs%20review", origin),
  ).toBe("/w/opaque/reviews?search=needs%20review");
  for (const value of [
    "https://evil.test/",
    "//evil.test/",
    "/\\evil.test",
    "/%2fevil.test",
    "/../secret",
    "/path#hash",
    "/path with spaces",
  ])
    expect(() => safeReturnPath(value, origin)).toThrow(HttpBoundaryError);
});
it("valid commands require session-bound CSRF, exact origin, POST and JSON", async () => {
  expect(await readCommand(command(), origin, session)).toEqual({
    language: "en",
  });
  for (const [request, identity] of [
    [command(null, {}, "GET"), session],
    [command(null, {}, "HEAD"), session],
    [command("{}", { "Content-Type": "text/plain" }), session],
    [command("{}", { Origin: "https://evil.test" }), session],
    [command("{}", { "Sec-Fetch-Site": "cross-site" }), session],
    [command("{}", { "Sec-Fetch-Site": "same-site" }), session],
    [command("{}", { "X-CSRF-Token": "" }), session],
    [command("{}", { "X-CSRF-Token": "wrong" }), session],
    [command(), null],
    [command(), { sessionId: "", csrfToken: session.csrfToken }],
    [command(), { sessionId: "id", csrfToken: "short" }],
    [new Request("https://evil.test/api", { method: "POST" }), session],
  ] as const)
    await expect(readCommand(request, origin, identity)).rejects.toBeInstanceOf(
      HttpBoundaryError,
    );
  expect(
    await readCommand(
      command("{}", { "Sec-Fetch-Site": "none" }),
      origin,
      session,
    ),
  ).toEqual({});
  const withoutFetchMetadata = command();
  withoutFetchMetadata.headers.delete("Sec-Fetch-Site");
  expect(await readCommand(withoutFetchMetadata, origin, session)).toEqual({
    language: "en",
  });
});
it("body limits apply to the stream even without a reliable length header", async () => {
  await expect(
    readCommand(command("x".repeat(20)), origin, session, 10),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    readCommand(command("{}", { "Content-Length": "20" }), origin, session, 10),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    readCommand(command(null), origin, session),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    readCommand(command("not-json"), origin, session),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    readCommand(command(new Uint8Array([255])), origin, session),
  ).rejects.toMatchObject({ status: 400 });
  expect(await readCommand(command("[]"), origin, session, 2)).toEqual([]);
});
it("errors and headers disclose no arbitrary exception or session secret and preserve all cookies", async () => {
  const response = errorResponse(
    new Error("token=private email=private@example.invalid body=secret"),
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/private|secret|token=/);
  for (const code of [
    "denied",
    "reconnect_required",
    "command_unknown",
    "rate_limited",
  ] as const) {
    const error = errorResponse(new HttpBoundaryError(code, 403));
    expect(dashboardErrorSchema.parse(await error.json()).error.code).toBe(
      code,
    );
  }
  const original = new Response("private");
  original.headers.append("Set-Cookie", "a=one; HttpOnly");
  original.headers.append("Set-Cookie", "b=two; HttpOnly");
  const first = nonce(),
    second = nonce();
  expect(first).not.toBe(second);
  const safe = secureResponse(original, first);
  expect(safe.headers.getSetCookie()).toEqual(original.headers.getSetCookie());
  expect(safe.headers.get("Cache-Control")).toBe("private, no-store");
  expect(safe.headers.get("Content-Security-Policy")).toContain(
    `'nonce-${first}'`,
  );
  expect(safe.headers.get("Content-Security-Policy")).not.toMatch(
    /unsafe-inline|unsafe-eval/,
  );
  expect(safe.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
it("SSR/API share HTTP boundaries and the bootstrap exposes no command or fake auth", async () => {
  const calls: Request[] = [];
  const handle = createDashboardHandler(async (request) => {
    calls.push(request);
    return new Response("html");
  });
  expect(await (await handle(new Request(`${origin}/`), origin)).text()).toBe(
    "html",
  );
  expect(calls).toHaveLength(1);
  expect(
    await (await handle(new Request(`${origin}/api/health`), origin)).json(),
  ).toEqual({ status: "ok" });
  for (const path of ["/api/auth/get-session", "/api/send", "/api/unknown"])
    expect((await handle(new Request(origin + path), origin)).status).toBe(404);
  expect((await handle(command(), origin)).status).toBe(405);
  expect(
    (await handle(new Request(`${origin}/?q=${"x".repeat(2049)}`), origin))
      .status,
  ).toBe(414);
  expect(
    (
      await handle(
        new Request("https://evil.test/", {
          headers: { "X-Forwarded-Host": "dashboard.example.invalid" },
        }),
        origin,
      )
    ).status,
  ).toBe(403);
  expect((await handle(new Request(origin), "http://evil.test")).status).toBe(
    503,
  );
  expect(
    (await handle(new Request(origin, { method: "HEAD" }), origin)).status,
  ).toBe(200);
  const failed = createDashboardHandler(async () => {
    throw new Error("provider-secret");
  });
  expect(
    await (await failed(new Request(origin), origin)).text(),
  ).not.toContain("provider-secret");
});
