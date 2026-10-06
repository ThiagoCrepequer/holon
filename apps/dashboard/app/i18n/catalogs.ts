import type { DashboardLocale } from "@holon/contracts/dashboard";
import { setupI18n, type I18n, type Messages } from "@lingui/core";
export function translator(locale: DashboardLocale, messages: Messages) {
  return setupI18n({ locale, messages: { [locale]: messages } });
}

export function formatReviewCount(count: number, i18n: I18n): string {
  return i18n._({
    id: "reviews.count",
    message: "{count, plural, =0 {# reviews} one {# review} other {# reviews}}",
    values: { count },
  });
}
