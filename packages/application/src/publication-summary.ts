import { limitReviewText, reviewTextLimits } from "@holon/contracts";
import { reviewMessage, type ReviewLanguage } from "@holon/domain";

/** Reserve coverage/lifecycle information before allocating narrative space. */
export function fitPublicationSummary(
  prefix: string,
  narrative: string,
  suffix: string,
  language: ReviewLanguage = "en",
): string {
  prefix = limitReviewText(prefix, 2_000);
  const notice = "\n\n" + reviewMessage(language, "narrativeOmitted");
  const boundedSuffix = limitReviewText(
    suffix,
    8_000,
    "\n" + reviewMessage(language, "detailOmitted"),
  );
  const fixed = [prefix, boundedSuffix].filter(Boolean).join("\n\n");
  const budget = Math.max(
    0,
    reviewTextLimits.publicationSummary - fixed.length - 4,
  );
  const body =
    narrative.length > budget
      ? limitReviewText(narrative, budget, notice)
      : narrative;
  return [prefix, body, boundedSuffix].filter(Boolean).join("\n\n");
}
