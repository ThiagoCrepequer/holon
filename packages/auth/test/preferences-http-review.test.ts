import { personalPreferencesOutputSchema } from "@holon/contracts/dashboard-preferences";
import { createTenancyPersistence } from "@holon/db/identity/server";
import { env, reset, type D1Migration } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

import { createDashboardHandler } from "../../../apps/dashboard/app/server/http-app.server.js";
import { createPreferencesPersistence } from "../../db/src/preferences.server.js";
import {
  beginOAuth,
  completeOAuth,
  fakeGitHub,
  setupAuthService,
  testOrigin,
  testSecret,
} from "./support.js";

const bindings = env as { AUTH_DB: D1Database; AUTH_MIGRATIONS: D1Migration[] };
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

async function fixture() {
  const authService = await setupAuthService();
  const services = {
    authService,
    tenancyPersistence: createTenancyPersistence(bindings.AUTH_DB),
    preferencesPersistence: createPreferencesPersistence(bindings.AUTH_DB),
    authSecret: testSecret,
  };
  const handle = createDashboardHandler(
    async () => new Response("Synthetic render"),
    services,
  );
  const github = fakeGitHub();
  async function signIn(code: string, id: number) {
    const flow = await beginOAuth(authService);
    github.authorize(
      code,
      { id, email: `preferences-${id}@example.invalid` },
      flow.authorizationURL,
    );
    expect((await completeOAuth(authService, flow, code)).status).toBe(302);
    const response = await handle(
      new Request(`${testOrigin}/api/auth/session`, {
        headers: flow.jar.headers(),
      }),
      testOrigin,
    );
    expect(response.status).toBe(200);
    const actor = (
      await authService.getAdmittedUser(
        new Request(testOrigin, { headers: flow.jar.headers() }),
      )
    ).user!;
    return {
      jar: flow.jar,
      csrf: response.headers.get("X-CSRF-Token")!,
      actor,
    };
  }
  function command(
    actor: Awaited<ReturnType<typeof signIn>>,
    input: unknown,
    csrf = actor.csrf,
  ) {
    const headers = actor.jar.headers();
    headers.set("Origin", testOrigin);
    headers.set("Content-Type", "application/json");
    headers.set("X-CSRF-Token", csrf);
    return handle(
      new Request(`${testOrigin}/api/preferences`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      }),
      testOrigin,
    );
  }
  return { handle, signIn, command };
}

it("self preferences persist between native OAuth devices and never target another User", async () => {
  const { handle, signIn, command } = await fixture();
  const current = await signIn("prefs-http-current", 5301);
  const anotherDevice = await signIn("prefs-http-device", 5301);
  const foreign = await signIn("prefs-http-foreign", 5302);
  const before = await handle(
    new Request(`${testOrigin}/api/preferences`, {
      headers: current.jar.headers(),
    }),
    testOrigin,
  );
  expect(before.status).toBe(200);
  expect(
    personalPreferencesOutputSchema.parse(await before.json()).preferences,
  ).toEqual({ locale: null, timezone: null });
  const value = { locale: "pt-BR", timezone: "America/Sao_Paulo" };
  expect((await command(current, value)).status).toBe(200);
  const read = await handle(
    new Request(`${testOrigin}/api/preferences?userId=${foreign.actor.id}`, {
      headers: anotherDevice.jar.headers(),
    }),
    testOrigin,
  );
  expect(read.status).toBe(200);
  expect(read.headers.get("Cache-Control")).toContain("no-store");
  expect(
    personalPreferencesOutputSchema.parse(await read.json()).preferences,
  ).toEqual(value);
  expect(
    (await command(current, { ...value, userId: foreign.actor.id })).status,
  ).toBe(400);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) FROM user_preference WHERE user_id=?",
    )
      .bind(foreign.actor.id)
      .first("COUNT(*)"),
  ).toBe(0);
  expect(
    (
      await handle(
        new Request(`${testOrigin}/api/preferences/${foreign.actor.id}`, {
          headers: current.jar.headers(),
        }),
        testOrigin,
      )
    ).status,
  ).toBe(404);
});

it("invalid locale/timezone and CSRF have no preference effect; revoked sessions cannot read or retry", async () => {
  const { handle, signIn, command } = await fixture();
  const current = await signIn("prefs-http-denial", 5301);
  const value = { locale: "en", timezone: "UTC" };
  expect((await command(current, value, "invalid")).status).toBe(403);
  expect((await command(current, { ...value, locale: "es" })).status).toBe(400);
  expect(
    (await command(current, { ...value, timezone: "+02:00" })).status,
  ).toBe(400);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) FROM user_preference",
    ).first("COUNT(*)"),
  ).toBe(0);
  await bindings.AUTH_DB.prepare("DELETE FROM session WHERE id=?")
    .bind(current.actor.sessionId)
    .run();
  const denied = await handle(
    new Request(`${testOrigin}/api/preferences`, {
      headers: current.jar.headers(),
    }),
    testOrigin,
  );
  expect([401, 403]).toContain(denied.status);
  expect([401, 403]).toContain((await command(current, value)).status);
  expect(
    await bindings.AUTH_DB.prepare(
      "SELECT COUNT(*) FROM user_preference",
    ).first("COUNT(*)"),
  ).toBe(0);
});
