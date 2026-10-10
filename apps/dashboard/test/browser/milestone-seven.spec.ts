import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  signIn,
  seedReviews,
  accountTrigger,
  chooseWorkspace,
  loadWorkspaces,
  openCreateWorkspace,
  openPreferences,
  workspaceId,
} from "../support/browser-journey.js";

test("workspace creation lives only in the sidebar menu and its right-hand Sheet", async ({
  page,
}, info) => {
  const subject =
    417001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  await signIn(page, subject);
  const reads: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/workspaces" &&
      request.method() === "GET"
    )
      reads.push(request.url());
  });
  await page.goto("/account?lang=en");
  await expect(accountTrigger(page)).toBeEnabled();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Manage workspaces", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Team name", { exact: true })).toHaveCount(0);
  expect(reads).toEqual([]);
  await openCreateWorkspace(page);
  expect(reads).toHaveLength(1);
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(page.getByLabel("Team name", { exact: true })).toBeEnabled();
  await expect(sheet).toHaveCSS("transform", "none");
  const bounds = await sheet.boundingBox();
  expect(bounds!.x + bounds!.width).toBeCloseTo(page.viewportSize()!.width, 0);
  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Workspace", exact: true }),
  ).toBeFocused();
});

test("unknown workspace creation survives closing and reopening the Sheet without changing its intent", async ({
  page,
}, info) => {
  const subject =
    418001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  await signIn(page, subject);
  await openCreateWorkspace(page);
  await page
    .getByLabel("Team name", { exact: true })
    .fill("Synthetic recovered Sheet");
  const payloads: unknown[] = [];
  const receipts: { workspace: { id: string } }[] = [];
  await page.route("**/api/workspaces/team", async (route) => {
    payloads.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    receipts.push(await response.json());
    if (payloads.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Result unknown",
  );
  await page.keyboard.press("Escape");
  await openCreateWorkspace(page);
  await expect(page.getByLabel("Team name", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Team name", { exact: true })).toHaveValue(
    "Synthetic recovered Sheet",
  );
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);
  expect(receipts[1]?.workspace.id).toBe(receipts[0]?.workspace.id);
  const { workspaces: rows } = await (
    await page.request.get("/api/workspaces")
  ).json();
  expect(
    rows.filter(
      (row: { workspace: { name: string } }) =>
        row.workspace.name === "Synthetic recovered Sheet",
    ),
  ).toHaveLength(1);
});

test("Escape closes preferences before leaving the private review detail", async ({
  page,
}, info) => {
  const subject =
    416001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  const workspace = await signIn(page, subject);
  await seedReviews(page, subject, 1);
  const scope = new URLSearchParams({
    workspace,
    installation: String(subject + 100000),
    repository: String(subject + 200000),
    pullRequest: "1",
    lang: "en",
  });
  await page.goto(`/reviews/detail?${scope}`);
  const detailURL = page.url();
  const heading = page.getByRole("heading", {
    name: "#1 · Synthetic revisão 1",
  });
  await expect(heading).toBeVisible();
  const trigger = await openPreferences(page);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(heading).toBeVisible();
  expect(page.url()).toBe(detailURL);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/reviews\?/);
});

test("reconnecting removes repository and membership snapshots before another action", async ({
  page,
}, info) => {
  const subject =
    410001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  const workspace = await signIn(page, subject);
  await loadWorkspaces(page);
  await chooseWorkspace(page, workspace);
  await page
    .getByRole("button", { name: "Choose a repository", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "Authorized repositories" }),
  ).toBeVisible();
  await page.route(`**/api/workspaces/${workspace}/github`, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "provider_reconnect" } }),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh connections", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reconnect GitHub", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Authorized repositories" }),
  ).toHaveCount(0);
});

test("workspace input has a visible semantic focus outline in each theme", async ({
  page,
}, info) => {
  const subject =
    411001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  await signIn(page, subject);
  for (const theme of ["light", "dark"]) {
    await page.goto(`/account?lang=en&theme=${theme}`);
    await openCreateWorkspace(page);
    const input = page.getByLabel("Team name", { exact: true });
    await expect(input).toBeEnabled();
    await input.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();
    const outline = await input.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        color: style.outlineColor,
      };
    });
    expect(outline.style).toBe("solid");
    expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
    expect(outline.color).not.toBe("rgba(0, 0, 0, 0)");
  }
});

test("an unconfirmed invitation preserves the recipient and operation when retrying", async ({
  page,
}, info) => {
  const subject =
    412001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  await signIn(page, subject);
  await openCreateWorkspace(page);
  await page
    .getByLabel("Team name", { exact: true })
    .fill("Synthetic layout team");
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await chooseWorkspace(page, { label: "Synthetic layout team" });
  const email = page.getByLabel("Recipient email", { exact: true });
  await email.fill(`alias-${subject + 1}@example.invalid`);
  const payloads: unknown[] = [];
  await page.route("**/api/workspaces/*/invitations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    payloads.push(route.request().postDataJSON());
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "command_unknown" } }),
    });
  });
  await page
    .getByRole("button", { name: "Record invitation", exact: true })
    .click();
  await expect(email).toBeDisabled();
  await page
    .getByRole("button", { name: "Record invitation", exact: true })
    .click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toEqual(payloads[0]);
});

for (const locale of ["en", "pt-BR"]) {
  test(`${locale}: visual contract, keyboard preferences and responsive private routes`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const pt = locale === "pt-BR";
    const subject =
      413001 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 +
      (pt ? 1 : 0);
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", () => {
        document.documentElement.dataset.holonCspFailures = String(
          Number(document.documentElement.dataset.holonCspFailures ?? "0") + 1,
        );
      });
    });
    const workspace = await signIn(page, subject, locale);
    const scope = new URLSearchParams({
      workspace,
      installation: String(subject + 100000),
      repository: String(subject + 200000),
      lang: locale,
    });
    await seedReviews(page, subject, 2);
    const capture = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      const dialog = page.locator("dialog[open]");
      if (await dialog.count()) {
        await expect(dialog.getByRole("heading", { level: 2 })).toBeVisible();
        await expect(dialog).toHaveCSS("transform", "none");
      } else {
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      }
      const reflow = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(
        reflow.scroll,
        `${name}: ${JSON.stringify(reflow)}`,
      ).toBeLessThanOrEqual(reflow.width);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(() =>
          Number(document.documentElement.dataset.holonCspFailures ?? "0"),
        ),
      ).toBe(0);
      await page.screenshot({
        path: `proof-results/m7-${info.project.name}-${locale}-${name}.png`,
        fullPage:
          !(await dialog.count()) &&
          !(await page.getByRole("menu").isVisible()),
      });
    };
    for (const theme of ["light", "dark"]) {
      for (const viewport of [
        { width: 1440, height: 1000, name: "desktop" },
        { width: 320, height: 720, name: "mobile" },
      ]) {
        await page.setViewportSize(viewport);
        const suffix = `${theme}-${viewport.name}`;
        await page.goto(
          `/account?lang=${locale}&theme=${theme}&workspace=${workspace}`,
        );
        await capture(`account-empty-${suffix}`);
        await openCreateWorkspace(page);
        await capture(`workspace-sheet-${suffix}`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await expect(
          page.getByRole("button", { name: "Workspace", exact: true }),
        ).toBeFocused();
        await accountTrigger(page).click();
        await expect(page.getByRole("menuitem")).toHaveCount(2);
        await capture(`account-menu-${suffix}`);
        await page.keyboard.press("Escape");
        await loadWorkspaces(page);
        await page
          .getByRole("button", {
            name: pt ? "Escolher um repositório" : "Choose a repository",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("list", {
            name: pt ? "Repositórios autorizados" : "Authorized repositories",
          }),
        ).toContainText(`synthetic-${subject}/reviews`);
        await capture(`account-${suffix}`);
        await page
          .getByRole("link", {
            name: new RegExp(pt ? "Abrir reviews" : "Open reviews"),
          })
          .click();
        await expect(
          page.getByRole("heading", {
            name: pt ? "Revisões" : "Reviews",
            level: 1,
            exact: true,
          }),
        ).toBeVisible();
        expect(new URL(page.url()).searchParams.get("theme")).toBe(
          theme === "dark" ? "dark" : null,
        );
        await capture(`list-${suffix}`);
        const review = page.getByRole("link", {
          name: "#1 · Synthetic revisão 1",
          exact: true,
        });
        await review.focus();
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("heading", { name: "#1 · Synthetic revisão 1" }),
        ).toBeFocused();
        await capture(`detail-${suffix}`);
        await page.keyboard.press("Escape");
        await expect(review).toBeFocused();
        await page
          .getByRole("link", {
            name: pt ? "Dashboard" : "Dashboard",
            exact: true,
          })
          .click();
        const preferences = accountTrigger(page);
        await preferences.focus();
        await page.keyboard.press("Enter");
        const preferencesItem = page.getByRole("menuitem", {
          name: pt ? "Preferências" : "Preferences",
          exact: true,
        });
        await preferencesItem.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(page.getByRole("dialog")).toHaveCSS(
          "transition-duration",
          "0s",
        );
        await page.keyboard.press("Escape");
        await expect(preferences).toBeFocused();
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/reviews?${scope}`);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await capture("list-css-zoom-200");
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
    await page.goto(`/invitations/synthetic-unknown?lang=${locale}`);
    await capture("invitation-unavailable");
    await page.goto(`/reviews?${scope}&search=unmatched`);
    await capture("list-empty");
    await page.route("**/api/reviews/**", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "access_denied" } }),
      }),
    );
    await page
      .getByRole("button", { name: pt ? "Atualizar" : "Refresh", exact: true })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    await capture("list-denied");
  });
}

test("a committed invitation with a lost response retries the same recipient across workspace changes", async ({
  page,
}, info) => {
  const subject =
    414001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  const personal = await signIn(page, subject);
  await openCreateWorkspace(page);
  await page
    .getByLabel("Team name", { exact: true })
    .fill("Synthetic immutable invitation");
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await chooseWorkspace(page, { label: "Synthetic immutable invitation" });
  const id = await workspaceId(page);
  const email = page.getByLabel("Recipient email", { exact: true });
  await email.fill(`alias-${subject + 1}@example.invalid`);
  let lost = false;
  const payloads: unknown[] = [];
  const receipts: { id: string }[] = [];
  await page.route(`**/api/workspaces/${id}/invitations`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    payloads.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    receipts.push(await response.json());
    if (!lost) {
      lost = true;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Record invitation", exact: true })
    .click();
  await expect(email).toBeDisabled();
  await chooseWorkspace(page, personal);
  await chooseWorkspace(page, id);
  await expect(email).toBeDisabled();
  await expect(email).toHaveValue(`alias-${subject + 1}@example.invalid`);
  await page
    .getByRole("button", { name: "Record invitation", exact: true })
    .click();
  await expect(email).toBeEnabled();
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);
  expect(receipts[1]?.id).toBe(receipts[0]?.id);
  const invitations = await (
    await page.request.get(`/api/workspaces/${id}/invitations`)
  ).json();
  expect(invitations).toHaveLength(1);
  expect(invitations[0].id).toBe(receipts[0]?.id);
  expect(
    (
      await (
        await page.request.get(`/__test/invitation/proof?id=${receipts[0]?.id}`)
      ).json()
    ).intent,
  ).toEqual({ state: "pending", attempts: 0 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `proof-results/m7-${info.project.name}-en-team-invitation.png`,
    fullPage: true,
  });
});

test("a late repository response cannot restore the previous workspace snapshot", async ({
  page,
}, info) => {
  const subject =
    415001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  const personal = await signIn(page, subject);
  await openCreateWorkspace(page);
  await page
    .getByLabel("Team name", { exact: true })
    .fill("Synthetic next workspace");
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await chooseWorkspace(page, personal);
  const release = Promise.withResolvers<void>();
  const received = Promise.withResolvers<void>();
  await page.route(
    `**/api/workspaces/${personal}/github/repositories`,
    async (route) => {
      const response = await route.fetch();
      received.resolve();
      await release.promise;
      await route.fulfill({ response });
    },
  );
  try {
    await page
      .getByRole("button", { name: "Choose a repository", exact: true })
      .click();
    await received.promise;
    await chooseWorkspace(page, { label: "Synthetic next workspace" });
    release.resolve();
    await expect(
      page.getByRole("heading", { name: "Synthetic next workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Authorized repositories" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Choose a repository", exact: true })
      .click();
    await expect(
      page.getByRole("list", { name: "Authorized repositories" }),
    ).toBeEmpty();
  } finally {
    release.resolve();
  }
});

test("browser history changes workspace scope without reads and fences a late response", async ({
  page,
}, info) => {
  const subject =
    419001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  const personal = await signIn(page, subject);
  await openCreateWorkspace(page);
  await page
    .getByLabel("Team name", { exact: true })
    .fill("Synthetic history workspace");
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic history workspace",
      exact: true,
    }),
  ).toBeVisible();
  const team = await workspaceId(page);
  await chooseWorkspace(page, personal);
  await chooseWorkspace(page, team);
  // A transport that cannot cancel still must not apply a previous URL scope.
  await page.evaluate((teamId) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (url.pathname !== `/api/workspaces/${teamId}/github/repositories`)
        return originalFetch(input, init);
      const response = await originalFetch(input, {
        ...init,
        signal: null,
      });
      const originalJson = response.json.bind(response);
      response.json = async () => {
        const body = await originalJson();
        document.documentElement.dataset.historyResponseRead = "yes";
        return body;
      };
      return response;
    };
  }, team);
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(
    `**/api/workspaces/${team}/github/repositories`,
    async (route) => {
      const response = await route.fetch();
      received.resolve();
      await release.promise;
      await route.fulfill({ response });
    },
  );
  const reads: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname.startsWith("/api/workspaces")
    )
      reads.push(new URL(request.url()).pathname);
  });
  try {
    await page
      .getByRole("button", { name: "Choose a repository", exact: true })
      .click();
    await received.promise;
    const beforeHistory = reads.length;
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`workspace=${personal}`, "u"));
    await expect(
      page.getByRole("button", { name: "Workspace", exact: true }),
    ).toHaveAttribute("data-workspace-id", personal);
    await expect(
      page.getByRole("list", { name: "Authorized repositories" }),
    ).toHaveCount(0);
    release.resolve();
    await expect(page.locator("html")).toHaveAttribute(
      "data-history-response-read",
      "yes",
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(
      page.getByRole("list", { name: "Authorized repositories" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Choose a repository", exact: true }),
    ).toBeEnabled();
    expect(reads).toHaveLength(beforeHistory);
    await page
      .getByRole("button", { name: "Choose a repository", exact: true })
      .click();
    await expect(
      page.getByRole("list", { name: "Authorized repositories" }),
    ).toBeVisible();
    expect(reads.at(-1)).toBe(
      `/api/workspaces/${personal}/github/repositories`,
    );
    const beforeForward = reads.length;
    await page.goForward();
    await expect(
      page.getByRole("button", { name: "Workspace", exact: true }),
    ).toHaveAttribute("data-workspace-id", team);
    await expect(
      page.getByRole("list", { name: "Authorized repositories" }),
    ).toHaveCount(0);
    expect(reads).toHaveLength(beforeForward);
  } finally {
    release.resolve();
  }
});
