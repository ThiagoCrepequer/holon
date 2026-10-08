import { expect, it } from "vitest";

import { translator, formatReviewCount } from "../app/i18n/catalogs.js";
import {
  resolveLocale,
  resolveTimezone,
  formatDate,
  formatNumber,
} from "../app/i18n/locale.js";
import { loadMessages } from "../app/i18n/messages.server.js";
it("locale negotiation honors preference, quality and supported fallbacks", () => {
  expect(resolveLocale("pt-BR", "en")).toBe("pt-BR");
  expect(resolveLocale("en", "pt-BR")).toBe("en");
  expect(resolveLocale(null, "fr, en;q=0.7, pt-BR;q=0.9")).toBe("pt-BR");
  expect(resolveLocale("bad", "en;q=0, pt;q=0.5")).toBe("pt-BR");
  for (const header of [
    null,
    "",
    "de",
    "*",
    "pt-PT",
    "pt;q=invalid",
    "pt;q=1.1",
    "pt;q=0",
    "pt;q=0.1234",
  ])
    expect(resolveLocale(undefined, header)).toBe("en");
  expect(resolveLocale(null, "en-GB;q=1,pt;q=1")).toBe("en");
  expect(resolveTimezone("America/Sao_Paulo")).toBe("America/Sao_Paulo");
  for (const value of [null, "bad", "x".repeat(101)])
    expect(resolveTimezone(value)).toBe("UTC");
  expect(formatDate(new Date("2026-10-06T00:30:00Z"), "en", "UTC")).toBe(
    "Oct 6, 2026",
  );
  expect(
    formatDate(new Date("2026-10-06T00:30:00Z"), "en", "America/Sao_Paulo"),
  ).toBe("Oct 5, 2026");
});
it("concurrent translators and Intl data do not share mutable request state", async () => {
  const locales = ["en", "pt-BR"] as const;
  const results = await Promise.all(
    locales.map(async (locale) => {
      const i18n = translator(locale, await loadMessages(locale));
      await Promise.resolve();
      return {
        locale: i18n.locale,
        heading: i18n._("welcome.heading"),
        date: formatDate(
          new Date("2026-10-06T00:30:00Z"),
          locale,
          locale === "en" ? "UTC" : "America/Sao_Paulo",
        ),
      };
    }),
  );
  expect(results[0]?.heading).toBe("Your reviews, in context.");
  expect(results[1]?.heading).toBe("Suas reviews, em contexto.");
  expect(results.map((x) => x.locale)).toEqual(locales);
  expect(results.map((x) => x.date)).toEqual([
    "Oct 6, 2026",
    "5 de out. de 2026",
  ]);
});

it("plurals and numbers are qualified at 0, 1 and 2 in both catalogs", async () => {
  for (const locale of ["en", "pt-BR"] as const) {
    const i18n = translator(locale, await loadMessages(locale));
    expect([0, 1, 2].map((count) => formatReviewCount(count, i18n))).toEqual(
      locale === "en"
        ? ["0 reviews", "1 review", "2 reviews"]
        : ["0 revisões", "1 revisão", "2 revisões"],
    );
  }
  expect(formatNumber(1234.5, "en")).toBe("1,234.5");
  expect(formatNumber(1234.5, "pt-BR")).toBe("1.234,5");
});
