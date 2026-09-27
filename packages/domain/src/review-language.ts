/** Supported presentation languages; never changes evidence or protocol identifiers. */
export type ReviewLanguage = "en" | "pt-BR" | "es";
export function reviewText(
  language: ReviewLanguage,
  en: string,
  ptBR: string,
  es: string,
): string {
  return language === "pt-BR" ? ptBR : language === "es" ? es : en;
}
