import { env, reset, type D1Migration } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  setupAuthService,
} from "./support.js";

const bindings = env as unknown as {
  AUTH_DB: D1Database;
  AUTH_MIGRATIONS: D1Migration[];
};

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

const userOne = {
  id: 1001,
  email: "user.one@example.invalid",
  verified: true,
};

const userTwo = {
  id: 1002,
  email: "user.two@example.invalid",
  verified: true,
};

describe("Issue #141: Session lifecycle, devices, and revocation", () => {
  it("lists active device sessions with opaque IDs and coarse labels, stripping secrets", async () => {
    const auth = await setupAuthService();
    const github = fakeGitHub();

    // Login user 1 on Device 1 (Chrome)
    const flow1 = await beginOAuth(auth);
    github.authorize("code-dev-1", userOne, flow1.authorizationURL);
    const headers1 = flow1.jar.headers();
    headers1.set(
      "User-Agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    await completeOAuth(auth, flow1, "code-dev-1", headers1);

    // Login user 1 on Device 2 (Firefox)
    const flow2 = await beginOAuth(auth);
    github.authorize("code-dev-2", userOne, flow2.authorizationURL);
    const headers2 = flow2.jar.headers();
    headers2.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    );
    await completeOAuth(auth, flow2, "code-dev-2", headers2);

    // Login user 2 on Device 3 (Safari)
    const flow3 = await beginOAuth(auth);
    github.authorize("code-dev-3", userTwo, flow3.authorizationURL);
    const headers3 = flow3.jar.headers();
    headers3.set(
      "User-Agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    );
    await completeOAuth(auth, flow3, "code-dev-3", headers3);

    const session1 = await auth.getSession(
      new Request("https://localhost", { headers: flow1.jar.headers() }),
    );
    expect(session1.session).not.toBeNull();
    const userId = session1.session!.user.id;
    const currentSessionId = session1.session!.session.id;

    // List devices for user 1
    const devices = await auth.listSessions(userId, currentSessionId);

    // Expect 2 devices for user 1 (user 2 is NOT included)
    expect(devices).toHaveLength(2);

    for (const device of devices) {
      expect(device.id).toBeDefined();
      expect(device.createdAt).toBeDefined();
      expect(device.expiresAt).toBeDefined();
      expect(typeof device.isCurrent).toBe("boolean");
      expect(["chrome", "firefox", "safari", "edge", "other"]).toContain(
        device.label,
      );

      // Verify no secrets/tokens/IPs are leaked in the DTO
      expect((device as Record<string, unknown>).token).toBeUndefined();
      expect((device as Record<string, unknown>).ipAddress).toBeUndefined();
      expect((device as Record<string, unknown>).userAgent).toBeUndefined();
    }

    const currentDevice = devices.find((d) => d.id === currentSessionId);
    expect(currentDevice?.isCurrent).toBe(true);

    const otherDevice = devices.find((d) => d.id !== currentSessionId);
    expect(otherDevice?.isCurrent).toBe(false);
  });

  it("revokes a specific session by opaque ID, preserving other devices and isolating users", async () => {
    const auth = await setupAuthService();
    const github = fakeGitHub();

    // User 1 login device 1 & device 2
    const flow1 = await beginOAuth(auth);
    github.authorize("code-u1-d1", userOne, flow1.authorizationURL);
    await completeOAuth(auth, flow1, "code-u1-d1");

    const flow2 = await beginOAuth(auth);
    github.authorize("code-u1-d2", userOne, flow2.authorizationURL);
    await completeOAuth(auth, flow2, "code-u1-d2");

    // User 2 login device 3
    const flow3 = await beginOAuth(auth);
    github.authorize("code-u2-d3", userTwo, flow3.authorizationURL);
    await completeOAuth(auth, flow3, "code-u2-d3");

    await auth.getSession(
      new Request("https://localhost", { headers: flow1.jar.headers() }),
    );
    const s2 = await auth.getSession(
      new Request("https://localhost", { headers: flow2.jar.headers() }),
    );
    const s3 = await auth.getSession(
      new Request("https://localhost", { headers: flow3.jar.headers() }),
    );

    const admitted1 = (
      await auth.getAdmittedUser(
        new Request("https://localhost", { headers: flow1.jar.headers() }),
      )
    ).user!;
    const session2Id = s2.session!.session.id;
    const session3Id = s3.session!.session.id;

    // User 1 cannot revoke User 2's session
    const deniedRevoke = await auth.revokeSession(admitted1, session3Id);
    expect(deniedRevoke).toBe(false);

    // User 2's session remains active
    const s3After = await auth.getSession(
      new Request("https://localhost", { headers: flow3.jar.headers() }),
    );
    expect(s3After.session).not.toBeNull();

    // User 1 revokes device 2
    const successRevoke = await auth.revokeSession(admitted1, session2Id);
    expect(successRevoke).toBe(true);

    // Replay of revoke is safe / idempotent
    const replayRevoke = await auth.revokeSession(admitted1, session2Id);
    expect(replayRevoke).toBe(false);

    // Device 2 is now rejected on next request
    const s2After = await auth.getSession(
      new Request("https://localhost", { headers: flow2.jar.headers() }),
    );
    expect(s2After.session).toBeNull();

    // Device 1 remains active
    const s1After = await auth.getSession(
      new Request("https://localhost", { headers: flow1.jar.headers() }),
    );
    expect(s1After.session).not.toBeNull();
  });

  it("revokes all sessions for user, leaving other users intact", async () => {
    const auth = await setupAuthService();
    const github = fakeGitHub();

    // User 1 with 2 sessions
    const flow1 = await beginOAuth(auth);
    github.authorize("code-u1-1", userOne, flow1.authorizationURL);
    await completeOAuth(auth, flow1, "code-u1-1");

    const flow2 = await beginOAuth(auth);
    github.authorize("code-u1-2", userOne, flow2.authorizationURL);
    await completeOAuth(auth, flow2, "code-u1-2");

    // User 2 with 1 session
    const flow3 = await beginOAuth(auth);
    github.authorize("code-u2-1", userTwo, flow3.authorizationURL);
    await completeOAuth(auth, flow3, "code-u2-1");

    const admitted1 = (
      await auth.getAdmittedUser(
        new Request("https://localhost", { headers: flow1.jar.headers() }),
      )
    ).user!;

    // Revoke all for User 1
    const revokedCount = await auth.revokeAllSessions(admitted1);
    expect(revokedCount).toBe(2);

    // User 1 sessions are both dead
    const s1After = await auth.getSession(
      new Request("https://localhost", { headers: flow1.jar.headers() }),
    );
    expect(s1After.session).toBeNull();

    const s2After = await auth.getSession(
      new Request("https://localhost", { headers: flow2.jar.headers() }),
    );
    expect(s2After.session).toBeNull();

    // User 2 session is intact
    const s3After = await auth.getSession(
      new Request("https://localhost", { headers: flow3.jar.headers() }),
    );
    expect(s3After.session).not.toBeNull();
  });

  it("implements sliding window: renews at exactly 24h, expires at 7d with injectable clock without modifying global Date", async () => {
    let currentTime = Date.now();
    const clock = () => currentTime;

    const auth = await setupAuthService({ clock });
    const github = fakeGitHub();

    const flow = await beginOAuth(auth);
    github.authorize("code-sliding", userOne, flow.authorizationURL);
    await completeOAuth(auth, flow, "code-sliding");

    // Immediate check at t=0: active
    const res0 = await auth.getSession(
      new Request("https://localhost", { headers: flow.jar.headers() }),
    );
    expect(res0.session).not.toBeNull();
    // Query persisted session to get exact t0 and expiry0
    const stored = await bindings.AUTH_DB.prepare(
      "SELECT updatedAt, expiresAt FROM session WHERE id = ?",
    )
      .bind(res0.session!.session.id)
      .first<{ updatedAt: number; expiresAt: number }>();
    expect(stored).not.toBeNull();
    const t0 = stored!.updatedAt;
    const expiry0 = stored!.expiresAt;

    // Login a second untouched device to test exact expiration without renewal
    const flowUntouched = await beginOAuth(auth);
    github.authorize("code-untouched", userOne, flowUntouched.authorizationURL);
    await completeOAuth(auth, flowUntouched, "code-untouched");
    const storedUntouched = await bindings.AUTH_DB.prepare(
      "SELECT expiresAt FROM session WHERE id != ?",
    )
      .bind(res0.session!.session.id)
      .first<{ expiresAt: number }>();
    expect(storedUntouched).not.toBeNull();
    const untouchedExpiry = storedUntouched!.expiresAt;

    // Advance clock to exactly 24h - 1ms from persisted t0: active, not renewed
    currentTime = t0 + 24 * 3600 * 1000 - 1;
    const resBefore24h = await auth.getSession(
      new Request("https://localhost", { headers: flow.jar.headers() }),
    );
    expect(resBefore24h.session).not.toBeNull();
    expect(new Date(resBefore24h.session!.session.expiresAt).getTime()).toBe(
      expiry0,
    );
    // No new session cookie issued on headers
    expect(
      resBefore24h.headers
        .getSetCookie()
        .some((c) => c.includes("session_token")),
    ).toBe(false);

    // Advance clock to exactly 24h from persisted t0: active, renewed!
    currentTime = t0 + 24 * 3600 * 1000;
    const resAt24h = await auth.getSession(
      new Request("https://localhost", { headers: flow.jar.headers() }),
    );
    expect(resAt24h.session).not.toBeNull();
    const expiryAfterRenewal = new Date(
      resAt24h.session!.session.expiresAt,
    ).getTime();
    expect(expiryAfterRenewal - currentTime).toBeCloseTo(
      7 * 24 * 3600 * 1000,
      -3,
    );
    expect(expiryAfterRenewal).toBeGreaterThan(expiry0);
    // Renewal cookie issued
    expect(
      resAt24h.headers.getSetCookie().some((c) => c.includes("session_token")),
    ).toBe(true);

    // On untouched device: advance to exactly untouchedExpiry: expired!
    currentTime = untouchedExpiry;
    const resUntouchedExpired = await auth.getSession(
      new Request("https://localhost", {
        headers: flowUntouched.jar.headers(),
      }),
    );
    expect(resUntouchedExpired.session).toBeNull();

    const admittedExpired = await auth.getAdmittedUser(
      new Request("https://localhost", {
        headers: flowUntouched.jar.headers(),
      }),
    );
    expect(admittedExpired.user).toBeNull();
    expect(admittedExpired.status).toBe("anonymous");
  });

  it("prevents reinsert when session is revoked concurrently during renewal", async () => {
    let currentTime = Date.now();
    const clock = () => currentTime;

    const auth = await setupAuthService({ clock });
    const github = fakeGitHub();

    const flow = await beginOAuth(auth);
    github.authorize("code-concurrent", userOne, flow.authorizationURL);
    await completeOAuth(auth, flow, "code-concurrent");

    const admitted = (
      await auth.getAdmittedUser(
        new Request("https://localhost", { headers: flow.jar.headers() }),
      )
    ).user!;
    const userId = admitted.id;
    const sessionId = admitted.sessionId;

    // Advance past 24h so renewal would trigger
    currentTime += 25 * 3600 * 1000;

    // Concurrently revoke session
    const revoked = await auth.revokeSession(admitted, sessionId);
    expect(revoked).toBe(true);

    // Subsequent getSession must NOT resurrect or re-insert the session
    const resAfterRevoke = await auth.getSession(
      new Request("https://localhost", { headers: flow.jar.headers() }),
    );
    expect(resAfterRevoke.session).toBeNull();

    // Verify database row is truly gone
    const devices = await auth.listSessions(userId, sessionId);
    expect(devices).toHaveLength(0);
  });
});
