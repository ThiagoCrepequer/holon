import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
const origin = "https://127.0.0.1:8795";
async function signIn(page: Page, subject: number, locale = "en") {
  let flows = 0;
  await page
    .context()
    .setExtraHTTPHeaders({ "X-Holon-Test-Client": String(subject) });
  await page.route(
    "https://github.com/login/oauth/authorize**",
    async (route) => {
      const authorizationURL = route.request().url();
      const code = `m3-${subject}-${++flows}`;
      expect(
        (
          await page.request.post("/__test/provider/authorize", {
            data: { authorizationURL, code, subject },
          })
        ).status(),
      ).toBe(200);
      const authorization = new URL(authorizationURL);
      const callback = new URL(origin + "/__test/provider/authorization");
      callback.searchParams.set("code", code);
      callback.searchParams.set(
        "state",
        authorization.searchParams.get("state")!,
      );
      await route.continue({ url: callback.href });
    },
  );
  await page.goto(`/?lang=${locale}`);
  await page
    .getByRole("button", {
      name: locale === "en" ? "Sign in with GitHub" : "Entrar com GitHub",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: /^(Active sessions|Sessões ativas)$/ }),
  ).toBeVisible();
  // OAuth navigates to an SSR document before its client scripts finish loading.
  await page.waitForLoadState("load");
}
async function createTeam(page: Page, name: string, portuguese = false) {
  await page
    .getByRole("button", {
      name: portuguese ? "Gerenciar workspaces" : "Manage workspaces",
    })
    .click();
  await expect(
    page.getByLabel(portuguese ? "Nome da equipe" : "Team name"),
  ).toBeVisible();
  await page.getByLabel(portuguese ? "Nome da equipe" : "Team name").fill(name);
  await page
    .getByRole("button", {
      name: portuguese ? "Criar equipe" : "Create team",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Workspace", { exact: true })).toContainText(
    name,
  );
  await page
    .getByLabel("Workspace", { exact: true })
    .selectOption({ label: name });
}
test("owner records invitation and a verified non-primary recipient accepts through the real API", async ({
  page,
  browser,
}, info) => {
  const subject =
    81001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  await signIn(page, subject);
  await createTeam(page, "Synthetic collaboration");
  await page
    .getByLabel("Recipient email")
    .fill(`alias-${subject + 1}@example.invalid`);
  await page
    .getByRole("button", { name: "Record invitation", exact: true })
    .click();
  const link = page.locator('a[href^="/invitations/"]');
  await expect(link).toHaveCount(1);
  const path = await link.getAttribute("href");
  const id = path!.split("/").pop()!;
  expect(
    await (await page.request.get(`/__test/invitation/proof?id=${id}`)).json(),
  ).toMatchObject({
    invitation: { state: "pending" },
    intent: { state: "pending", attempts: 0 },
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const recipient = await context.newPage();
  await signIn(recipient, subject + 1);
  await recipient.goto(path!);
  await expect(
    recipient.getByText("Synthetic collaboration", { exact: true }),
  ).toHaveCount(0);
  await recipient
    .getByRole("button", { name: "Confirm recipient and accept" })
    .click();
  await expect(recipient.getByRole("status")).toContainText(
    "Invitation accepted",
  );
  expect(
    await (await page.request.get(`/__test/invitation/proof?id=${id}`)).json(),
  ).toMatchObject({
    invitation: { state: "accepted" },
    intent: { state: "canceled", attempts: 0 },
  });
  await context.close();
});
test("connection requires native reauth, shows live state and receives private RPC invalidation", async ({
  page,
}, info) => {
  const subject =
    82001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  await signIn(page, subject);
  await createTeam(page, "Synthetic GitHub workspace");
  await page
    .getByLabel("GitHub installation ID")
    .fill(String(subject + 100000));
  await page.getByRole("button", { name: "Verify ownership and link" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm connection change" }),
  ).toBeVisible();
  await page.waitForLoadState("load");
  await page.getByRole("button", { name: "Confirm connection change" }).click();
  await expect(page.getByLabel("Workspace", { exact: true })).toContainText(
    "Synthetic GitHub workspace",
  );
  await page
    .getByLabel("Workspace", { exact: true })
    .selectOption({ label: "Synthetic GitHub workspace" });
  await page.getByRole("button", { name: "Refresh connections" }).click();
  await expect(page.getByRole("listitem")).toContainText(
    `${subject + 100000}: Active`,
  );
  const workspace = await page
    .getByLabel("Workspace", { exact: true })
    .inputValue();
  const scope = await page.request.get(
    `/api/workspaces/${workspace}/github/repositories`,
  );
  expect(scope.status()).toBe(200);
  expect(await scope.json()).toEqual({ repositoryIds: [subject + 200000] });
  expect(
    (
      await page.request.post("/__test/access-event", {
        data: {
          deliveryId: `event_${subject}`,
          installationId: subject + 100000,
          action: "suspended",
        },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Refresh connections" }).click();
  await expect(page.getByRole("listitem")).toContainText("Suspended");
  expect(
    await (
      await page.request.get(`/api/workspaces/${workspace}/github/repositories`)
    ).json(),
  ).toEqual({ repositoryIds: [] });
});
test("Portuguese controls are accessible at 320px and scanners cannot accept or expose invitations", async ({
  page,
}, info) => {
  const subject =
    83001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  await page.setViewportSize({ width: 320, height: 900 });
  await signIn(page, subject, "pt-BR");
  await createTeam(page, "Equipe sintética", true);
  await page
    .getByLabel("Email do destinatário")
    .fill(`alias-${subject + 1}@example.invalid`);
  await page.getByRole("button", { name: "Registrar convite" }).click();
  await expect(page.locator('a[href^="/invitations/"]')).toHaveCount(1);
  const path = (await page
    .locator('a[href^="/invitations/"]')
    .getAttribute("href"))!;
  const id = path.split("/").pop()!;
  for (const method of ["GET", "HEAD"])
    expect(
      (await page.request.fetch(`/api/invitations/${id}`, { method })).status(),
    ).toBe(200);
  expect(
    (
      await page.request.post(`/api/invitations/${id}/accept`, { data: {} })
    ).status(),
  ).toBe(403);
  expect(
    await (await page.request.get(`/__test/invitation/proof?id=${id}`)).json(),
  ).toMatchObject({ invitation: { state: "pending" } });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Cancelar convite" }).click();
  await expect(page.getByRole("listitem")).toContainText("Cancelado");
});

for (const locale of ["en", "pt-BR"])
  test(`email status distinguishes provider acceptance and unknown result in ${locale}`, async ({
    page,
  }, info) => {
    const subject =
      85001 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 +
      (locale === "en" ? 0 : 100);
    await signIn(page, subject, locale);
    await createTeam(page, "Synthetic delivery", locale === "pt-BR");
    const pt = locale === "pt-BR";
    await expect(
      page.getByText(
        pt
          ? "Tentativas limitadas podem enviar o mesmo convite mais de uma vez. A aceitação pelo provedor não confirma a entrega na caixa de entrada."
          : "Limited retries may send the same invitation more than once. Provider acceptance does not confirm inbox delivery.",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByLabel(pt ? "Email do destinatário" : "Recipient email")
      .fill(`alias-${subject + 1}@example.invalid`);
    await page
      .getByRole("button", {
        name: pt ? "Registrar convite" : "Record invitation",
        exact: true,
      })
      .click();
    const link = page.locator('a[href^="/invitations/"]');
    await expect(link).toHaveCount(1);
    const jobId = (await link.getAttribute("href"))!.split("/").pop();
    await expect(
      page.getByText(pt ? "Email agendado" : "Email scheduled", {
        exact: false,
      }),
    ).toBeVisible();
    expect(
      (
        await page.request.post("/__test/email", {
          data: { jobId, outcome: "accepted" },
        })
      ).status(),
    ).toBe(200);
    await page
      .getByRole("button", {
        name: pt ? "Atualizar convites" : "Refresh invitations",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(
        pt
          ? "Aceito pelo provedor de email; entrega na caixa de entrada não confirmada"
          : "Accepted by email provider; inbox delivery unconfirmed",
        { exact: false },
      ),
    ).toBeVisible();
    await page
      .getByLabel(pt ? "Email do destinatário" : "Recipient email")
      .fill(`alias-${subject + 2}@example.invalid`);
    await page
      .getByRole("button", {
        name: pt ? "Registrar convite" : "Record invitation",
        exact: true,
      })
      .click();
    await expect(link).toHaveCount(2);
    const unknownId = (await link.last().getAttribute("href"))!
      .split("/")
      .pop();
    expect(
      (
        await page.request.post("/__test/email", {
          data: { jobId: unknownId, outcome: "unknown" },
        })
      ).status(),
    ).toBe(200);
    await page
      .getByRole("button", {
        name: pt ? "Atualizar convites" : "Refresh invitations",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(
        pt
          ? "Resultado do email desconhecido; uma tentativa limitada pode enviar uma duplicata"
          : "Email result unknown; a limited retry may send a duplicate",
        { exact: false },
      ),
    ).toBeVisible();
    await page
      .getByLabel(pt ? "Email do destinatário" : "Recipient email")
      .fill(`alias-${subject + 3}@example.invalid`);
    await page
      .getByRole("button", {
        name: pt ? "Registrar convite" : "Record invitation",
        exact: true,
      })
      .click();
    await expect(link).toHaveCount(3);
    const failedId = (await link.last().getAttribute("href"))!.split("/").pop();
    expect(
      (
        await page.request.post("/__test/email", {
          data: { jobId: failedId, outcome: "permanent" },
        })
      ).status(),
    ).toBe(200);
    await page
      .getByRole("button", {
        name: pt ? "Atualizar convites" : "Refresh invitations",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(
        pt ? "Entrega de email interrompida" : "Email delivery stopped",
        { exact: false },
      ),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
