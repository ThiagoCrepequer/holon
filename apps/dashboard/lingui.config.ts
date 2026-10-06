import type { LinguiConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";
export default {
  locales: ["en", "pt-BR"],
  sourceLocale: "en",
  fallbackLocales: false,
  catalogs: [{ path: "app/locales/{locale}/messages", include: ["app"] }],
  format: formatter({ lineNumbers: false }),
} satisfies LinguiConfig;
