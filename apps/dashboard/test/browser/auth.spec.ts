import { expect, test } from "@playwright/test";

import { openPreferences } from "../support/browser-journey.js";

const origin = "https://127.0.0.1:8795";

for (const locale of ["en", "pt-BR"] as const) {
  test(`${locale}: native OAuth, secure cookies, hydrated document and idempotent tenancy`, async ({
    page,
    context,
  }, info) => {
    const subject =
      94000 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 +
      (locale === "en" ? 1 : 2);
    const code = `synthetic_browser_${subject}`;
    await context.setExtraHTTPHeaders({
      "X-Holon-Test-Client": String(subject),
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?lang=${locale}`);
    await page.route(
      "https://github.com/login/oauth/authorize**",
      async (route) => {
        const authorizationURL = route.request().url();
        const registered = await page.request.post(
          "/__test/provider/authorize",
          { data: { authorizationURL, code, subject } },
        );
        expect(registered.status()).toBe(200);
        const authorization = new URL(authorizationURL);
        const callback = new URL(`${origin}/__test/provider/authorization`);
        callback.searchParams.set("code", code);
        callback.searchParams.set(
          "state",
          authorization.searchParams.get("state")!,
        );
        await route.continue({ url: callback.href });
      },
    );

    const start = await page.evaluate(
      async ({ origin: appOrigin, locale: language }) => {
        const response = await fetch("/api/auth/sign-in/social", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "github",
            callbackURL: `${appOrigin}/?lang=${language}`,
            disableRedirect: true,
          }),
        });
        return {
          status: response.status,
          body: await response.json<{ url: string }>(),
        };
      },
      { origin, locale },
    );
    expect(start.status).toBe(200);
    expect(new URL(start.body.url).searchParams.has("scope")).toBe(false);
    const stateCookies = await context.cookies();
    expect(
      stateCookies.some((cookie) => cookie.secure && cookie.httpOnly),
    ).toBe(true);
    const completed = await page.goto(start.body.url);
    expect(completed?.status()).toBe(200);
    await expect(page).toHaveURL(`${origin}/?lang=${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Dashboard",
    );
    expect(completed?.headers()["content-security-policy"]).not.toMatch(
      /unsafe-inline|unsafe-eval/u,
    );
    const html = await completed!.text();
    expect(html).not.toMatch(
      /synthetic-browser-(?:auth-secret|access|refresh|client-secret)/u,
    );
    const preferences = await openPreferences(page);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preferences).toBeFocused();

    const session = await page.evaluate(async () => {
      const response = await fetch("/api/auth/session");
      return {
        status: response.status,
        csrf: response.headers.get("X-CSRF-Token"),
        body: await response.json<{
          user: { id: string; name: string };
          session: { id: string; expiresAt: string };
        }>(),
      };
    });
    expect(session.status).toBe(200);
    expect(Object.keys(session.body).toSorted()).toEqual(["session", "user"]);
    expect(Object.keys(session.body.user).toSorted()).toEqual(["id", "name"]);
    expect(Object.keys(session.body.session).toSorted()).toEqual([
      "expiresAt",
      "id",
    ]);
    expect(session.csrf).toMatch(/^[0-9a-f]{64}$/u);
    const sessionCookie = (await context.cookies()).find((cookie) =>
      cookie.name.endsWith("session_token"),
    );
    expect(sessionCookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      domain: "127.0.0.1",
      path: "/",
    });
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      "session_token",
    );
    expect(html).not.toContain(sessionCookie!.value);

    const results = await page.evaluate(
      async ({ csrf, operationId }) => {
        async function command(path: string, payload: unknown, token?: string) {
          const response = await fetch(path, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": token ?? csrf,
            },
            body: JSON.stringify(payload),
          });
          return {
            status: response.status,
            body: await response.json<{
              workspace?: { id: string };
              membership?: {
                userId: string;
                workspaceId: string;
                role: string;
              };
            }>(),
          };
        }
        const personal = await Promise.all([
          command("/api/workspaces/personal", {}, csrf),
          command("/api/workspaces/personal", {}, csrf),
        ]);
        const team = await command(
          "/api/workspaces/team",
          { name: "Synthetic browser team", operationId },
          csrf,
        );
        const replay = await command(
          "/api/workspaces/team",
          { name: "Synthetic browser team", operationId },
          csrf,
        );
        const denied = await command(
          "/api/workspaces/team",
          { name: "Denied", operationId: `${operationId}_denied` },
          "invalid",
        );
        const forged = await command(
          "/api/workspaces/personal",
          { userId: "forged" },
          csrf,
        );
        const unknown = await fetch("/api/auth/get-access-token");
        return {
          personal,
          team,
          replay,
          denied: denied.status,
          forged: forged.status,
          unknown: unknown.status,
        };
      },
      { csrf: session.csrf!, operationId: `browser_operation_${subject}` },
    );
    expect(results.personal.map((result) => result.status)).toEqual([200, 200]);
    expect(results.personal[0].body.workspace?.id).toBe(
      results.personal[1].body.workspace?.id,
    );
    expect(results.team.status).toBe(200);
    expect(results.team.body.membership).toEqual({
      userId: session.body.user.id,
      workspaceId: results.team.body.workspace?.id,
      role: "owner",
    });
    expect(results.replay.body.workspace?.id).toBe(
      results.team.body.workspace?.id,
    );
    expect(results.denied).toBe(403);
    expect(results.forged).toBe(400);
    expect(results.unknown).toBe(404);

    const authorization = new URL(start.body.url);
    await page.request.get(
      `/api/auth/callback/github?code=${code}&state=${authorization.searchParams.get("state")}`,
      { maxRedirects: 0 },
    );
    const proof = await page.request.get(`/__test/proof?code=${code}`);
    expect(await proof.json()).toEqual({
      unexpectedEgress: 0,
      tokenAttempts: 1,
      accounts: 1,
      personal: 1,
    });
    const configurations = await page.request.get("/__test/configuration");
    const failures: Array<{
      name: string;
      status: number;
      body: { error: { code: string; requestId: string } };
      cache: string;
    }> = await configurations.json();
    expect(failures).toHaveLength(4);
    for (const failure of failures) {
      expect(failure.status).toBe(503);
      expect(Object.keys(failure.body)).toEqual(["error"]);
      expect(failure.body.error.code).toBe("unavailable");
      expect(failure.body.error.requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(failure.cache).toBe("private, no-store");
    }
    const deniedLogout = await page.evaluate(async () => {
      const statuses: number[] = [];
      for (const method of ["GET", "HEAD"])
        statuses.push((await fetch("/api/auth/sign-out", { method })).status);
      for (const token of [undefined, "synthetic_wrong_csrf"]) {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token !== undefined) headers["X-CSRF-Token"] = token;
        statuses.push(
          (
            await fetch("/api/auth/sign-out", {
              method: "POST",
              headers,
              body: "{}",
            })
          ).status,
        );
      }
      return {
        statuses,
        session: await (
          await fetch("/api/auth/session")
        ).json<{ session: { id: string } }>(),
      };
    });
    expect(deniedLogout.statuses).toEqual([405, 405, 403, 403]);
    expect(deniedLogout.session.session.id).toBe(session.body.session.id);
    const logout = await page.evaluate(async (csrf) => {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: "{}",
      });
      return response.status;
    }, session.csrf!);
    expect(logout).toBe(200);
    expect(
      await page.evaluate(async () =>
        (await fetch("/api/auth/session")).json(),
      ),
    ).toBeNull();
    expect(
      (await context.cookies()).some((cookie) =>
        cookie.name.endsWith("session_token"),
      ),
    ).toBe(false);
    expect((await page.request.get("/api/workspaces")).status()).toBe(403);
    expect(errors).toEqual([]);
  });
}
