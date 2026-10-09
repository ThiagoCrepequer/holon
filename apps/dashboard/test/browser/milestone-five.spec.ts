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
    97001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10;
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
      98001 + ["chromium", "firefox", "webkit"].indexOf(info.project.name) * 10,
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
