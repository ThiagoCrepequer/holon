import { test, expect, type Page, type Route } from "@playwright/test";

import { hostileText } from "../app/fixture.js";

type Harness = {
  diagnostics(): {
    generation: number;
    active: number;
    ownership: { keys: number; confirmed: number; revoked: number };
    keys: unknown[][];
    snapshots: { key: unknown[]; data?: unknown }[];
  };
  load(path: string): Promise<unknown>;
  invalidate(): Promise<unknown>;
  identity(): unknown;
  data(): unknown;
  switchIdentity(): void;
};
declare global {
  interface Window {
    proofHarness: Harness;
    proofPending?: Promise<unknown>;
    proofXss?: boolean;
    proofCsp?: string[];
  }
}
async function boot(page: Page) {
  await page.goto("/proof/a");
  await expect(page.getByTestId("ready")).toHaveText("Hydrated");
  await expect(page.getByTestId("dataset")).toContainText("alice:a::1");
}
async function flush(page: Page) {
  // Flush browser rendering and Query's notification scheduler, not wall-clock sleeps.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
function reads(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/read/"))
      requests.push(request.url());
  });
  return requests;
}
function controlled() {
  let resolve!: (route: Route) => void;
  return {
    arrived: new Promise<Route>((next) => {
      resolve = next;
    }),
    handler: (route: Route) => {
      resolve(route);
    },
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.proofCsp = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.proofCsp?.push(event.violatedDirective),
    );
  });
});
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.proofCsp)).toEqual([]);
});

test("SSR isolates synthetic user, locale and timezone, framework escapes payload under nonce CSP", async ({
  page,
  request,
}) => {
  const [english, portuguese] = await Promise.all([
    request.get("/proof/a", {
      headers: {
        "x-proof-user": "alice",
        "x-proof-locale": "en",
        "x-proof-zone": "UTC",
      },
    }),
    request.get("/proof/a", {
      headers: {
        "x-proof-user": "bob",
        "x-proof-locale": "pt-BR",
        "x-proof-zone": "America/Sao_Paulo",
      },
    }),
  ]);
  expect(english.status()).toBe(200);
  expect(portuguese.status()).toBe(200);
  const [en, pt] = await Promise.all([english.text(), portuguese.text()]);
  expect(en).toContain("Read proof");
  expect(en).toContain("alice");
  expect(en).not.toContain("bob");
  expect(pt).toContain("Prova de leitura");
  expect(pt).toContain("bob");
  expect(pt).not.toContain("alice");
  expect(en).toContain("10:00");
  expect(pt).toContain("07:00");
  expect(en).not.toContain("<svg onload=");
  expect(en).not.toContain("<script>globalThis.proofXss");
  const csp = english.headers()["content-security-policy"];
  expect(csp).not.toBe(portuguese.headers()["content-security-policy"]);
  expect(csp).toContain("'nonce-");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
  expect(english.headers()["cache-control"]).toBe("no-store");
  expect(english.headers()["x-proof-use-case-reads"]).toBe("1");
  expect(portuguese.headers()["x-proof-use-case-reads"]).toBe("1");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await expect(page.getByTestId("hostile")).toHaveText(hostileText);
  expect(await page.evaluate(() => window.proofXss)).toBeUndefined();
  expect(await page.locator("svg").count()).toBe(0);
  await expect(page.getByTestId("links").getByRole("link")).toHaveCount(1);
  await expect(page.getByTestId("links").getByRole("link")).toHaveAttribute(
    "href",
    "https://github.com/holon/proof",
  );
  expect(await page.evaluate(() => window.proofCsp)).toEqual([]);
  expect(errors).toEqual([]);
});

test("hydration zero reads; navigation, filter, page, refresh and history each one; passive observer", async ({
  page,
}) => {
  const network = reads(page);
  const deliveries: Promise<{ url: string; count: string | undefined }>[] = [];
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname.startsWith("/proof/") ||
      new URL(response.url()).pathname.startsWith("/api/")
    )
      deliveries.push(
        response.allHeaders().then((headers) => ({
          url: response.url(),
          count: headers["x-proof-use-case-reads"],
        })),
      );
  });
  await boot(page);
  expect(network).toHaveLength(0);
  await page.getByRole("link", { name: "B", exact: true }).click();
  await expect(page.getByTestId("dataset")).toContainText("alice:b::1");
  expect(network).toHaveLength(1);
  await expect(page.getByRole("heading")).toBeFocused();
  await expect(page.getByTestId("announcement")).toHaveText("Read proof: b");
  await page.getByRole("textbox", { name: "Search" }).fill("café");
  await page.getByRole("textbox", { name: "Search" }).press("Enter");
  await expect(page.getByTestId("dataset")).toContainText("alice:b:café:1");
  expect(network).toHaveLength(2);
  await expect(page.getByRole("textbox", { name: "Search" })).toBeFocused();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("dataset")).toContainText("alice:b:café:2");
  expect(network).toHaveLength(3);
  const refreshed = page.waitForResponse(
    (response) => response.url().includes("/api/read/b") && response.ok(),
  );
  await page.getByRole("button", { name: "Refresh" }).focus();
  await page.getByRole("button", { name: "Refresh" }).press("Enter");
  await refreshed;
  await expect.poll(() => network.length).toBe(4);
  await flush(page);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeFocused();
  await page.goBack();
  await expect(page.getByTestId("dataset")).toContainText("alice:b:café:1");
  expect(network).toHaveLength(5);
  await page.evaluate(async () => {
    await window.proofHarness.invalidate();
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: "Remount observer" }).click();
  await expect(page.getByTestId("ready")).toHaveText("Hydrated");
  await flush(page);
  expect(network).toHaveLength(5);
  expect(
    await page.evaluate(() => window.proofHarness.diagnostics().ownership),
  ).toEqual({ keys: 0, confirmed: 0, revoked: 0 });
  const observed = await Promise.all(deliveries);
  expect(
    observed.find((value) => new URL(value.url).pathname === "/proof/a")?.count,
  ).toBe("1");
  for (const delivery of observed.filter((value) =>
    new URL(value.url).pathname.endsWith(".data"),
  ))
    expect(delivery.count).toBe("0");
  for (const delivery of observed.filter((value) =>
    new URL(value.url).pathname.startsWith("/api/"),
  ))
    expect(delivery.count).toBe("1");
});

test("late 403 of resource A evicts A and never hides current B", async ({
  page,
}) => {
  await boot(page);
  const hold = controlled();
  await page.route("**/api/read/a?*", hold.handler);
  await page.evaluate(() => {
    window.proofPending = window.proofHarness
      .load("/proof/a?page=2")
      .catch(() => "denied");
  });
  const old = await hold.arrived;
  await page.getByRole("link", { name: "B", exact: true }).click();
  await expect(page.getByTestId("dataset")).toContainText("alice:b::1");
  await old.fulfill({ status: 403, body: "denied" });
  expect(await page.evaluate(() => window.proofPending)).toBe("denied");
  await flush(page);
  await expect(page.getByTestId("dataset")).toContainText("alice:b::1");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.proofHarness
        .diagnostics()
        .snapshots.some(
          (value) => value.key[2] === "a" && value.data !== undefined,
        ),
    ),
  ).toBe(false);
});

test("late success of A remains keyed to A, while current denial removes private B", async ({
  page,
}) => {
  await boot(page);
  const hold = controlled();
  await page.route("**/api/read/a?*", hold.handler);
  await page.evaluate(() => {
    window.proofPending = window.proofHarness.load("/proof/a?page=2");
  });
  const old = await hold.arrived;
  await page.getByRole("link", { name: "B", exact: true }).click();
  await expect(page.getByTestId("dataset")).toContainText("alice:b::1");
  await old.fulfill({
    json: {
      user: "alice",
      resource: "a",
      term: "",
      page: 2,
      observedAt: 1,
      text: "LATE A",
    },
  });
  await page.evaluate(() => window.proofPending);
  await flush(page);
  await expect(page.getByTestId("dataset")).toContainText("alice:b::1");
  await expect(page.getByTestId("dataset")).not.toContainText("LATE A");
  await page.route("**/api/read/b", (route) =>
    route.fulfill({ status: 403, body: "denied" }),
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("alert")).toHaveText("Access unavailable");
  await expect(page.getByTestId("dataset")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.proofHarness
        .diagnostics()
        .snapshots.some(
          (value) => value.key[2] === "b" && value.data !== undefined,
        ),
    ),
  ).toBe(false);
});

test("transient failure is visible, preserves snapshot and performs no retry", async ({
  page,
}) => {
  const network = reads(page);
  await boot(page);
  await page.route("**/api/read/a", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("status")).toHaveText("Refresh failed");
  await expect(page.getByTestId("dataset")).toContainText("alice:a::1");
  await flush(page);
  expect(network).toHaveLength(1);
});

test("denied hydrated SSR snapshot cannot be restored by observer remount", async ({
  page,
}) => {
  await boot(page);
  await page.route("**/api/read/a", (route) =>
    route.fulfill({ status: 403, body: "denied" }),
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("alert")).toHaveText("Access unavailable");
  expect(
    await page.evaluate(() =>
      window.proofHarness
        .diagnostics()
        .snapshots.some((value) => value.data !== undefined),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Remount observer" }).click();
  await expect(page.getByTestId("ready")).toHaveText("Hydrated");
  await expect(page.getByTestId("dataset")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.proofHarness
        .diagnostics()
        .snapshots.some((value) => value.data !== undefined),
    ),
  ).toBe(false);
});

test("identity generation cancels in-flight A and keeps only new identity B", async ({
  page,
  context,
}) => {
  await boot(page);
  const hold = controlled();
  await page.route("**/api/read/a", hold.handler);
  await page.evaluate(() => {
    window.proofPending = window.proofHarness
      .load("/proof/a")
      .catch(() => "cancelled");
  });
  const old = await hold.arrived;
  await context.setExtraHTTPHeaders({ "x-proof-user": "bob" });
  await page.evaluate(() => window.proofHarness.switchIdentity());
  await page.evaluate(() => window.proofHarness.load("/proof/b"));
  expect(await page.evaluate(() => window.proofPending)).toBe("cancelled");
  await old.fulfill({ status: 403, body: "late old identity" });
  await flush(page);
  const snapshots = await page.evaluate(
    () => window.proofHarness.diagnostics().snapshots,
  );
  expect(
    snapshots.some(
      (value) => value.key[1] === "alice" && value.data !== undefined,
    ),
  ).toBe(false);
  expect(snapshots.find((value) => value.key[1] === "bob")?.data).toMatchObject(
    { user: "bob", resource: "b" },
  );
  expect(
    await page.evaluate(() => window.proofHarness.diagnostics().active),
  ).toBe(0);
});

test("pt-BR hydration uses compiled plural catalog and request timezone", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    "x-proof-user": "bob",
    "x-proof-locale": "pt-BR",
    "x-proof-zone": "America/Sao_Paulo",
  });
  await page.goto("/proof/a");
  await expect(page.getByTestId("ready")).toHaveText("Hydrated");
  await expect(page.getByRole("heading")).toHaveText("Prova de leitura");
  await expect(page.getByTestId("dataset")).toContainText("Itens: 1 item");
  await expect(page.locator("time")).toContainText("07:00");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("dataset")).toContainText("Itens: 2 itens");
});

test("A refresh to B then A cancels old same-key read and requires a fresh authorization", async ({
  page,
}) => {
  await boot(page);
  const oldSnapshot = await page.evaluate(() => window.proofHarness.data());
  const hold = controlled();
  let count = 0;
  await page.route("**/api/read/a", (route) => {
    count += 1;
    if (count === 1) hold.handler(route);
    else void route.continue();
  });
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (request) => new URL(request.url()).pathname === "/api/read/a",
  });
  await page.getByRole("button", { name: "Refresh" }).click();
  const old = await hold.arrived;
  await page.getByRole("link", { name: "B", exact: true }).click();
  await expect(page.getByTestId("dataset")).toContainText("alice:b::1");
  await page.getByRole("link", { name: "A", exact: true }).click();
  await expect(page.getByTestId("dataset")).toContainText("alice:a::1");
  expect(count).toBe(2);
  expect((await aborted).failure()).not.toBeNull();
  const fresh = await page.evaluate(() => window.proofHarness.data());
  expect(fresh).not.toEqual(oldSnapshot);
  await old.fulfill({ status: 403, body: "obsolete" });
  await flush(page);
  expect(await page.evaluate(() => window.proofHarness.data())).toEqual(fresh);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("late denial of old A page cannot evict a newer confirmed A snapshot", async ({
  page,
}) => {
  await boot(page);
  const hold = controlled();
  await page.route("**/api/read/a?page=2", hold.handler);
  await page.evaluate(() => {
    window.proofPending = window.proofHarness
      .load("/proof/a?page=2")
      .catch(() => "old denied");
  });
  const old = await hold.arrived;
  await page.getByRole("link", { name: "B", exact: true }).click();
  await expect(page.getByTestId("dataset")).toContainText("alice:b::1");
  await page.getByRole("link", { name: "A", exact: true }).click();
  await expect(page.getByTestId("dataset")).toContainText("alice:a::1");
  const fresh = await page.evaluate(() => window.proofHarness.data());
  await old.fulfill({ status: 403, body: "old denial" });
  expect(await page.evaluate(() => window.proofPending)).toBe("old denied");
  await flush(page);
  expect(await page.evaluate(() => window.proofHarness.data())).toEqual(fresh);
  await expect(page.getByTestId("dataset")).toContainText("alice:a::1");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("filter and refresh preserve pertinent scroll; history restores it after route change", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("textbox", { name: "Search" }).fill("continuity");
  await page.evaluate(() => window.scrollTo(0, 120));
  expect(await page.evaluate(() => window.scrollY)).toBe(120);
  await page.getByRole("textbox", { name: "Search" }).press("Enter");
  await expect(page.getByTestId("dataset")).toContainText(
    "alice:a:continuity:1",
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(120);
  await page.getByRole("button", { name: "Refresh" }).focus();
  await page.getByRole("button", { name: "Refresh" }).press("Enter");
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(120);
  // Pointer clicks may scroll a control into view before Router saves position.
  // Establish keyboard activation with the same pertinent position instead.
  await page.getByRole("link", { name: "B", exact: true }).focus();
  await page.evaluate(() => window.scrollTo(0, 120));
  await page.getByRole("link", { name: "B", exact: true }).press("Enter");
  await expect(page.getByTestId("dataset")).toContainText("alice:b::1");
  await page.goBack();
  await expect(page.getByTestId("dataset")).toContainText(
    "alice:a:continuity:1",
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(120);
});

for (const status of [401, 403]) {
  test(`current ${status} hides private SSR snapshot and empties its scope`, async ({
    page,
  }) => {
    const network = reads(page);
    await boot(page);
    await page.route("**/api/read/a", (route) =>
      route.fulfill({ status, body: "denied" }),
    );
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("alert")).toHaveText("Access unavailable");
    await expect(page.getByTestId("dataset")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        window.proofHarness
          .diagnostics()
          .snapshots.some((value) => value.data !== undefined),
      ),
    ).toBe(false);
    await flush(page);
    expect(network).toHaveLength(1);
  });
}

test("invalid API DTO cannot enter Query cache or fall back to private snapshot", async ({
  page,
}) => {
  const network = reads(page);
  await boot(page);
  await page.route("**/api/read/a", (route) =>
    route.fulfill({
      json: {
        user: "alice",
        resource: "a",
        term: "",
        page: 99,
        observedAt: 0,
        text: "INVALID",
      },
    }),
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("alert")).toHaveText("Access unavailable");
  await expect(page.getByTestId("dataset")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.proofHarness
        .diagnostics()
        .snapshots.some((value) => value.data !== undefined),
    ),
  ).toBe(false);
  await flush(page);
  expect(network).toHaveLength(1);
});

test("current scope denial aborts older pending page and cannot be repopulated by its late success", async ({
  page,
}) => {
  await boot(page);
  const hold = controlled();
  await page.route("**/api/read/a?page=2", hold.handler);
  await page.evaluate(() => {
    window.proofPending = window.proofHarness
      .load("/proof/a?page=2")
      .catch(() => "cancelled");
  });
  const old = await hold.arrived;
  await page.route("**/api/read/a", (route) =>
    route.fulfill({ status: 403, body: "current scope denied" }),
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("alert")).toHaveText("Access unavailable");
  expect(await page.evaluate(() => window.proofPending)).toBe("cancelled");
  await old.fulfill({
    json: {
      user: "alice",
      resource: "a",
      term: "",
      page: 2,
      observedAt: 1,
      text: "PRIVATE OLD A",
    },
  });
  await flush(page);
  await expect(page.getByTestId("dataset")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.proofHarness
        .diagnostics()
        .snapshots.some((value) => value.data !== undefined),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() => window.proofHarness.diagnostics().active),
  ).toBe(0);
});

test("filter releases previous refresh owner; old completion cannot release new refresh", async ({
  page,
}) => {
  await boot(page);
  const first = controlled();
  await page.route("**/api/read/a", first.handler);
  await page.getByRole("button", { name: "Refresh" }).click();
  const old = await first.arrived;
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByRole("textbox", { name: "Search" }).fill("new");
  await page.getByRole("textbox", { name: "Search" }).press("Enter");
  await expect(page.getByTestId("dataset")).toContainText("alice:a:new:1");
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  const second = controlled();
  await page.route("**/api/read/a?q=new", second.handler);
  await page.getByRole("button", { name: "Refresh" }).click();
  const fresh = await second.arrived;
  await old.fulfill({ status: 403, body: "obsolete scope denial" });
  await flush(page);
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(page.getByTestId("dataset")).toContainText("alice:a:new:1");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await fresh.fulfill({
    json: {
      user: "alice",
      resource: "a",
      term: "new",
      page: 1,
      observedAt: 2,
      text: "FRESH",
    },
  });
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  await expect(page.getByTestId("dataset")).toContainText("FRESH");
});

test("current 401 clears all identity snapshots including previously visited B", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("link", { name: "B", exact: true }).click();
  await expect(page.getByTestId("dataset")).toContainText("alice:b::1");
  await page.getByRole("link", { name: "A", exact: true }).click();
  await expect(page.getByTestId("dataset")).toContainText("alice:a::1");
  expect(
    await page.evaluate(
      () =>
        window.proofHarness
          .diagnostics()
          .snapshots.filter((value) => value.data !== undefined).length,
    ),
  ).toBe(2);
  await page.route("**/api/read/a", (route) =>
    route.fulfill({ status: 401, body: "session invalid" }),
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("alert")).toHaveText("Access unavailable");
  expect(
    await page.evaluate(() =>
      window.proofHarness
        .diagnostics()
        .snapshots.some((value) => value.data !== undefined),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() => window.proofHarness.diagnostics().active),
  ).toBe(0);
});

test("extra API fields never enter the allowlisted dataset cache", async ({
  page,
}) => {
  await boot(page);
  await page.route("**/api/read/a", (route) =>
    route.fulfill({
      json: {
        user: "alice",
        resource: "a",
        term: "",
        page: 1,
        observedAt: 123,
        text: "VALID",
        serverOnly: "SYNTHETIC_NOT_A_SECRET",
      },
    }),
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("dataset")).toContainText("VALID");
  const data = await page.evaluate(() => window.proofHarness.data());
  expect(data).toEqual({
    user: "alice",
    resource: "a",
    term: "",
    page: 1,
    observedAt: 123,
    text: "VALID",
  });
  expect(
    JSON.stringify(
      await page.evaluate(() => window.proofHarness.diagnostics().snapshots),
    ),
  ).not.toContain("SYNTHETIC_NOT_A_SECRET");
});

for (const payload of ["malformed JSON", "wrong user"]) {
  test(`${payload} closes private snapshot without an automatic retry`, async ({
    page,
  }) => {
    const network = reads(page);
    await boot(page);
    await page.route("**/api/read/a", (route) =>
      payload === "malformed JSON"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: '{"user":',
          })
        : route.fulfill({
            json: {
              user: "bob",
              resource: "a",
              term: "",
              page: 1,
              observedAt: 1,
              text: "OTHER USER",
            },
          }),
    );
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("alert")).toHaveText("Access unavailable");
    await expect(page.getByTestId("dataset")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        window.proofHarness
          .diagnostics()
          .snapshots.some((value) => value.data !== undefined),
      ),
    ).toBe(false);
    await flush(page);
    expect(network).toHaveLength(1);
  });
}
