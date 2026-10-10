import { expect, type Page } from "@playwright/test";
export function accountTrigger(page: Page) {
  return page.getByRole("button", {
    name: /^(Account menu|Menu da conta)$/u,
    exact: true,
  });
}
export async function openPreferences(page: Page) {
  const trigger = accountTrigger(page);
  await trigger.click();
  await page
    .getByRole("menuitem", {
      name: /^(Preferences|Preferências)$/u,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  return trigger;
}
export async function openWorkspaces(page: Page) {
  const trigger = page.getByRole("button", { name: "Workspace", exact: true });
  await trigger.click();
  await expect(
    page.getByRole("menuitem", {
      name: /^(Create a workspace|Criar workspace)$/u,
      exact: true,
    }),
  ).toBeEnabled();
}
export async function loadWorkspaces(page: Page) {
  await openWorkspaces(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}
export async function chooseWorkspace(
  page: Page,
  choice: string | { label: string },
) {
  if (!(await page.getByRole("menuitemradio").first().isVisible()))
    await openWorkspaces(page);
  const item =
    typeof choice === "string"
      ? page
          .getByRole("menuitemradio")
          .and(page.locator(`[data-workspace-id="${choice}"]`))
      : page.getByRole("menuitemradio", { name: choice.label, exact: true });
  const selectedId = await item.getAttribute("data-workspace-id");
  expect(selectedId).toBeTruthy();
  await item.click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Workspace", exact: true }),
  ).toHaveAttribute("data-workspace-id", selectedId!);
}
export async function openCreateWorkspace(page: Page) {
  if (!(await page.getByRole("menu").isVisible())) await openWorkspaces(page);
  await page
    .getByRole("menuitem", {
      name: /^(Create a workspace|Criar workspace)$/u,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
export async function workspaceId(page: Page) {
  const id = await page
    .getByRole("button", { name: "Workspace", exact: true })
    .getAttribute("data-workspace-id");
  expect(id).toBeTruthy();
  return id!;
}

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
      name: pt ? "Menu da conta" : "Account menu",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await page.waitForLoadState("load");
  await openCreateWorkspace(page);
  await page
    .getByRole("button", {
      name: pt ? "Criar meu workspace pessoal" : "Create my personal workspace",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Workspace", exact: true }),
  ).toHaveAttribute("data-workspace-id", /.+/);
  const installation = page.getByLabel(
    pt ? "ID da instalação GitHub" : "GitHub installation ID",
  );
  await expect(installation).toBeVisible();
  const workspace = await workspaceId(page);
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
      {
        installationId: subject + 100000,
        repositoryId: subject + 200000,
        fullName: `synthetic-${subject}/reviews`,
      },
    ]);
  return workspace;
}

/** End each HTTPS/Workerd event before the next batch; all rows still use real ledgers. */
export async function seedReviews(
  page: Page,
  subject: number,
  count = 65,
  findingCount = 0,
) {
  for (let offset = 0; offset < count; offset += 10) {
    const batch = Math.min(10, count - offset);
    const response = await page.request.post("/__test/reviews/seed", {
      data: { subject, count: batch, offset, findingCount },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ seeded: batch });
  }
  await expect
    .poll(async () =>
      (
        await page.request.get(`/__test/reviews/proof?subject=${subject}`)
      ).json(),
    )
    .toEqual({ total: count, completed: count });
}
