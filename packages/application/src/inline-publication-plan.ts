import { reviewMessage } from "@holon/domain";
interface PublicationCandidate {
  readonly identityAmbiguous?: boolean | undefined;
  readonly fingerprint: string;
  readonly confidence: number;
  readonly severity: string;
  readonly status: string;
  readonly previousCommentId?: number | undefined;
}

/** Select once from the immutable analysis order, before any remote mutation. */
export function planInlinePublications(
  findings: readonly PublicationCandidate[],
  maxInlineComments: number,
): { inlineFingerprints: string[]; overflowFingerprints: string[] } {
  if (
    !Number.isInteger(maxInlineComments) ||
    maxInlineComments < 0 ||
    maxInlineComments > 40
  )
    throw new RangeError("Invalid inline publication budget");
  const eligible = findings
    .filter(
      (finding) =>
        finding.identityAmbiguous !== true &&
        finding.confidence >= 0.8 &&
        finding.severity !== "low" &&
        !(
          finding.status === "persistent" &&
          finding.previousCommentId !== undefined
        ),
    )
    .toSorted((left, right) => {
      const priority: Readonly<Record<string, number>> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      return (
        (priority[left.severity] ?? 4) - (priority[right.severity] ?? 4) ||
        right.confidence - left.confidence ||
        (left.fingerprint < right.fingerprint
          ? -1
          : left.fingerprint > right.fingerprint
            ? 1
            : 0)
      );
    })
    .map((finding) => finding.fingerprint);
  return {
    inlineFingerprints: eligible.slice(0, maxInlineComments),
    overflowFingerprints: eligible.slice(maxInlineComments),
  };
}

/** Bounded overview; the complete findings remain in the authenticated run history. */
export function formatInlineOverflow(
  findings: readonly {
    fingerprint: string;
    diagnostic: string;
    location: { path: string; line: number };
  }[],
  overflowFingerprints: readonly string[],
  language: "en" | "pt-BR" | "es",
): string {
  const overflow = new Set(overflowFingerprints);
  const selected = findings.filter((finding) =>
    overflow.has(finding.fingerprint),
  );
  if (!selected.length) return "";
  const heading = {
    en: "Findings retained in the summary because of the inline comment limit",
    "pt-BR":
      "Achados mantidos no resumo devido ao limite de comentários inline",
    es: "Hallazgos conservados en el resumen por el límite de comentarios inline",
  }[language];
  return `${heading} (${selected.length}):\n${selected
    .map(
      (finding) =>
        `- ${finding.location.path}:${finding.location.line} — ${finding.diagnostic}`,
    )
    .join("\n")}`;
}

export function formatConfiguredFindings(
  findings: readonly (PublicationCandidate & {
    diagnostic: string;
    location: { path: string; line: number };
  })[],
  output: { maxInlineComments: number; language: "en" | "pt-BR" | "es" },
): string {
  if (findings.length === 0) return "";
  const plan = planInlinePublications(findings, output.maxInlineComments);
  const pending = findings.filter(
    (finding) => finding.identityAmbiguous === true,
  );
  const parts = [
    reviewMessage(output.language, "publicationCounts", {
      total: findings.length,
      inline: plan.inlineFingerprints.length,
      remaining: findings.length - plan.inlineFingerprints.length,
    }),
  ];
  if (pending.length)
    parts.push(
      reviewMessage(output.language, "identityPending", {
        count: pending.length,
      }),
      reviewMessage(output.language, "identityPendingReason"),
      pending
        .map(
          (finding) =>
            `- ${finding.location.path}:${finding.location.line} — ${finding.diagnostic}`,
        )
        .join("\n"),
    );
  parts.push(
    formatInlineOverflow(findings, plan.overflowFingerprints, output.language),
  );
  return parts.filter(Boolean).join("\n\n");
}
