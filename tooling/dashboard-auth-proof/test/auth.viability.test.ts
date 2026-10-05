import { reset } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import { origin } from "../src/auth.js";
import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  interruptedSignupThenNewOAuth,
  setupAuth,
} from "./support.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

// Deliberately ordinary assertions, not it.fails or an inverted success criterion.
// This command must exit nonzero until the candidate genuinely meets DASH-02.
it.each(["drizzle", "native-d1"] as const)(
  "VIABILITY %s: a new OAuth flow recovers interrupted signup by verified-email linking, retaining the original User",
  async (persistence) => {
    const run = await interruptedSignupThenNewOAuth(persistence);
    expect(run.first.flow.state).not.toBe(run.fresh.flow.state);
    expect(run.fresh.response.headers.get("Location")).toBe(
      `${origin}/signed-in`,
    );
    expect(run.fresh.flow.jar.hasSession()).toBe(true);
    expect(run.final.users).toEqual(run.interrupted.users);
    expect(run.final.accounts).toHaveLength(1);
    expect(run.final.accounts[0]?.userId).toBe(run.final.users[0]?.id);
    expect(run.final.sessions).toHaveLength(1);
  },
);

it.each(["drizzle", "native-d1"] as const)(
  // RFC 9700 permits browser-bound PKCE as callback CSRF protection, so atomic
  // state deletion is one mechanism rather than a universal requirement.
  // RFC 6749 section 4.1.2 still forbids the client from reusing the same code.
  // Keep this observable gate: a second native token request is not waived by PKCE.
  "VIABILITY %s: concurrent callbacks never submit the same authorization code twice",
  async (persistence) => {
    const auth = await setupAuth(persistence);
    const github = fakeGitHub();
    const flow = await beginOAuth(auth);
    github.authorize(
      "replayed-code",
      {
        id: 9001,
        email: "person@example.invalid",
      },
      flow.authorizationURL,
    );
    await Promise.all([
      completeOAuth(auth, flow, "replayed-code", flow.initialHeaders),
      completeOAuth(auth, flow, "replayed-code", flow.initialHeaders),
    ]);
    expect(github.exchanges).toBe(1);
  },
);
