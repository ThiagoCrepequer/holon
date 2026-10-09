import {
  causalVerificationSchema,
  limitReviewText,
  modelReviewOutputSchema,
  reviewTextLimits,
  reviewEvidenceReceiptSchema,
  type ModelReviewOutput,
  type ReviewLanguage,
  type ReviewEvidenceReceipt,
} from "@holon/contracts";
import { minimumFindingConfidence, reviewText } from "@holon/domain";

function incompleteWarning(language: ReviewLanguage): string {
  return reviewText(
    language,
    "Causal verification was incomplete. Unverified candidates were withheld; this review cannot establish that the changes are safe.",
    "A verificação causal ficou incompleta. Candidatos não verificados foram retidos; esta revisão não comprova que as mudanças são seguras.",
    "La verificación causal quedó incompleta. Se retuvieron candidatos no verificados; esta revisión no demuestra que los cambios sean seguros.",
  );
}

export function withholdUnverifiedFindings(
  draft: ModelReviewOutput,
  language: ReviewLanguage = "en",
): ModelReviewOutput {
  return modelReviewOutputSchema.parse({
    ...draft,
    findings: [],
    isDegraded: true,
    outputLimitations: [
      ...new Set([
        ...(draft.outputLimitations ?? []),
        "causal_verification_incomplete",
      ]),
    ],
    summary: incompleteWarning(language),
  });
}

/** Exhaustive positional matching prevents an LLM from adding or swapping issues. */
export function applyCausalVerification(
  draft: ModelReviewOutput,
  raw: unknown,
  language: ReviewLanguage = "en",
  receipts: readonly ReviewEvidenceReceipt[] = [],
): ModelReviewOutput {
  const parsed = causalVerificationSchema.safeParse(raw);
  if (!parsed.success) return withholdUnverifiedFindings(draft, language);
  const verification = parsed.data;
  if (
    verification.assessments.some((item) =>
      item.evidenceReceiptIds.some(
        (id) =>
          !receipts.some(
            (receipt) =>
              receipt.id === id &&
              !receipt.truncated &&
              reviewEvidenceReceiptSchema.safeParse(receipt).success,
          ),
      ),
    )
  )
    return withholdUnverifiedFindings(draft, language);
  const indices = new Set(
    verification.assessments.map((item) => item.candidateIndex),
  );
  if (
    indices.size !== draft.findings.length ||
    indices.size !== verification.assessments.length ||
    verification.assessments.some(
      (item) => item.candidateIndex >= draft.findings.length,
    )
  )
    return withholdUnverifiedFindings(draft, language);

  const incomplete = verification.assessments.some(
    (item) =>
      item.outcome === "inconclusive" ||
      item.confidence < minimumFindingConfidence,
  );
  const confirmedConfidence = new Map(
    verification.assessments
      .filter(
        (item) =>
          item.outcome === "confirmed" &&
          item.confidence >= minimumFindingConfidence,
      )
      .map((item) => [item.candidateIndex, item.confidence]),
  );
  const findings = draft.findings.flatMap((finding, candidateIndex) => {
    const confidence = confirmedConfidence.get(candidateIndex);
    return confidence === undefined
      ? []
      : [{ ...finding, confidence: Math.min(finding.confidence, confidence) }];
  });
  const warning = incomplete ? `\n\n${incompleteWarning(language)}` : "";
  const summarySpace = reviewTextLimits.summary - warning.length;
  const summaryTruncated = verification.summary.length > summarySpace;
  return modelReviewOutputSchema.parse({
    ...draft,
    findings,
    summary: `${limitReviewText(verification.summary, summarySpace)}${warning}`,
    ...(incomplete
      ? {
          isDegraded: true,
          outputLimitations: [
            ...new Set([
              ...(draft.outputLimitations ?? []),
              "causal_verification_incomplete",
              ...(summaryTruncated ? ["summary_truncated"] : []),
            ]),
          ],
        }
      : {}),
  });
}
