import { setupI18n } from "@lingui/core";

import type { Identity } from "./fixture.js";
import { messages as en } from "./locales/en/messages.js";
import { messages as ptBR } from "./locales/pt-BR/messages.js";
const catalogs = { en, "pt-BR": ptBR };
export function translator(identity: Identity) {
  return setupI18n({
    locale: identity.locale,
    messages: { [identity.locale]: catalogs[identity.locale] },
  });
}
