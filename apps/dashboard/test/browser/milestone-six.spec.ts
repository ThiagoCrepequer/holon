import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  signIn,
  accountTrigger,
  chooseWorkspace,
  loadWorkspaces,
  openCreateWorkspace,
  openPreferences,
  workspaceId,
} from "../support/browser-journey.js";

for (const locale of ["en", "pt-BR"]) {
  const pt = locale === "pt-BR";
  test(`${locale}: workspace menu waits for its manual read before enabling creation`, async ({
    page,
  }, info) => {
    const subject =
      308001 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 +
      (pt ? 1 : 0);
    await signIn(page, subject, locale);
    await page.goto(`/account?lang=${locale}`);
    const blocked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await page.route("**/api/workspaces", async (route) => {
      blocked.resolve();
      await release.promise;
      await route.continue();
    });
    try {
      await page
        .getByRole("button", { name: "Workspace", exact: true })
        .click();
      await blocked.promise;
      const create = page.getByRole("menuitem", {
        name: pt ? "Criar workspace" : "Create a workspace",
        exact: true,
      });
      await expect(create).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Escape");
      release.resolve();
      await openCreateWorkspace(page);
      await expect(
        page.getByLabel(pt ? "Nome da equipe" : "Team name", { exact: true }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Workspace", exact: true }),
      ).toBeFocused();
    } finally {
      release.resolve();
    }
  });
  test(`${locale}: login and account actions wait for hydration before accepting the first click`, async ({
    page,
    browser,
  }, info) => {
    const subject =
      307001 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 +
      (pt ? 1 : 0);
    const signInName = pt ? "Entrar com GitHub" : "Sign in with GitHub";
    const accountName = pt ? "Menu da conta" : "Account menu";
    for (const action of ["signin", "preferences", "signout"]) {
      if (action === "preferences") await signIn(page, subject, locale);
      // Fresh contexts prevent WebKit's warm module cache from bypassing interception.
      const context = await browser.newContext({
        ...(action === "signin"
          ? {}
          : { storageState: await page.context().storageState() }),
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { "X-Holon-Test-Client": String(subject) },
      });
      const cold = await context.newPage();
      const scripts = Promise.withResolvers<void>();
      const blocked = Promise.withResolvers<void>();
      await cold.route("**/assets/*.js", async (route) => {
        blocked.resolve();
        await scripts.promise;
        await route.continue();
      });
      try {
        await cold.goto(
          `https://127.0.0.1:8795${action === "signin" ? "/" : "/account"}?lang=${locale}`,
          { waitUntil: "commit" },
        );
        await blocked.promise;
        const names = action === "signin" ? [signInName] : [accountName];
        for (const name of names)
          await expect(
            cold.getByRole("button", { name, exact: true }),
          ).toBeDisabled();
        scripts.resolve();
        for (const name of names)
          await expect(
            cold.getByRole("button", { name, exact: true }),
          ).toBeEnabled();
        if (action === "signin") {
          await cold.route(
            "https://github.com/login/oauth/authorize**",
            (route) => route.abort(),
          );
          const response = cold.waitForResponse(
            (r) =>
              r.url().includes("/api/auth/sign-in/social") &&
              r.request().method() === "POST",
          );
          const authorization = cold.waitForRequest(
            "https://github.com/login/oauth/authorize**",
          );
          await cold
            .getByRole("button", { name: signInName, exact: true })
            .click();
          expect((await response).status()).toBe(200);
          expect(
            new URL((await authorization).url()).searchParams.get("state"),
          ).toBeTruthy();
        } else if (action === "preferences") {
          await openPreferences(cold);
          await expect(cold.getByRole("dialog")).toBeVisible();
        } else {
          const response = cold.waitForResponse(
            (r) =>
              r.url().includes("/api/auth/sign-out") &&
              r.request().method() === "POST",
          );
          await accountTrigger(cold).click();
          await cold
            .getByRole("menuitem", {
              name: pt ? "Sair" : "Sign out",
              exact: true,
            })
            .click();
          expect((await response).status()).toBe(200);
          await expect(
            cold.getByRole("button", { name: signInName, exact: true }),
          ).toBeVisible();
          await expect(
            cold.getByRole("button", { name: accountName, exact: true }),
          ).toHaveCount(0);
        }
      } finally {
        scripts.resolve();
        await context.close();
      }
    }
  });
  test(`${locale}: back/forward restores filter controls and revalidates the dataset`, async ({
    page,
  }, info) => {
    const subject =
      300001 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 +
      (locale === "en" ? 0 : 1);
    const workspace = await signIn(page, subject, locale);
    expect(
      (
        await page.request.post("/__test/reviews/seed", {
          data: { subject, count: 2 },
        })
      ).status(),
    ).toBe(200);
    await expect
      .poll(
        async () =>
          await (
            await page.request.get(`/__test/reviews/proof?subject=${subject}`)
          ).json(),
      )
      .toEqual({ total: 2, completed: 2 });
    const url = `/reviews?workspace=${workspace}&installation=${subject + 100000}&repository=${subject + 200000}&search=1&lang=${locale}`;
    await page.goto(url);
    const input = page.getByLabel(
      locale === "en"
        ? "Search title or PR number"
        : "Buscar título ou número do PR",
    );
    await expect(input).toHaveValue("1");
    await input.fill("2");
    await page
      .getByRole("button", {
        name: locale === "en" ? "Apply filters" : "Aplicar filtros",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("link", { name: "#2 · Synthetic revisão 2" }),
    ).toBeVisible();
    await page.goBack();
    await expect(input).toHaveValue("1");
    await expect(
      page.getByRole("link", { name: "#1 · Synthetic revisão 1" }),
    ).toBeVisible();
    await page.goForward();
    await expect(input).toHaveValue("2");
    await expect(
      page.getByRole("link", { name: "#2 · Synthetic revisão 2" }),
    ).toBeVisible();
  });
}

for (const locale of ["en", "pt-BR"]) {
  const pt = locale === "pt-BR";
  test(`${locale}: unknown team creation retains its intention, repository entry and last-owner controls`, async ({
    page,
  }, info) => {
    const subject =
      301001 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 +
      (pt ? 1 : 0);
    await signIn(page, subject, locale);
    await page.goto(`/account?lang=${locale}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.screenshot({
      path: `proof-results/m6-${info.project.name}-${locale}-account-desktop.png`,
    });
    await openCreateWorkspace(page);
    const name = page.getByLabel(pt ? "Nome da equipe" : "Team name", {
      exact: true,
    });
    await name.fill("Synthetic recovery team");
    const operations: string[] = [];
    let lost = false;
    await page.route("**/api/workspaces/team", async (route) => {
      operations.push(route.request().postDataJSON().operationId);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (!lost) {
        lost = true;
        await route.abort("failed");
      } else await route.fulfill({ response });
    });
    const create = page.getByRole("button", {
      name: pt ? "Criar equipe" : "Create team",
      exact: true,
    });
    await create.click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      pt ? "Resultado desconhecido" : "Result unknown",
    );
    await expect(name).toBeDisabled();
    await create.click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(operations).toHaveLength(2);
    expect(new Set(operations).size).toBe(1);
    await chooseWorkspace(page, { label: "Synthetic recovery team" });
    await page
      .getByRole("button", {
        name: pt ? "Atualizar membros" : "Refresh members",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: pt ? "Sair do workspace" : "Leave workspace",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /^(Make member|Tornar membro):/ }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /^(Remove member|Remover membro):/ }),
    ).toBeDisabled();
    await chooseWorkspace(page, { label: "Personal" });
    await page
      .getByRole("button", {
        name: pt ? "Escolher um repositório" : "Choose a repository",
        exact: true,
      })
      .click();
    const repositoryLinks = page.getByRole("link", {
      name: new RegExp(pt ? "Abrir reviews" : "Open reviews"),
    });
    await expect(repositoryLinks).toHaveCount(1);
    const repositoryPath = `**/api/workspaces/*/github/repositories`;
    for (const status of [401, 503]) {
      await page.route(repositoryPath, (route) =>
        route.fulfill({ status, contentType: "application/json", body: "{}" }),
      );
      await page
        .getByRole("button", {
          name: pt ? "Escolher um repositório" : "Choose a repository",
          exact: true,
        })
        .click();
      await expect(repositoryLinks).toHaveCount(0);
      await page.unroute(repositoryPath);
      await page
        .getByRole("button", {
          name: pt ? "Escolher um repositório" : "Choose a repository",
          exact: true,
        })
        .click();
      await expect(repositoryLinks).toHaveCount(1);
    }
    const personal = await workspaceId(page);
    await page
      .getByText(
        pt ? "Gerenciar instalação do GitHub" : "Manage GitHub installation",
        { exact: true },
      )
      .click();
    await page
      .getByLabel(pt ? "ID da instalação GitHub" : "GitHub installation ID")
      .fill(String(subject + 100001));
    await page
      .getByRole("button", {
        name: pt
          ? "Verificar titularidade e vincular"
          : "Verify ownership and link",
        exact: true,
      })
      .click();
    const confirm = page.getByRole("button", {
      name: pt ? "Confirmar mudança na conexão" : "Confirm connection change",
      exact: true,
    });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(page.getByRole("alert")).toContainText(
      pt ? "Acesso negado" : "Access denied",
    );
    const current = await (
      await page.request.get(`/api/workspaces/${personal}/github`)
    ).json();
    expect(
      current.map(
        (connection: { installationId: number }) => connection.installationId,
      ),
    ).toEqual([subject + 100000]);
    await loadWorkspaces(page);
    await chooseWorkspace(page, personal);
    await page
      .getByRole("button", {
        name: pt ? "Escolher um repositório" : "Choose a repository",
        exact: true,
      })
      .click();
    await expect(repositoryLinks).toHaveCount(1);
    await page
      .getByRole("link", {
        name: new RegExp(pt ? "Abrir reviews" : "Open reviews"),
      })
      .click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: pt ? "Revisões" : "Reviews",
      }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("order")).toBe("activity");
  });

  test(`${locale}: 200 long findings paginate safely with keyboard continuity, reflow and live reduced motion`, async ({
    page,
  }, info) => {
    const subject =
      302001 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 +
      (pt ? 1 : 0);
    const workspace = await signIn(page, subject, locale);
    expect(
      (
        await page.request.post("/__test/reviews/seed", {
          data: { subject, count: 1, findingCount: 200 },
        })
      ).status(),
    ).toBe(200);
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/__test/reviews/proof?subject=${subject}`)
            ).json()
          ).completed,
      )
      .toBe(1);
    const list = `/reviews?workspace=${workspace}&installation=${subject + 100000}&repository=${subject + 200000}&lang=${locale}`;
    const external: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("tracker.example.invalid"))
        external.push(request.url());
    });
    await page.goto(list);
    const trigger = page.getByRole("link", {
      name: "#1 · Synthetic revisão 1",
    });
    await expect(trigger).toBeVisible();
    await page.screenshot({
      path: `proof-results/m6-${info.project.name}-${locale}-list-desktop.png`,
    });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.locator(".holon-review-markdown strong").first(),
    ).toHaveText("Synthetic summary");
    await page.screenshot({
      path: `proof-results/m6-${info.project.name}-${locale}-detail-desktop.png`,
    });
    const observed = new Set<string>();
    for (let batch = 0; batch < 20; batch++) {
      const findings = page.locator('li[id^="finding-"]');
      await expect(findings.first()).toHaveAttribute(
        "id",
        `finding-fp:${(batch * 10).toString(16).padStart(64, "0")}`,
      );
      await expect(findings).toHaveCount(10);
      for (const id of await findings.evaluateAll((nodes) =>
        nodes.map((node) => node.id),
      )) {
        expect(observed.has(id)).toBe(false);
        observed.add(id);
      }
      if (batch < 19)
        await page
          .getByRole("link", {
            name: pt ? "Mais achados" : "More findings",
            exact: true,
          })
          .click();
    }
    expect(observed.size).toBe(200);
    await expect(
      page.getByRole("link", {
        name: pt ? "Mais achados" : "More findings",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { holonHostile?: boolean }).holonHostile,
      ),
    ).toBeUndefined();
    expect(external).toEqual([]);
    expect(
      await page
        .locator(".holon-review-markdown img,.holon-review-markdown script")
        .count(),
    ).toBe(0);
    await expect(page.locator("figure pre").first()).toContainText(
      'const value = "<b>原文</b>";',
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    const reflow = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll("body *")]
        .filter(
          (node) =>
            !node.closest("pre") &&
            node.getBoundingClientRect().right > innerWidth + 1,
        )
        .map((node) => ({
          tag: node.tagName,
          class: node.className,
          width: node.getBoundingClientRect().width,
          length: node.textContent?.length,
          wrap: getComputedStyle(node).overflowWrap,
          wordBreak: getComputedStyle(node).wordBreak,
        }))
        .slice(0, 10),
    }));
    expect(reflow.scroll, JSON.stringify(reflow)).toBeLessThanOrEqual(
      reflow.width,
    );
    await page.locator("figure pre").first().focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() =>
        page
          .locator("figure pre")
          .first()
          .evaluate((node) => node.scrollLeft),
      )
      .toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByRole("main")).toHaveCSS("animation-name", "none");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page
      .getByRole("link", {
        name: "Dashboard",
        exact: true,
      })
      .click();
    const preferences = await openPreferences(page);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.keyboard.press("Escape");
    await openPreferences(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByRole("dialog")).toHaveCSS(
      "transition-duration",
      "0s",
    );
    await page.keyboard.press("Escape");
    await expect(preferences).toBeFocused();
    await page.screenshot({
      path: `proof-results/m6-${info.project.name}-${locale}-320-zoom200.png`,
      fullPage: true,
    });
  });
}

for (const locale of ["en", "pt-BR"]) {
  const pt = locale === "pt-BR";
  test(`${locale}: expired detail reconnects to its exact destination and restores heading focus`, async ({
    page,
  }, info) => {
    const subject =
      305001 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 +
      (pt ? 1 : 0);
    const workspace = await signIn(page, subject, locale);
    expect(
      (
        await page.request.post("/__test/reviews/seed", {
          data: { subject, count: 1, findingCount: 1 },
        })
      ).status(),
    ).toBe(200);
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/__test/reviews/proof?subject=${subject}`)
            ).json()
          ).completed,
      )
      .toBe(1);
    const destination = `/reviews/detail?workspace=${workspace}&installation=${subject + 100000}&repository=${subject + 200000}&pullRequest=1&search=1&order=activity&lang=${locale}`;
    await page.goto(destination);
    for (const boundary of ["refresh", "SSR"]) {
      const session = await (
        await page.request.get("/api/auth/session")
      ).json();
      expect(
        (
          await page.request.post("/__test/session/expire", {
            data: { sessionId: session.session.id },
          })
        ).status(),
      ).toBe(200);
      if (boundary === "refresh")
        await page
          .getByRole("button", {
            name: pt ? "Atualizar" : "Refresh",
            exact: true,
          })
          .click();
      else await page.reload();
      await expect(page.locator('li[id^="finding-"]')).toHaveCount(0);
      await page
        .getByRole("button", {
          name: pt ? "Entrar com GitHub" : "Sign in with GitHub",
          exact: true,
        })
        .click();
      await expect(page.locator("#review-detail-title")).toContainText(
        "Synthetic revisão 1",
      );
      await expect
        .poll(() => new URL(page.url()).pathname + new URL(page.url()).search)
        .toBe(destination);
      await expect(page.locator("#review-detail-title")).toBeFocused();
    }
    await page
      .getByRole("link", {
        name: "Dashboard",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/account\?/);
    await expect(
      page.getByRole("heading", {
        name: "Dashboard",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await page
      .getByRole("link", {
        name: pt ? "Voltar às revisões" : "Back to reviews",
        exact: true,
      })
      .click();
    await expect
      .poll(() => new URL(page.url()).pathname + new URL(page.url()).search)
      .toBe(destination);
  });
  test(`${locale}: team owners promote, demote and remove a verified recipient through scoped OAuth`, async ({
    page,
    browser,
  }, info) => {
    const subject =
      306001 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10 +
      (pt ? 2 : 0);
    await signIn(page, subject, locale);
    await page.goto(`/account?lang=${locale}`);
    await openCreateWorkspace(page);
    await page
      .getByLabel(pt ? "Nome da equipe" : "Team name", { exact: true })
      .fill("Synthetic governance");
    await page
      .getByRole("button", {
        name: pt ? "Criar equipe" : "Create team",
        exact: true,
      })
      .click();
    await chooseWorkspace(page, { label: "Synthetic governance" });
    const workspace = await workspaceId(page);
    await page
      .getByLabel(pt ? "Email do destinatário" : "Recipient email", {
        exact: true,
      })
      .fill(`alias-${subject + 1}@example.invalid`);
    await page
      .getByRole("button", {
        name: pt ? "Registrar convite" : "Record invitation",
        exact: true,
      })
      .click();
    const invitation = await page
      .locator('a[href^="/invitations/"]')
      .getAttribute("href");
    const context = await browser.newContext({ ignoreHTTPSErrors: true }),
      recipient = await context.newPage();
    try {
      await signIn(recipient, subject + 1, locale);
      await recipient.goto(`${invitation!}?lang=${locale}`);
      await recipient
        .getByRole("button", {
          name: pt
            ? "Confirmar destinatário e aceitar"
            : "Confirm recipient and accept",
          exact: true,
        })
        .click();
      await expect(recipient.getByRole("status")).toContainText(
        pt ? "Convite aceito" : "Invitation accepted",
      );
      await recipient.goto(`/account?workspace=${workspace}&lang=${locale}`);
      await loadWorkspaces(recipient);
      await recipient
        .getByRole("button", {
          name: pt ? "Atualizar membros" : "Refresh members",
          exact: true,
        })
        .click();
      await expect(recipient.locator("li[data-member-id]")).toHaveCount(2);
      await expect(
        recipient.getByRole("button", {
          name: /^(Promote to owner|Promover a owner|Make member|Tornar membro|Remove member|Remover membro):/,
        }),
      ).toHaveCount(0);
      await expect(
        recipient.getByLabel(pt ? "Email do destinatário" : "Recipient email", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        recipient.getByLabel(
          pt ? "ID da instalação GitHub" : "GitHub installation ID",
          { exact: true },
        ),
      ).toHaveCount(0);
      const memberPage = await (
        await page.request.get(`/api/workspaces/${workspace}/members`)
      ).json();
      const target = memberPage.members.find(
        (member: { role: string }) => member.role === "member",
      );
      expect(target).toBeDefined();
      for (const [label, role] of [
        [pt ? "Promover a owner" : "Promote to owner", "owner"],
        [pt ? "Tornar membro" : "Make member", "member"],
        [pt ? "Remover membro" : "Remove member", null],
      ]) {
        await page
          .getByRole("button", {
            name: pt ? "Atualizar membros" : "Refresh members",
            exact: true,
          })
          .click();
        await page
          .locator(`li[data-member-id="${target.userId}"]`)
          .getByRole("button", {
            name: `${label}: ${target.name}`,
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: pt
              ? "Confirmar alteração de membro"
              : "Confirm member change",
            exact: true,
          })
          .click();
        await expect
          .poll(async () => {
            const current = await (
              await page.request.get(`/api/workspaces/${workspace}/members`)
            ).json();
            return (
              current.members.find(
                (member: { userId: string }) => member.userId === target.userId,
              )?.role ?? null
            );
          })
          .toBe(role);
      }
    } finally {
      await context.close();
    }
  });
}
