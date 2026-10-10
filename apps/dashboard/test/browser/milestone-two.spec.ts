import { AxeBuilder } from "@axe-core/playwright";
import { sessionOutputDtoSchema } from "@holon/contracts/dashboard";
import { expect, test, type Page } from "@playwright/test";

import { accountTrigger, openPreferences } from "../support/browser-journey.js";
const origin = "https://127.0.0.1:8795";
test.use({ timezoneId: "Asia/Tokyo" });

test("the user menu contains only preferences and sign out, with keyboard dismissal and no device reads", async ({
  page,
}, info) => {
  const subject =
    99000 + ["chromium", "firefox", "webkit"].indexOf(info.project.name);
  await signIn(page, subject, `m2-menu-${subject}`);
  const reads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/sessions")
      reads.push(request.url());
  });
  const trigger = accountTrigger(page);
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem")).toHaveCount(2);
  await expect(
    page.getByRole("menuitem", { name: "Preferences", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Sign out", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Active sessions", exact: true }),
  ).toHaveCount(0);
  expect(reads).toEqual([]);
});

test("an idle document does not probe or renew the session automatically", async ({
  page,
}, info) => {
  const subject =
    98000 + ["chromium", "firefox", "webkit"].indexOf(info.project.name);
  await page.clock.install();
  await signIn(page, subject, `m2-idle-${subject}`);
  // Open an interactive dialog to ensure hydration and effects have completed.
  await openPreferences(page);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  const probes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/session")
      probes.push(request.url());
  });
  await page.clock.fastForward(120_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => probes.length).toBe(0);
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
});
async function signIn(
  page: Page,
  subject: number,
  code: string,
  locale = "en",
) {
  await page
    .context()
    .setExtraHTTPHeaders({ "X-Holon-Test-Client": String(subject) });
  await page.route(
    "https://github.com/login/oauth/authorize**",
    async (route) => {
      const authorizationURL = route.request().url();
      expect(
        (
          await page.request.post("/__test/provider/authorize", {
            data: { authorizationURL, code, subject },
          })
        ).status(),
      ).toBe(200);
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
  await page.goto(`/?lang=${locale}&keep=preserved`);
  await page
    .getByRole("button", {
      name: locale === "en" ? "Sign in with GitHub" : "Entrar com GitHub",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: /^(Account menu|Menu da conta)$/u,
      exact: true,
    }),
  ).toBeVisible();
}
for (const locale of ["en", "pt-BR"] as const) {
  test(`${locale}: confirmed personal preferences preserve filters/focus, SSR and device independence`, async ({
    page,
    browser,
  }, info) => {
    const subject =
      95000 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 100 +
      (locale === "en" ? 1 : 2);
    const errors: string[] = [];
    const commands: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.method() === "POST")
        commands.push(new URL(request.url()).pathname);
    });
    await signIn(page, subject, `m2-preferences-${subject}`, locale);
    const initial = await page.reload();
    expect(await initial!.text()).toContain('data-holon-timezone="UTC"');
    await expect(page.locator("html")).toHaveAttribute(
      "data-holon-timezone",
      "UTC",
    );
    await openPreferences(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("opacity", "1");
    await expect(
      page.getByRole("combobox", {
        name: locale === "en" ? "Time zone" : "Fuso horário",
      }),
    ).toHaveValue("Asia/Tokyo");
    expect(commands).not.toContain("/api/preferences");
    await page
      .getByRole("combobox", { name: locale === "en" ? "Language" : "Idioma" })
      .selectOption(locale === "en" ? "pt-BR" : "en");
    await page
      .getByRole("combobox", {
        name: locale === "en" ? "Time zone" : "Fuso horário",
      })
      .selectOption("America/Sao_Paulo");
    const save = page.getByRole("button", {
      name: locale === "en" ? "Save preferences" : "Salvar preferências",
    });
    await save.focus();
    await page.keyboard.press("Enter");
    const next = locale === "en" ? "pt-BR" : "en";
    await expect(page.locator("html")).toHaveAttribute("lang", next);
    await expect(page.locator("html")).toHaveAttribute(
      "data-holon-timezone",
      "America/Sao_Paulo",
    );
    await expect(
      page.getByRole("button", {
        name: next === "en" ? "Save preferences" : "Salvar preferências",
      }),
    ).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).searchParams.get("keep")).toBe("preserved");
    expect(new URL(page.url()).searchParams.get("lang")).toBe(locale);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    const ssr = await page.reload();
    const html = await ssr!.text();
    expect(html).toContain(`lang="${next}"`);
    expect(html).toContain('data-holon-timezone="America/Sao_Paulo"');
    expect(html).not.toMatch(
      /synthetic-browser-(?:auth-secret|access|refresh|client-secret)/u,
    );
    const second = await browser.newContext({
      ignoreHTTPSErrors: true,
      timezoneId: "Europe/London",
    });
    try {
      const device = await second.newPage();
      await signIn(device, subject, `m2-preferences-device-${subject}`, locale);
      await expect(device.locator("html")).toHaveAttribute("lang", next);
      await openPreferences(device);
      await expect(
        device.getByRole("combobox", {
          name: next === "en" ? "Time zone" : "Fuso horário",
        }),
      ).toHaveValue("America/Sao_Paulo");
      await device
        .getByRole("combobox", {
          name: next === "en" ? "Time zone" : "Fuso horário",
        })
        .selectOption("UTC");
      await device
        .getByRole("button", {
          name: next === "en" ? "Save preferences" : "Salvar preferências",
        })
        .click();
      await expect(device.locator("html")).toHaveAttribute(
        "data-holon-timezone",
        "UTC",
      );
      await device.reload();
      await openPreferences(device);
      await expect(
        device.getByRole("combobox", {
          name: next === "en" ? "Time zone" : "Fuso horário",
        }),
      ).toHaveValue("UTC");
    } finally {
      await second.close();
    }
    expect(commands.filter((path) => path === "/api/preferences")).toHaveLength(
      1,
    );
    expect(commands.some((path) => /review|rerun|feedback/u.test(path))).toBe(
      false,
    );
    expect(errors).toEqual([]);
  });
}

test("failed preference command stays unconfirmed; retry saves and expired session removes private controls", async ({
  page,
}, info) => {
  const subject =
    96000 + ["chromium", "firefox", "webkit"].indexOf(info.project.name);
  await signIn(page, subject, `m2-retry-${subject}`);
  await openPreferences(page);
  await page.getByRole("combobox", { name: "Language" }).selectOption("pt-BR");
  await page
    .getByRole("combobox", { name: "Time zone" })
    .selectOption("America/Sao_Paulo");
  await page.route(
    "**/api/preferences",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":{"code":"command_unknown"}}',
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Unable to confirm the save",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await page.keyboard.press("Escape");
  const current = await page.evaluate(
    async () => await (await fetch("/api/auth/session")).json(),
  );
  expect(
    (
      await page.request.post("/__test/session/expire", {
        data: { sessionId: sessionOutputDtoSchema.parse(current).session.id },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /^(Sign in with GitHub|Entrar com GitHub)$/u,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /^(Account menu|Menu da conta)$/u,
      exact: true,
    }),
  ).toHaveCount(0);
  const denied = await page.request.get("/api/preferences");
  expect([401, 403]).toContain(denied.status());
});

test("device revocation and global logout remove each affected session on its next request", async ({
  page,
  browser,
}, info) => {
  const subject =
    97000 + ["chromium", "firefox", "webkit"].indexOf(info.project.name);
  const second = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const device = await second.newPage();
    await signIn(page, subject, `m2-devices-current-${subject}`);
    await signIn(device, subject, `m2-devices-target-${subject}`);
    const firstId = await page.evaluate(
      async () => await (await fetch("/api/auth/session")).json(),
    );
    const secondId = await device.evaluate(
      async () => await (await fetch("/api/auth/session")).json(),
    );
    expect(sessionOutputDtoSchema.parse(firstId).session.id).not.toBe(
      sessionOutputDtoSchema.parse(secondId).session.id,
    );
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "holon_csrf",
    )?.value;
    expect(typeof csrf === "string" && csrf.length >= 32).toBe(true);
    const target = sessionOutputDtoSchema.parse(secondId);
    const devices = await page.request.get("/api/auth/sessions");
    expect((await devices.json()).sessions).toHaveLength(2);
    const revoked = await page.request.post(
      `/api/auth/sessions/${target.session.id}/revoke`,
      { data: {}, headers: { "X-CSRF-Token": csrf!, Origin: origin } },
    );
    expect(revoked.status()).toBe(200);
    expect(
      (await (await page.request.get("/api/auth/sessions")).json()).sessions,
    ).toHaveLength(1);
    await device
      .getByRole("button", { name: "Workspace", exact: true })
      .click();
    await expect(
      device.getByRole("button", { name: "Sign in with GitHub", exact: true }),
    ).toBeVisible();
    expect((await page.request.get("/api/auth/session")).status()).toBe(200);
    await signIn(device, subject, `m2-devices-reconnect-${subject}`);
    expect(
      (await (await page.request.get("/api/auth/sessions")).json()).sessions,
    ).toHaveLength(2);
    const revokedAll = await page.request.post("/api/auth/sign-out/all", {
      data: {},
      headers: { "X-CSRF-Token": csrf!, Origin: origin },
    });
    expect(revokedAll.status()).toBe(200);
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign in with GitHub", exact: true }),
    ).toBeVisible();
    await device
      .getByRole("button", { name: "Workspace", exact: true })
      .click();
    await expect(
      device.getByRole("button", { name: "Sign in with GitHub", exact: true }),
    ).toBeVisible();
    expect(
      (await second.cookies()).some((cookie) =>
        cookie.name.endsWith("session_token"),
      ),
    ).toBe(false);
    expect(
      (await page.context().cookies()).some((cookie) =>
        cookie.name.endsWith("session_token"),
      ),
    ).toBe(false);
  } finally {
    await second.close();
  }
});
