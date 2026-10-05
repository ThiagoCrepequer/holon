import { createHash } from "node:crypto";

import { reset } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { origin } from "../src/auth.js";
import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  setupAuth,
  snapshot,
} from "./support.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

const person = { id: 9001, email: "person@example.invalid" };
const attacker = { id: 9002, email: "attacker@example.invalid" };

// Independent RFC 7636 oracle, not Better Auth's generateCodeChallenge helper.
function challenge(verifier: string) {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

describe.each(["drizzle", "native-d1"] as const)(
  "%s: native OAuth PKCE and callback binding",
  (persistence) => {
    it("sends a fresh S256 challenge per flow and the matching server-held verifier at exchange", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      const left = await beginOAuth(auth);
      const right = await beginOAuth(auth);
      for (const flow of [left, right]) {
        expect(flow.authorizationURL.origin).toBe("https://github.com");
        expect(flow.authorizationURL.pathname).toBe("/login/oauth/authorize");
        expect(
          flow.authorizationURL.searchParams.get("code_challenge_method"),
        ).toBe("S256");
        expect(
          flow.authorizationURL.searchParams.get("code_challenge"),
        ).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(flow.authorizationURL.searchParams.has("code_verifier")).toBe(
          false,
        );
        expect(flow.authorizationURL.searchParams.get("redirect_uri")).toBe(
          `${origin}/api/auth/callback/github`,
        );
      }
      expect(left.state).not.toBe(right.state);
      expect(left.authorizationURL.searchParams.get("code_challenge")).not.toBe(
        right.authorizationURL.searchParams.get("code_challenge"),
      );
      github.authorize("left-pkce", person, left.authorizationURL);
      const response = await completeOAuth(auth, left, "left-pkce");
      expect(response.headers.get("Location")).toBe(`${origin}/signed-in`);
      const request = github.tokenRequests[0];
      expect(request?.verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
      if (!request?.verifier)
        throw new Error("Native token request omitted the verifier");
      expect(challenge(request.verifier)).toBe(
        left.authorizationURL.searchParams.get("code_challenge"),
      );
      expect(left.authorizationURL.toString()).not.toContain(request.verifier);
      expect(github.acceptedExchanges).toBe(1);
    });

    it("rejects a code from another flow even with the victim's correct state and cookie", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      const victimFlow = await beginOAuth(auth);
      const attackerFlow = await beginOAuth(auth);
      github.authorize(
        "injected-code",
        attacker,
        attackerFlow.authorizationURL,
      );
      const response = await completeOAuth(
        auth,
        victimFlow,
        "injected-code",
        victimFlow.initialHeaders,
      );
      expect(response.headers.get("Location")).not.toBe(`${origin}/signed-in`);
      expect(victimFlow.jar.hasSession()).toBe(false);
      expect(github.exchanges).toBe(1);
      expect(github.rejectedPkce).toBe(1);
      expect(github.acceptedExchanges).toBe(0);
      const rows = await snapshot();
      expect(rows.users).toHaveLength(0);
      expect(rows.accounts).toHaveLength(0);
      expect(rows.sessions).toHaveLength(0);
    });

    it("rejects an injected code issued without a challenge in a provider that enforces RFC 9700 downgrade protection", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      const victimFlow = await beginOAuth(auth);
      const attackerFlow = await beginOAuth(auth);
      const downgraded = new URL(attackerFlow.authorizationURL);
      downgraded.searchParams.delete("code_challenge");
      downgraded.searchParams.delete("code_challenge_method");
      github.authorize("downgraded-code", attacker, downgraded);
      const response = await completeOAuth(
        auth,
        victimFlow,
        "downgraded-code",
        victimFlow.initialHeaders,
      );
      expect(response.headers.get("Location")).not.toBe(`${origin}/signed-in`);
      expect(victimFlow.jar.hasSession()).toBe(false);
      expect(github.rejectedPkce).toBe(1);
      expect(github.acceptedExchanges).toBe(0);
      expect((await snapshot()).sessions).toHaveLength(0);
    });

    it("records why CSRF protection cannot assume that a provider rejects downgrade without evidence", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub({ enforcePkceDowngrade: false });
      const victimFlow = await beginOAuth(auth);
      const attackerFlow = await beginOAuth(auth);
      const downgraded = new URL(attackerFlow.authorizationURL);
      downgraded.searchParams.delete("code_challenge");
      downgraded.searchParams.delete("code_challenge_method");
      github.authorize("unbound-injection", attacker, downgraded);
      // Adversary has learned victim state; its browser supplies the victim's signed cookie.
      // This intentionally noncompliant provider models RFC 9700 section 4.8, not GitHub behavior.
      const response = await completeOAuth(
        auth,
        victimFlow,
        "unbound-injection",
        victimFlow.initialHeaders,
      );
      expect(response.headers.get("Location")).toBe(`${origin}/signed-in`);
      expect(github.acceptedExchanges).toBe(1);
      const rows = await snapshot();
      expect(rows.users).toHaveLength(1);
      expect(rows.users[0]?.email).toBe(attacker.email);
      const context = await auth.api.getSession({
        headers: victimFlow.jar.headers(),
      });
      expect(context?.user.id).toBe(rows.users[0]?.id);
    });

    it("preserves native PKCE while the plugin submits a concurrent code once", async () => {
      const auth = await setupAuth(persistence);
      const github = fakeGitHub();
      const flow = await beginOAuth(auth);
      github.authorize("concurrent-pkce", person, flow.authorizationURL);
      const responses = await Promise.all([
        completeOAuth(auth, flow, "concurrent-pkce", flow.initialHeaders),
        completeOAuth(auth, flow, "concurrent-pkce", flow.initialHeaders),
      ]);
      expect(github.exchanges).toBe(1);
      expect(github.acceptedExchanges).toBe(1);
      expect(
        responses.filter(
          (response) =>
            response.headers.get("Location") === `${origin}/signed-in`,
        ),
      ).toHaveLength(1);
      const rows = await snapshot();
      expect(rows.users).toHaveLength(1);
      expect(rows.accounts).toHaveLength(1);
      expect(rows.sessions).toHaveLength(1);
      for (const request of github.tokenRequests) {
        if (!request.verifier) throw new Error("Native exchange omitted PKCE");
        expect(challenge(request.verifier)).toBe(
          flow.authorizationURL.searchParams.get("code_challenge"),
        );
      }
    });

    it.each(["missing", "wrong", "invalid-format"] as const)(
      "the external provider fixture rejects a %s verifier for a bound code",
      async (kind) => {
        const auth = await setupAuth(persistence);
        const github = fakeGitHub();
        const flow = await beginOAuth(auth);
        github.authorize("invalid-verifier", person, flow.authorizationURL);
        const body = new URLSearchParams({
          client_id: String(
            flow.authorizationURL.searchParams.get("client_id"),
          ),
          client_secret: "synthetic-client-secret",
          code: "invalid-verifier",
          redirect_uri: String(
            flow.authorizationURL.searchParams.get("redirect_uri"),
          ),
        });
        if (kind === "wrong") body.set("code_verifier", "x".repeat(43));
        if (kind === "invalid-format")
          body.set("code_verifier", "!".repeat(43));
        const response = await fetch(
          "https://github.com/login/oauth/access_token",
          { method: "POST", body },
        );
        expect(await response.json()).toMatchObject({
          error: "bad_verification_code",
        });
        expect(github.acceptedExchanges).toBe(0);
        expect(github.rejectedPkce).toBe(1);
      },
    );
  },
);

it("checks the external PKCE fixture against the RFC 7636 Appendix B published vector", async () => {
  const github = fakeGitHub();
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  expect(challenge(verifier)).toBe(expected);
  const authorizationURL = new URL("https://github.com/login/oauth/authorize");
  authorizationURL.searchParams.set("client_id", "synthetic-client-id");
  authorizationURL.searchParams.set(
    "redirect_uri",
    `${origin}/api/auth/callback/github`,
  );
  authorizationURL.searchParams.set("code_challenge_method", "S256");
  authorizationURL.searchParams.set("code_challenge", expected);
  github.authorize("rfc-vector", person, authorizationURL);
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: "synthetic-client-id",
      client_secret: "synthetic-client-secret",
      redirect_uri: `${origin}/api/auth/callback/github`,
      code: "rfc-vector",
      code_verifier: verifier,
    }),
  });
  expect(await response.json()).toMatchObject({
    access_token: "synthetic-access-rfc-vector",
  });
  expect(github.acceptedExchanges).toBe(1);
});
