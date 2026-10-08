import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
for (const locale of ["en", "pt-BR"] as const) {
  const pt = locale === "pt-BR";
  test(`${locale}: SSR, hydration, strict CSP, theme and native modal keyboard/focus`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.addInitScript(() => {
      globalThis.addEventListener("securitypolicyviolation", (event) => {
        document.documentElement.dataset.cspViolation = "true";
        document.documentElement.dataset.cspReport = JSON.stringify({
          directive: event.effectiveDirective,
          blockedURI: event.blockedURI,
          sourceFile: event.sourceFile,
          lineNumber: event.lineNumber,
        });
      });
    });
    const response = await page.goto(`/?lang=${locale}&keep=preserved`);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    expect(response?.headers()["content-security-policy"]).not.toMatch(
      /unsafe-inline|unsafe-eval/,
    );
    const initialHtml = await response!.text();
    expect(initialHtml).not.toContain(
      pt ? "Your reviews, in context." : "Suas reviews, em contexto.",
    );
    expect(initialHtml).toContain(
      pt ? "Suas reviews, em contexto." : "Your reviews, in context.",
    );
    const asset = page.locator('link[rel="stylesheet"]').first();
    const assetResponse = await page.request.get(
      (await asset.getAttribute("href")) ?? "",
    );
    expect(assetResponse.headers()["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      pt ? "Suas reviews, em contexto." : "Your reviews, in context.",
    );
    const trigger = page.getByRole("button", {
      name: pt ? "Preferências" : "Preferences",
      exact: true,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("opacity", "1");
    await expect
      .poll(() =>
        dialog.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          return Math.max(
            Math.abs(bounds.x + bounds.width / 2 - innerWidth / 2),
            Math.abs(bounds.y + bounds.height / 2 - innerHeight / 2),
          );
        }),
      )
      .toBeLessThan(1);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    const language = page.getByRole("combobox", {
      name: pt ? "Idioma" : "Language",
    });
    await language.focus();
    await language.selectOption(pt ? "en" : "pt-BR");
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      pt ? "en" : "pt-BR",
    );
    await expect(
      page.getByRole("combobox", { name: pt ? "Language" : "Idioma" }),
    ).toBeFocused();
    expect(new URL(page.url()).searchParams.get("keep")).toBe("preserved");
    expect(new URL(page.url()).pathname).toBe("/");
    const theme = page.getByRole("combobox", { name: pt ? "Theme" : "Tema" });
    await theme.selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute(
      "data-holon-theme",
      "dark",
    );
    expect(
      await page
        .locator("body")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe("rgb(17, 28, 45)");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await dialog.evaluate(
        (node) => getComputedStyle(node).transitionDuration,
      ),
    ).toBe("0s");
    expect(
      await dialog.evaluate(
        (node) => getComputedStyle(node, "::backdrop").transitionDuration,
      ),
    ).toBe("0s");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await theme.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("combobox", { name: pt ? "Language" : "Idioma" }),
    ).toBeFocused();
    const backgroundTrigger = page.getByRole("button", {
      name: pt ? "Preferences" : "Preferências",
      exact: true,
      includeHidden: true,
    });
    await backgroundTrigger.focus();
    await expect(backgroundTrigger).not.toBeFocused();
    expect(
      await dialog.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(true);
    expect(
      await page.locator("html").getAttribute("data-csp-violation"),
      (await page.locator("html").getAttribute("data-csp-report")) ??
        "No CSP violation",
    ).toBeNull();
    expect(errors).toEqual([]);
    expect(
      requests.some((url) => /api\/(?!health)|auth|github\.com/.test(url)),
    ).toBe(false);
    await page.setViewportSize({ width: 375, height: 667 });
    await expect
      .poll(() =>
        dialog.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          return Math.max(
            Math.abs(bounds.x + bounds.width / 2 - innerWidth / 2),
            Math.abs(bounds.y + bounds.height / 2 - innerHeight / 2),
          );
        }),
      )
      .toBeLessThan(1);
    expect(
      await dialog.evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe("rgb(38, 55, 80)");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
  test(`${locale}: hostile query data cannot become markup or create an effect`, async ({
    page,
    request,
  }) => {
    await page.goto(
      `/?lang=${locale}&keep=${encodeURIComponent('</script><img src="https://evil.test" onerror="globalThis.xss=true">')}`,
    );
    expect(await page.evaluate(() => Object.hasOwn(globalThis, "xss"))).toBe(
      false,
    );
    expect(await page.locator('img[src*="evil.test"]').count()).toBe(0);
    const firstNonce = (await page.request.get("/")).headers()[
      "content-security-policy"
    ];
    expect(
      (await page.request.get("/")).headers()["content-security-policy"],
    ).not.toBe(firstNonce);
    const missing = await page.goto(`/unknown-sensitive-path?lang=${locale}`);
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole("alert")).toHaveText(
      pt ? "Página indisponível" : "Page unavailable",
    );
    expect(await page.content()).not.toContain("No route matches");
    for (const path of [
      "/api/invitations/accept",
      "/api/sessions/revoke",
      "/api/workspaces/leave",
    ]) {
      expect((await request.get(path)).status()).toBe(404);
      expect((await request.post(path, { data: {} })).status()).toBe(405);
    }
  });
}
