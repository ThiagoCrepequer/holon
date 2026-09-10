import type { FindingSeverity } from "./finding.js";
import { reviewText, type ReviewLanguage } from "./review-language.js";

export type ReviewVerdict = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface ReviewVerdictDetails {
  readonly advisoryFindingsCount: number;
  readonly blockingFindingsCount: number;
  readonly reasons: readonly string[];
  readonly riskScore: number;
  readonly verdict: ReviewVerdict;
}

export interface ReviewVerdictPolicyOptions {
  readonly allowApprove?: boolean | undefined;
  readonly blockingSeverities?: readonly FindingSeverity[] | undefined;
  readonly mediumHighConfidenceThreshold?: number | undefined;
  readonly mediumSeverityThreshold?: number | undefined;
  readonly minimumConfidenceThreshold?: number | undefined;
  readonly riskScoreThreshold?: number | undefined;
}

export interface DetermineReviewVerdictInput {
  readonly language?: ReviewLanguage | undefined;
  readonly findings: readonly {
    readonly confidence: number;
    readonly severity: FindingSeverity;
  }[];
  readonly isDegraded?: boolean | undefined;
  readonly options?: ReviewVerdictPolicyOptions | undefined;
  readonly scopeStatus:
    | "complete"
    | "partial_by_policy"
    | "partial_by_failure"
    | "unsupported";
  readonly shardsAnalyzed?: number | undefined;
  readonly totalShards?: number | undefined;
}

const SEVERITY_WEIGHTS: Readonly<Record<FindingSeverity, number>> = {
  critical: 4.0,
  high: 3.0,
  medium: 1.5,
  low: 0.25,
};

const DEFAULT_OPTIONS = {
  allowApprove: true,
  mediumHighConfidenceThreshold: 0.85,
  mediumSeverityThreshold: 2,
  minimumConfidenceThreshold: 0.75,
  riskScoreThreshold: 2.0,
} as const;

export function determineReviewVerdict(
  input: DetermineReviewVerdictInput,
): ReviewVerdictDetails {
  const text = (en: string, pt: string, es: string) =>
    reviewText(input.language ?? "en", en, pt, es);
  const options = {
    allowApprove: input.options?.allowApprove ?? DEFAULT_OPTIONS.allowApprove,
    mediumHighConfidenceThreshold:
      input.options?.mediumHighConfidenceThreshold ??
      DEFAULT_OPTIONS.mediumHighConfidenceThreshold,
    mediumSeverityThreshold:
      input.options?.mediumSeverityThreshold ??
      DEFAULT_OPTIONS.mediumSeverityThreshold,
    minimumConfidenceThreshold:
      input.options?.minimumConfidenceThreshold ??
      DEFAULT_OPTIONS.minimumConfidenceThreshold,
    riskScoreThreshold:
      input.options?.riskScoreThreshold ?? DEFAULT_OPTIONS.riskScoreThreshold,
  };

  const reasons: string[] = [];

  // 1. Fail-Safe / Incomplete Scope Checks (COMMENT only)
  if (input.scopeStatus === "partial_by_policy") {
    reasons.push(
      text(
        "Review scope is partial due to exclusion policies or file budgets; cannot approve or request changes without complete context.",
        "O escopo da revisão é parcial devido às exclusões ou aos limites de arquivos; não é possível aprovar ou solicitar alterações sem contexto completo.",
        "El alcance de la revisión es parcial por exclusiones o límites de archivos; no se puede aprobar ni solicitar cambios sin contexto completo.",
      ),
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore: 0,
      verdict: "COMMENT",
    };
  }

  if (input.scopeStatus === "partial_by_failure") {
    reasons.push(
      text(
        "Review was interrupted by shard execution failure; cannot approve or request changes without full analysis.",
        "A revisão foi interrompida por falha na execução de uma parte; não é possível aprovar ou solicitar alterações sem análise completa.",
        "La revisión se interrumpió por un fallo de ejecución; no se puede aprobar ni solicitar cambios sin un análisis completo.",
      ),
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore: 0,
      verdict: "COMMENT",
    };
  }

  if (input.scopeStatus === "unsupported") {
    reasons.push(
      text(
        "Pull request contains no supported code changes.",
        "O pull request não contém alterações de código suportadas.",
        "El pull request no contiene cambios de código compatibles.",
      ),
    );
    return {
      advisoryFindingsCount: 0,
      blockingFindingsCount: 0,
      reasons,
      riskScore: 0,
      verdict: "COMMENT",
    };
  }

  if (
    input.shardsAnalyzed !== undefined &&
    input.totalShards !== undefined &&
    input.totalShards > 0 &&
    input.shardsAnalyzed < input.totalShards
  ) {
    reasons.push(
      text(
        `Incomplete shard execution (${input.shardsAnalyzed}/${input.totalShards} shards analyzed); review is incomplete.`,
        `Execução incompleta (${input.shardsAnalyzed}/${input.totalShards} partes analisadas); a revisão está incompleta.`,
        `Ejecución incompleta (${input.shardsAnalyzed}/${input.totalShards} partes analizadas); la revisión está incompleta.`,
      ),
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore: 0,
      verdict: "COMMENT",
    };
  }

  // Filter confident findings
  const confidentFindings = input.findings.filter(
    (f) => f.confidence >= options.minimumConfidenceThreshold,
  );

  // If findings were emitted but all were low-confidence (< 0.75)
  if (input.findings.length > 0 && confidentFindings.length === 0) {
    reasons.push(
      text(
        `Detected ${input.findings.length} advisory observation(s), but all had confidence below the reliable threshold (${options.minimumConfidenceThreshold}).`,
        `${input.findings.length} observação(ões) detectada(s), todas com confiança abaixo do limite confiável (${options.minimumConfidenceThreshold}).`,
        `${input.findings.length} observación(es) detectada(s), todas con confianza inferior al umbral fiable (${options.minimumConfidenceThreshold}).`,
      ),
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore: 0,
      verdict: "COMMENT",
    };
  }

  // Calculate risk score
  const riskScore = confidentFindings.reduce(
    (acc, finding) => acc + (SEVERITY_WEIGHTS[finding.severity] ?? 0),
    0,
  );

  const criticalCount = confidentFindings.filter(
    (f) => f.severity === "critical",
  ).length;
  const highCount = confidentFindings.filter(
    (f) => f.severity === "high",
  ).length;
  const mediumConfidentCount = confidentFindings.filter(
    (f) => f.severity === "medium",
  ).length;
  const mediumHighConfidenceCount = confidentFindings.filter(
    (f) =>
      f.severity === "medium" &&
      f.confidence >= options.mediumHighConfidenceThreshold,
  ).length;
  const lowCount = input.findings.filter((f) => f.severity === "low").length;

  const hasBlockingCriticalOrHigh = criticalCount > 0 || highCount > 0;
  const hasMediumAccumulation =
    mediumConfidentCount >= options.mediumSeverityThreshold;
  const hasHighConfidenceMedium = mediumHighConfidenceCount > 0;
  const exceedsRiskScore = riskScore >= options.riskScoreThreshold;

  const isBlocking =
    hasBlockingCriticalOrHigh ||
    hasMediumAccumulation ||
    hasHighConfidenceMedium ||
    exceedsRiskScore;

  if (isBlocking) {
    const blockingCount =
      criticalCount +
      highCount +
      (hasMediumAccumulation || hasHighConfidenceMedium
        ? mediumConfidentCount
        : 0);

    if (criticalCount > 0) {
      reasons.push(
        text(
          `${criticalCount} critical defect(s) identified requiring resolution.`,
          `${criticalCount} defeito(s) crítico(s) identificado(s) que precisam de correção.`,
          `${criticalCount} defecto(s) crítico(s) identificado(s) que requieren corrección.`,
        ),
      );
    }
    if (highCount > 0) {
      reasons.push(
        text(
          `${highCount} high-severity defect(s) identified requiring resolution.`,
          `${highCount} defeito(s) de alta severidade identificado(s) que precisam de correção.`,
          `${highCount} defecto(s) de alta gravedad identificado(s) que requieren corrección.`,
        ),
      );
    }
    if (mediumHighConfidenceCount > 0 && !hasMediumAccumulation) {
      reasons.push(
        text(
          `${mediumHighConfidenceCount} high-confidence moderate defect(s) identified requiring resolution.`,
          `${mediumHighConfidenceCount} defeito(s) moderado(s) com alta confiança que precisam de correção.`,
          `${mediumHighConfidenceCount} defecto(s) moderado(s) con alta confianza que requieren corrección.`,
        ),
      );
    } else if (hasMediumAccumulation) {
      reasons.push(
        text(
          `${mediumConfidentCount} moderate defects accumulated (threshold: ${options.mediumSeverityThreshold}), indicating significant code risk.`,
          `${mediumConfidentCount} defeitos moderados acumulados (limite: ${options.mediumSeverityThreshold}), indicando risco significativo no código.`,
          `${mediumConfidentCount} defectos moderados acumulados (umbral: ${options.mediumSeverityThreshold}), indicando un riesgo significativo en el código.`,
        ),
      );
    } else if (exceedsRiskScore && !hasBlockingCriticalOrHigh) {
      reasons.push(
        text(
          `Risk score ${riskScore.toFixed(1)} reached or exceeded threshold ${options.riskScoreThreshold.toFixed(1)}.`,
          `A pontuação de risco ${riskScore.toFixed(1)} atingiu ou excedeu o limite ${options.riskScoreThreshold.toFixed(1)}.`,
          `La puntuación de riesgo ${riskScore.toFixed(1)} alcanzó o superó el umbral ${options.riskScoreThreshold.toFixed(1)}.`,
        ),
      );
    }

    return {
      advisoryFindingsCount: input.findings.length - blockingCount,
      blockingFindingsCount: blockingCount,
      reasons,
      riskScore,
      verdict: "REQUEST_CHANGES",
    };
  }

  // No blocking defects found: evaluate APPROVE vs COMMENT
  if (input.isDegraded === true) {
    reasons.push(
      text(
        "ℹ️ The model analysis completed without structured output. Review the investigative notes below.",
        "ℹ️ A análise do modelo foi concluída de forma não-estruturada. Revise as notas investigativas abaixo.",
        "ℹ️ El análisis del modelo terminó sin una salida estructurada. Revise las notas de investigación siguientes.",
      ),
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore,
      verdict: "COMMENT",
    };
  }

  if (!options.allowApprove) {
    reasons.push(
      text(
        "No blocking defects found, but automated approvals are disabled by policy.",
        "Nenhum defeito bloqueante encontrado, mas as aprovações automáticas estão desabilitadas pela política.",
        "No se encontraron defectos bloqueantes, pero las aprobaciones automáticas están deshabilitadas por la política.",
      ),
    );
    return {
      advisoryFindingsCount: input.findings.length,
      blockingFindingsCount: 0,
      reasons,
      riskScore,
      verdict: "COMMENT",
    };
  }

  if (lowCount > 0) {
    reasons.push(
      text(
        `No blocking defects found. ${lowCount} low-severity advisory observation(s) provided for consideration.`,
        `Nenhum defeito bloqueante encontrado. ${lowCount} observação(ões) de baixa severidade para consideração.`,
        `No se encontraron defectos bloqueantes. ${lowCount} observación(es) de baja gravedad para su consideración.`,
      ),
    );
  } else {
    reasons.push(
      text(
        "All reviewed files clean; no defects or regressions identified.",
        "Nenhum defeito ou regressão identificado nos arquivos revisados.",
        "No se identificaron defectos ni regresiones en los archivos revisados.",
      ),
    );
  }

  return {
    advisoryFindingsCount: lowCount,
    blockingFindingsCount: 0,
    reasons,
    riskScore,
    verdict: "APPROVE",
  };
}

export function formatVerdictBadge(
  verdict: ReviewVerdict,
  language: ReviewLanguage = "en",
): string {
  switch (verdict) {
    case "APPROVE":
      return reviewText(
        language,
        "### Verdict: Approved",
        "### Veredito: Aprovado",
        "### Veredicto: Aprobado",
      );
    case "REQUEST_CHANGES":
      return reviewText(
        language,
        "### Verdict: Changes requested",
        "### Veredito: Alterações solicitadas",
        "### Veredicto: Cambios solicitados",
      );
    case "COMMENT":
    default:
      return reviewText(
        language,
        "### Verdict: Informational Comment",
        "### Veredito: Comentário informativo",
        "### Veredicto: Comentario informativo",
      );
  }
}
