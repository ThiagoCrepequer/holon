import { afterEach, describe, expect, it, vi } from "vitest";

import {
  githubSignIn,
  readDevices,
  revokeDevice,
} from "../app/features/sessions/session-client.js";
const signal = new AbortController().signal;
const snapshot = {
  user: { id: "user_a", name: "User A" },
  session: { id: "session_a", expiresAt: "2030-01-08T00:00:00.000Z" },
};
function response(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json(body, { status })),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("session recovery client", () => {
  it("reads one bounded page and validates session generation even when the current device is absent", async () => {
    response({
      currentSessionId: "session_a",
      nextCursor: "session_c",
      sessions: [
        {
          id: "session_b",
          label: "chrome",
          createdAt: "2030-01-01T00:00:00.000Z",
          expiresAt: snapshot.session.expiresAt,
          isCurrent: false,
        },
      ],
    });
    expect(
      await readDevices(signal, "session_a", "session_cursor"),
    ).toMatchObject({
      status: "ready",
      nextCursor: "session_c",
      sessions: [{ id: "session_b" }],
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/sessions?cursor=session_cursor",
      expect.objectContaining({ signal }),
    );
  });
  it("rejects devices from a new session generation without an intermediate logout", async () => {
    response({
      currentSessionId: "session_b",
      nextCursor: null,
      sessions: [
        {
          id: "session_b",
          label: "firefox",
          createdAt: "2030-01-01T00:00:00.000Z",
          expiresAt: snapshot.session.expiresAt,
          isCurrent: true,
        },
      ],
    });
    expect(await readDevices(signal, "session_a")).toEqual({ status: "lost" });
  });
  it.each([401, 403])(
    "loses private state for denied reads/commands %i",
    async (status) => {
      response({}, status);
      response({}, status);
      expect(await readDevices(signal, snapshot.session.id)).toEqual({
        status: "lost",
      });
      response({}, status);
      expect(await revokeDevice("/api/auth/sign-out", "csrf", signal)).toBe(
        "lost",
      );
    },
  );
  it("validates privacy-preserving device DTOs", async () => {
    response({
      currentSessionId: "session_a",
      nextCursor: null,
      sessions: [
        {
          id: "session_a",
          label: "firefox",
          createdAt: "2030-01-01T00:00:00.000Z",
          expiresAt: snapshot.session.expiresAt,
          isCurrent: true,
        },
      ],
    });
    expect(await readDevices(signal, snapshot.session.id)).toMatchObject({
      status: "ready",
      sessions: [{ label: "firefox" }],
    });
    response({ sessions: [{ token: "secret", userAgent: "raw" }] });
    expect(await readDevices(signal, snapshot.session.id)).toEqual({
      status: "unavailable",
    });
  });
  it("does not interpret unavailable requests as expiry or success", async () => {
    response({}, 503);
    response({}, 503);
    expect(await readDevices(signal, snapshot.session.id)).toEqual({
      status: "unavailable",
    });
    response({}, 503);
    expect(await revokeDevice("/api/auth/sign-out", "csrf", signal)).toBe(
      "unavailable",
    );
    response({ success: true });
    expect(await revokeDevice("/api/auth/sign-out", "csrf", signal)).toBe(
      "done",
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/sign-out",
      expect.objectContaining({
        method: "POST",
        signal,
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf" }),
      }),
    );
  });
  it.each([
    ["/api/auth/sign-out", { success: false }],
    ["/api/auth/sign-out", {}],
    ["/api/auth/sign-out", { success: true, token: "secret" }],
    ["/api/auth/sign-out/all", { revokedCount: -1 }],
    ["/api/auth/sign-out/all", { revokedCount: 1.5 }],
    ["/api/auth/sessions/session_a/revoke", { revoked: "true" }],
    ["/api/auth/sessions/session_a/revoke", { success: true }],
  ])("does not confirm malformed successful command %#", async (path, body) => {
    response(body);
    expect(await revokeDevice(path, "csrf", signal)).toBe("unavailable");
  });
  it("does not confirm an HTML success response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>unavailable</html>")),
    );
    expect(await revokeDevice("/api/auth/sign-out", "csrf", signal)).toBe(
      "unavailable",
    );
  });
  it.each([
    ["/api/auth/sign-out", { success: true }],
    ["/api/auth/sign-out/all", { revokedCount: 0 }],
    ["/api/auth/sessions/session_a/revoke", { revoked: false }],
  ])(
    "confirms the correct strict result for %# including idempotent revocation",
    async (path, body) => {
      response(body);
      expect(await revokeDevice(path, "csrf", signal)).toBe("done");
    },
  );
  it("fails safely on a lost network or invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private message")),
    );
    expect(await readDevices(signal, snapshot.session.id)).toEqual({
      status: "unavailable",
    });
    expect(await revokeDevice("/api/auth/sign-out", "csrf", signal)).toBe(
      "unavailable",
    );
    expect(await githubSignIn("https://holon.example.invalid/")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid")));
    expect(await readDevices(signal, snapshot.session.id)).toEqual({
      status: "unavailable",
    });
  });
  it("only navigates to the supported HTTPS GitHub authorization endpoint", async () => {
    const callback = "https://holon.example.invalid/?keep=filter";
    response({ url: "https://github.com/login/oauth/authorize?state=signed" });
    expect(await githubSignIn(callback)).toBe(
      "https://github.com/login/oauth/authorize?state=signed",
    );
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string),
    ).toEqual({
      provider: "github",
      callbackURL: callback,
      disableRedirect: true,
    });
    for (const url of [
      "javascript:alert(1)",
      "https://other.example.invalid",
      "https://github.com/wrong",
      "http://github.com/login/oauth/authorize",
      "broken",
    ]) {
      response({ url });
      expect(await githubSignIn(callback)).toBeNull();
    }
    response({});
    expect(await githubSignIn(callback)).toBeNull();
    response({ url: 10 });
    expect(await githubSignIn(callback)).toBeNull();
    response(null);
    expect(await githubSignIn(callback)).toBeNull();
    response({}, 503);
    expect(await githubSignIn(callback)).toBeNull();
  });
});
