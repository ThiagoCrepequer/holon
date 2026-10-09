import { expect, type Page } from "@playwright/test";
const origin = "https://127.0.0.1:8795";
export async function signIn(page: Page, subject: number, locale = "en") {
  const pt = locale === "pt-BR";
  let flows = 0;
  await page
    .context()
    .setExtraHTTPHeaders({ "X-Holon-Test-Client": String(subject) });
  await page.route(
    "https://github.com/login/oauth/authorize**",
    async (route) => {
      const authorizationURL = route.request().url(),
        code = `m5-${subject}-${++flows}`;
      expect(
        (
          await page.request.post("/__test/provider/authorize", {
            data: { authorizationURL, code, subject },
          })
        ).status(),
      ).toBe(200);
      const authorization = new URL(authorizationURL),
        callback = new URL(origin + "/__test/provider/authorization");
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
      name: pt ? "Entrar com GitHub" : "Sign in with GitHub",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: pt ? "Sessões ativas" : "Active sessions",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await page.waitForLoadState("load");
  await page
    .getByRole("button", {
      name: pt ? "Gerenciar workspaces" : "Manage workspaces",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: pt ? "Criar meu workspace pessoal" : "Create my personal workspace",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Workspace", { exact: true }).locator("option"),
  ).toHaveCount(2);
  const personal = await page
    .getByLabel("Workspace", { exact: true })
    .locator("option")
    .nth(1)
    .getAttribute("value");
  await page
    .getByLabel("Workspace", { exact: true })
    .selectOption(personal ?? "");
  const installation = page.getByLabel(
    pt ? "ID da instalação GitHub" : "GitHub installation ID",
  );
  await expect(installation).toBeVisible();
  const workspace = await page
    .getByLabel("Workspace", { exact: true })
    .inputValue();
  await installation.fill(String(subject + 100000));
  await page
    .getByRole("button", {
      name: pt
        ? "Verificar titularidade e vincular"
        : "Verify ownership and link",
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: pt ? "Confirmar mudança na conexão" : "Confirm connection change",
    }),
  ).toBeVisible();
  await page.waitForLoadState("load");
  await page
    .getByRole("button", {
      name: pt ? "Confirmar mudança na conexão" : "Confirm connection change",
    })
    .click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/workspaces/${workspace}/github/repositories`,
      );
      return response.status() === 200
        ? (await response.json()).repositories
        : [];
    })
    .toEqual([
      { installationId: subject + 100000, repositoryId: subject + 200000 },
    ]);
  return workspace;
}
