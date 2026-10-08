import type { DashboardLocale } from "@holon/contracts/dashboard";

// Explicit bounded imports; catalog modules never enter the client bundle.
export async function loadMessages(locale: DashboardLocale) {
  if (locale === "pt-BR")
    return (await import("../locales/pt-BR/messages.js")).messages;
  return (await import("../locales/en/messages.js")).messages;
}
