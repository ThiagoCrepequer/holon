import { expect, test, type Page } from "@playwright/test";
const origin = "https://127.0.0.1:8795";
async function signIn(page: Page, subject: number) {
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
  await page.goto("/?lang=en");
  await page
    .getByRole("button", { name: "Sign in with GitHub", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Active sessions", exact: true }),
  ).toBeVisible();
  await page.waitForLoadState("load");
  await page
    .getByRole("button", { name: "Manage workspaces", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create my personal workspace", exact: true })
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
  await expect(page.getByLabel("GitHub installation ID")).toBeVisible();
  const workspace = await page
    .getByLabel("Workspace", { exact: true })
    .inputValue();
  await page
    .getByLabel("GitHub installation ID")
    .fill(String(subject + 100000));
  await page.getByRole("button", { name: "Verify ownership and link" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm connection change" }),
  ).toBeVisible();
  await page.waitForLoadState("load");
  await page.getByRole("button", { name: "Confirm connection change" }).click();
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
test("native SSR: zero hydration reads, one explicit read per filter/page/detail/refresh and no hostile HTML execution", async ({
  page,
}, info) => {
  const subject =
    170001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  const workspace = await signIn(page, subject);
  expect(
    (
      await page.request.post("/__test/reviews/seed", { data: { subject } })
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () =>
        await (
          await page.request.get(`/__test/reviews/proof?subject=${subject}`)
        ).json(),
    )
    .toEqual({ total: 65, completed: 65 });
  const path = `/reviews?workspace=${workspace}&installation=${subject + 100000}&repository=${subject + 200000}`;
  const reads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/reviews/"))
      reads.push(request.url());
  });
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Reviews", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("65 results", { exact: true })).toBeVisible();
  expect(reads).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => reads.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "Next page", exact: true }).click();
  await expect(page.locator('a[href*="pullRequest="]')).toHaveCount(15);
  expect(reads).toHaveLength(2);
  await page.getByLabel("Search title or PR number").fill("revisao 1");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByText("11 results", { exact: true })).toBeVisible();
  expect(reads).toHaveLength(3);
  await page.locator('a[href*="pullRequest=19"]').click();
  await expect(
    page.getByRole("heading", { name: "#19 · Synthetic revisão 19" }),
  ).toBeVisible();
  expect(reads).toHaveLength(4);
  await expect(
    page.getByText("Synthetic evidence </script><svg onload=hostile()>", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "holonHostile")),
  ).toBeUndefined();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => reads.length).toBe(4);
});
test("a revoked grant hides the visible dataset and denied SSR never dehydrates it", async ({
  page,
}, info) => {
  const subject =
      180001 +
      ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10,
    workspace = await signIn(page, subject);
  expect(
    (
      await page.request.post("/__test/reviews/seed", {
        data: { subject, count: 1 },
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
    .toEqual({ total: 1, completed: 1 });
  const path = `/reviews?workspace=${workspace}&installation=${subject + 100000}&repository=${subject + 200000}`;
  await page.goto(path);
  await expect(page.getByText("1 results", { exact: true })).toBeVisible();
  expect(
    (
      await page.request.post("/__test/access-event", {
        data: {
          action: "suspended",
          deliveryId: `m5-revoke-${subject}`,
          installationId: subject + 100000,
        },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Review data unavailable",
  );
  await expect(
    page.getByText("Synthetic revisão 1", { exact: false }),
  ).toHaveCount(0);
  const denied = await page.request.get(path);
  expect(denied.status()).toBe(403);
  expect(await denied.text()).not.toContain("Synthetic revisão 1");
});

test("navigation cancels an in-flight refresh and keeps the new dataset refreshable", async ({
  page,
}, info) => {
  const subject =
    190001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  const workspace = await signIn(page, subject);
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
  await page.goto(
    `/reviews?workspace=${workspace}&installation=${subject + 100000}&repository=${subject + 200000}`,
  );
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve)),
    reached = new Promise<void>((resolve) => (entered = resolve));
  await page.route(
    (url) =>
      url.pathname === "/api/reviews/list" && !url.searchParams.has("search"),
    async (route) => {
      const response = await route.fetch();
      entered();
      await held;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  try {
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await reached;
    await page.getByLabel("Search title or PR number").fill("1");
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(page.getByText("1 results", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled();
    release();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled();
    await expect(page.getByText("1 results", { exact: true })).toBeVisible();
  } finally {
    release();
  }
});

test("concurrent SSR users keep datasets, locales and timestamps isolated", async ({
  browser,
}, info) => {
  const offset =
    ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
  const contexts = await Promise.all([
    browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true }),
    browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true }),
  ]);
  try {
    const subjects = [200001 + offset, 210001 + offset],
      pages = await Promise.all(contexts.map((context) => context.newPage()));
    const workspaces = await Promise.all(
      pages.map((page, index) => signIn(page, subjects[index]!)),
    );
    await Promise.all(
      pages.map(async (page, index) => {
        const subject = subjects[index]!;
        expect(
          (
            await page.request.post("/__test/reviews/seed", {
              data: { subject, count: index + 1 },
            })
          ).status(),
        ).toBe(200);
        await expect
          .poll(
            async () =>
              await (
                await page.request.get(
                  `/__test/reviews/proof?subject=${subject}`,
                )
              ).json(),
          )
          .toEqual({ total: index + 1, completed: index + 1 });
      }),
    );
    const responses = await Promise.all(
      pages.map((page, index) =>
        page.request.get(
          `/reviews?workspace=${workspaces[index]}&installation=${subjects[index]! + 100000}&repository=${subjects[index]! + 200000}&lang=${index === 0 ? "en" : "pt-BR"}`,
        ),
      ),
    );
    const documents = await Promise.all(
      responses.map(async (response) => {
        expect(response.status()).toBe(200);
        expect(response.headers()["cache-control"]).toBe("private, no-store");
        return response.text();
      }),
    );
    expect(documents[0]).toContain('lang="en"');
    expect(documents[1]).toContain('lang="pt-BR"');
    expect(documents[0]).not.toContain("Synthetic revisão 2");
    expect(documents[1]).toContain("Synthetic revisão 2");
    for (const [index, document] of documents.entries()) {
      expect(document).toContain("dataUpdatedAt");
      expect(document).not.toContain(workspaces[1 - index]!);
      for (const secret of [
        "synthetic-secret-at-least",
        "access_token",
        "GITHUB_APP_PRIVATE_KEY",
        "encryptedToken",
      ])
        expect(document).not.toContain(secret);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
