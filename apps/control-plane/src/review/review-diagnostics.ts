import type { EvidenceRejection } from "@holon/application";

export type EmitReviewEvent = (
  event: string,
  fields?: Readonly<Record<string, boolean | number | string | undefined>>,
  suffix?: number | string,
) => void;

export function emitDiagnostic(
  emit: EmitReviewEvent | undefined,
  event: string,
  fields: Readonly<Record<string, boolean | number | string | undefined>>,
  suffix?: string,
): void {
  try {
    emit?.(event, fields, suffix);
  } catch {
    // Observability cannot change a review result or its retry decision.
  }
}

/** Logging is advisory and must not change evidence acceptance or retries. */
export function emitEvidenceRejections(
  emit: EmitReviewEvent | undefined,
  shardIndex: number,
  candidateKind: "finding" | "resolution",
  rejections: readonly EvidenceRejection[],
  stage: "causal_admission" | "publication" = "publication",
): void {
  for (const rejection of rejections) {
    try {
      emit?.(
        "model.evidence_rejected",
        {
          severity: "warning",
          shardIndex,
          candidateKind,
          stage,
          ...rejection,
        },
        `${shardIndex}:${candidateKind}:${rejection.findingIndex}`,
      );
    } catch {
      // Keep the canonical verification result even if the log sink fails.
    }
  }
}
