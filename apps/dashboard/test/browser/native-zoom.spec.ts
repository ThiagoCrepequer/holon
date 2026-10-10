import { fileURLToPath } from "node:url";

import { AxeBuilder } from "@axe-core/playwright";
import { chromium, expect, test } from "@playwright/test";

import {
  accountTrigger,
  openCreateWorkspace,
  openPreferences,
  seedReviews,
  signIn,
} from "../support/browser-journey.js";

test("200% native browser zoom preserves reflow, keyboard menus and modal focus", async ({
  browserName,
}) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(90_000);
  const extension = fileURLToPath(
    new URL("../support/zoom-extension", import.meta.url),
  );
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    baseURL: "https://127.0.0.1:8795",
    viewport: null,
    isMobile: false,
    args: [
      "--window-size=1440,1000",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const page = context.pages()[0] ?? (await context.newPage());
    for (const [index, locale] of ["en", "pt-BR"].entries()) {
      const subject = 420001 + index;
      if (index) await context.clearCookies();
      const workspace = await signIn(page, subject, locale);
      await seedReviews(page, subject, 2);
      const width = await page.evaluate(() => window.innerWidth);
      expect(
        await worker.evaluate(`(async () => {
        const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
        await chrome.tabs.setZoom(tab.id, 2);
        return chrome.tabs.getZoom(tab.id);
      })()`),
      ).toBe(2);
      await expect
        .poll(() => page.evaluate(() => window.innerWidth))
        .toBe(Math.round(width / 2));
      for (const theme of ["light", "dark"]) {
        await page.goto(
          `/account?workspace=${workspace}&lang=${locale}&theme=${theme}`,
        );
        await openCreateWorkspace(page);
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() =>
            document
              .querySelector("dialog[open]")
              ?.contains(document.activeElement),
          ),
        ).toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await expect(
          page.getByRole("button", { name: "Workspace", exact: true }),
        ).toBeFocused();
        await openPreferences(page);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await expect(accountTrigger(page)).toBeFocused();
        for (const path of ["/account", "/reviews", "/reviews/detail"]) {
          await page.goto(
            `${path}?workspace=${workspace}&installation=${subject + 100000}&repository=${subject + 200000}&lang=${locale}&theme=${theme}${path === "/reviews/detail" ? "&pullRequest=1" : ""}`,
          );
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          expect(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
            ),
          ).toBe(true);
          expect(
            await page.evaluate(
              () => getComputedStyle(document.documentElement).zoom,
            ),
          ).toBe("1");
          expect(
            (
              await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
                .analyze()
            ).violations,
          ).toEqual([]);
          await page.screenshot({
            path: `proof-results/m7-native-zoom-${locale}-${theme}-${path.startsWith("/reviews/") ? "detail" : path.slice(1)}.png`,
            caret: "initial",
            fullPage: true,
          });
        }
      }
      await worker.evaluate(`(async () => {
        const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
        await chrome.tabs.setZoom(tab.id, 1);
      })()`);
    }
  } finally {
    await context.close();
  }
});
