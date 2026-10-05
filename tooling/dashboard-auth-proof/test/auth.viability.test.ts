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
  "VIABILITY %s: a new OAuth flow recovers interrupted signup without identity merge or an orphan blocking login",
  async (persistence) => {
    const run = await interruptedSignupThenNewOAuth(persistence);
    expect(run.first.flow.state).not.toBe(run.fresh.flow.state);
    expect(run.fresh.response.headers.get("Location")).toBe(
      `${origin}/signed-in`,
    );
    expect(run.fresh.flow.jar.hasSession()).toBe(true);
    expect(run.final.users).toHaveLength(1);
    expect(run.final.accounts).toHaveLength(1);
    expect(run.final.accounts[0]?.userId).toBe(run.final.users[0]?.id);
    expect(run.final.sessions).toHaveLength(1);
  },
);

it.each(["drizzle", "native-d1"] as const)(
  "VIABILITY %s: concurrent replay consumes the OAuth state only once before token exchange",
  async (persistence) => {
    const auth = await setupAuth(persistence);
    const github = fakeGitHub();
    const flow = await beginOAuth(auth);
    github.authorize("replayed-code", {
      id: 9001,
      email: "person@example.invalid",
    });
    await Promise.all([
      completeOAuth(auth, flow, "replayed-code", flow.initialHeaders),
      completeOAuth(auth, flow, "replayed-code", flow.initialHeaders),
    ]);
    expect(github.exchanges).toBe(1);
  },
);
