import {
  dashboardLocaleSchema,
  type DashboardLocale,
} from "@holon/contracts/dashboard";

export function resolveLocale(
  preference: unknown,
  acceptLanguage: string | null,
): DashboardLocale {
  const personal = dashboardLocaleSchema.safeParse(preference);
  if (personal.success) return personal.data;
  const candidates = (acceptLanguage ?? "")
    .slice(0, 512)
    .split(",")
    .map((entry, index) => {
      const [language, quality] = entry.trim().split(";");
      const q =
        quality === undefined
          ? 1
          : /^q=(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/u.test(quality.trim())
            ? Number(quality.trim().slice(2))
            : 0;
      return { language: language?.toLowerCase(), q, index };
    })
    .filter((entry) => entry.q > 0)
    .toSorted((a, b) => b.q - a.q || a.index - b.index);
  for (const { language } of candidates) {
    if (language === "pt" || language === "pt-br") return "pt-BR";
    if (language === "en" || language?.startsWith("en-")) return "en";
  }
  return "en";
}
export function resolveTimezone(preference: unknown): string {
  if (typeof preference !== "string" || preference.length > 100) return "UTC";
  try {
    const formatter = new Intl.DateTimeFormat("en", { timeZone: preference });
    return formatter.resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
export function formatDate(
  value: Date,
  locale: DashboardLocale,
  timezone: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: resolveTimezone(timezone),
    dateStyle: "medium",
  }).format(value);
}

export function formatNumber(value: number, locale: DashboardLocale): string {
  return new Intl.NumberFormat(locale).format(value);
}
