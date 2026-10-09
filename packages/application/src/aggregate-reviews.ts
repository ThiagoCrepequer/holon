import type { ReviewOutputPreferences } from "@holon/contracts";
import {
  aggregatedReviewResultSchema,
  shardReviewResultSchema,
  type AggregatedReviewResult,
  type ModelGenerationStopReason,
  type ReviewLanguage,
  type ReconciliationSummary,
  type ReviewFinding,
  type ReviewPlan,
  type ReviewScopeStatus,
  type ShardReviewResult,
  type StructuralImpactReport,
} from "@holon/contracts";
import { reviewMessage } from "@holon/domain";
import type { ReconciledFinding } from "@holon/domain";
import {
  classifyFindingPublication,
  reviewText,
  determineReviewVerdict,
  type Finding,
  type FindingSeverity,
  type ReviewVerdictPolicyOptions,
} from "@holon/domain";

import {
  verifyFindingsWithCanonicalEvidence,
  type createCanonicalEvidenceVerifier,
} from "./evidence.js";
import { formatConfiguredFindings } from "./inline-publication-plan.js";
import { fitPublicationSummary } from "./publication-summary.js";
import { formatReviewSummaryHeader } from "./review-summary-header.js";

export interface AggregateShardReviewOptions {
  readonly evidenceVerifier?: ReturnType<
    typeof createCanonicalEvidenceVerifier
  >;
  readonly budgetStopReason?: ModelGenerationStopReason | undefined;
  readonly publication?:
    | {
        findings: readonly ReconciledFinding[];
        output: ReviewOutputPreferences;
      }
    | undefined;
  readonly language?: ReviewLanguage | undefined;
  readonly additionalFindings?: readonly ReviewFinding[] | undefined;
  readonly canonicalFindings?: readonly Finding[] | undefined;
  readonly reconciliation?: ReconciliationSummary | undefined;
  readonly structuralImpact?: StructuralImpactReport | undefined;
  readonly verdictPolicy?: ReviewVerdictPolicyOptions | undefined;
}

export function formatCleanFollowUpReview(
  headSha: string,
  language: ReviewLanguage = "en",
): string {
  const heading = reviewText(
    language,
    "## ✅ Holon · Review updated\n\n**0 new findings**",
    "## ✅ Holon · Revisão atualizada\n\n**0 novos achados**",
    "## ✅ Holon · Revisión actualizada\n\n**0 hallazgos nuevos**",
  );
  const detail = reviewText(
    language,
    "No new findings confirmed. The eligible changes in this commit were reviewed.",
    "Nenhum novo achado confirmado. Os trechos elegíveis deste commit foram revisados.",
    "No se confirmaron hallazgos nuevos. Se revisaron los cambios elegibles de este commit.",
  );
  const section = reviewText(
    language,
    "### Changes reviewed",
    "### Mudanças revisadas",
    "### Cambios revisados",
  );
  return `${heading} · \`${headSha.slice(0, 7)}\`\n\n${section}\n\n${detail}`;
}

export function formatStructuralImpactSection(
  report: StructuralImpactReport,
  language: ReviewLanguage = "en",
): string {
  const text = (en: string, pt: string, es: string) =>
    reviewText(language, en, pt, es);
  const parts: string[] = [];
  if (report.contractBreaks.length > 0) {
    parts.push(
      text(
        `- ⚠️ **Contract Investigation Leads**: ${report.contractBreaks.map((cb) => `${reviewMessage(language, cb.kind)} (${cb.path}:${cb.line})`).join("; ")}`,
        `- ⚠️ **Pistas para investigar contratos**: ${report.contractBreaks.map((cb) => `${reviewMessage(language, cb.kind)} (${cb.path}:${cb.line})`).join("; ")}`,
        `- ⚠️ **Pistas para investigar contratos**: ${report.contractBreaks.map((cb) => `${reviewMessage(language, cb.kind)} (${cb.path}:${cb.line})`).join("; ")}`,
      ),
    );
  }
  if (report.changedSymbols.length > 0) {
    parts.push(
      text(
        `- 🔍 **Symbols Modified**: ${report.changedSymbols.length} (exported: ${report.changedSymbols.filter((s) => s.isExported).length})`,
        `- 🔍 **Símbolos modificados**: ${report.changedSymbols.length} (exportados: ${report.changedSymbols.filter((s) => s.isExported).length})`,
        `- 🔍 **Símbolos modificados**: ${report.changedSymbols.length} (exportados: ${report.changedSymbols.filter((s) => s.isExported).length})`,
      ),
    );
  }
  if (report.downstreamReferences.length > 0) {
    parts.push(
      text(
        `- 🌐 **Downstream Impact Radius**: ${report.totalDownstreamReferencesCount ?? report.downstreamReferences.length} reference(s) across repository outside PR`,
        `- 🌐 **Impacto nos consumidores**: ${report.totalDownstreamReferencesCount ?? report.downstreamReferences.length} referência(s) no repositório fora do PR`,
        `- 🌐 **Impacto en consumidores**: ${report.totalDownstreamReferencesCount ?? report.downstreamReferences.length} referencia(s) en el repositorio fuera del PR`,
      ),
    );
  }
  if (report.repositoryScanTruncated === true) {
    parts.push(
      text(
        "- ⚠️ **Repository Scan**: bounded downstream inventory was partial; absence of references is inconclusive",
        "- ⚠️ **Varredura do repositório**: o inventário limitado de consumidores foi parcial; a ausência de referências é inconclusiva",
        "- ⚠️ **Exploración del repositorio**: el inventario limitado de consumidores fue parcial; la ausencia de referencias no es concluyente",
      ),
    );
  }
  const omitted = Object.values(report.omittedSignals ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );
  if (omitted > 0)
    parts.push(
      text(
        `- ⚠️ **Structural Signals Omitted**: ${omitted}; the bounded report does not cover all observed leads`,
        `- ⚠️ **Sinais estruturais omitidos**: ${omitted}; o relatório limitado não cobre todas as pistas observadas`,
        `- ⚠️ **Señales estructurales omitidas**: ${omitted}; el informe limitado no cubre todas las pistas observadas`,
      ),
    );
  if (parts.length === 0) return "";
  return [
    text(
      "### 🏛️ Structural Impact Analysis",
      "### 🏛️ Análise de impacto estrutural",
      "### 🏛️ Análisis de impacto estructural",
    ),
    ...parts,
  ].join("\n");
}

export function formatReconciliationSection(
  summary: ReconciliationSummary,
  language: ReviewLanguage = "en",
): string {
  const text = (en: string, pt: string, es: string) =>
    reviewText(language, en, pt, es);
  const parts: string[] = [];
  if ((summary.unverifiedCount ?? 0) > 0) {
    parts.push(
      text(
        `- 🔎 **${summary.unverifiedCount}** previous issue(s) await verified correction; absence from this review does not confirm resolution.`,
        `- 🔎 **${summary.unverifiedCount}** problema(s) anterior(es) aguardam correção verificada; a ausência nesta revisão não confirma resolução.`,
        `- 🔎 **${summary.unverifiedCount}** problema(s) anterior(es) esperan corrección verificada; su ausencia en esta revisión no confirma resolución.`,
      ),
    );
  }
  if (summary.resolvedCount > 0) {
    parts.push(
      text(
        `- ✅ **${summary.resolvedCount}** issue(s) resolved from previous commits.`,
        `- ✅ **${summary.resolvedCount}** problema(s) de commits anteriores resolvido(s).`,
        `- ✅ **${summary.resolvedCount}** problema(s) de commits anteriores resuelto(s).`,
      ),
    );
  }
  if (summary.persistentCount > 0) {
    parts.push(
      text(
        `- ⚠️ **${summary.persistentCount}** issue(s) persistent and still unresolved.`,
        `- ⚠️ **${summary.persistentCount}** problema(s) persistente(s), ainda sem resolução.`,
        `- ⚠️ **${summary.persistentCount}** problema(s) persistente(s), todavía sin resolver.`,
      ),
    );
  }
  if (summary.newCount > 0) {
    parts.push(
      text(
        `- 🆕 **${summary.newCount}** new issue(s) detected in this commit.`,
        `- 🆕 **${summary.newCount}** novo(s) problema(s) detectado(s) neste commit.`,
        `- 🆕 **${summary.newCount}** nuevo(s) problema(s) detectado(s) en este commit.`,
      ),
    );
  }
  if (summary.reintroducedCount > 0) {
    parts.push(
      text(
        `- 🔁 **${summary.reintroducedCount}** issue(s) reintroduced.`,
        `- 🔁 **${summary.reintroducedCount}** problema(s) reintroduzido(s).`,
        `- 🔁 **${summary.reintroducedCount}** problema(s) reintroducido(s).`,
      ),
    );
  }
  if (summary.dismissedCount > 0) {
    parts.push(
      text(
        `- 🚫 **${summary.dismissedCount}** issue(s) dismissed by human feedback.`,
        `- 🚫 **${summary.dismissedCount}** problema(s) descartado(s) por feedback humano.`,
        `- 🚫 **${summary.dismissedCount}** problema(s) descartado(s) por comentarios humanos.`,
      ),
    );
  }
  if (parts.length === 0) return "";
  return [
    text(
      "### Finding Lifecycle (Re-review)",
      "### Ciclo de vida dos achados (nova revisão)",
      "### Ciclo de vida de los hallazgos (nueva revisión)",
    ),
    ...parts,
  ].join("\n");
}

const severityWeights: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function findingDeduplicationKey(finding: ReviewFinding): string {
  const normalizedDiagnostic = finding.diagnostic.trim().toLowerCase();
  return `${finding.location.path}:${finding.location.line}:${finding.location.side}:${normalizedDiagnostic}`;
}

function compareFindings(left: Finding, right: Finding): number {
  const weightDiff =
    severityWeights[right.severity] - severityWeights[left.severity];
  if (weightDiff !== 0) return weightDiff;
  const pathDiff = left.location.path.localeCompare(right.location.path);
  if (pathDiff !== 0) return pathDiff;
  return left.location.line - right.location.line;
}

export function aggregateShardReviews(
  plan: ReviewPlan,
  shardResults: readonly ShardReviewResult[],
  options: AggregateShardReviewOptions = {},
): AggregatedReviewResult {
  const text = (en: string, pt: string, es: string) =>
    reviewText(options.language ?? "en", en, pt, es);
  if (plan.scopeStatus === "unsupported") {
    const verdictDetails = determineReviewVerdict({
      language: options.language,
      findings: [],
      options: options.verdictPolicy,
      scopeStatus: "unsupported",
      shardsAnalyzed: 0,
      totalShards: 0,
    });
    return aggregatedReviewResultSchema.parse({
      findings: [],
      omissionReasons: plan.omissionReasons.map((reason) =>
        reviewMessage(options.language ?? "en", reason.code, reason),
      ),
      scopeStatus: "unsupported",
      shardsAnalyzed: 0,
      summary: fitPublicationSummary(
        formatReviewSummaryHeader({
          verdict: verdictDetails.verdict,
          activeFindingsCount: 0,
          scopeStatus: "unsupported",
          shardsAnalyzed: 0,
          totalShards: 0,
          language: options.language,
        }),
        `${text("### Coverage", "### Cobertura", "### Cobertura")}\n\n${text(
          "No eligible changes were found after excluding binary, lock, generated, vendored, minified, and recognized sensitive files.",
          "Nenhuma alteração elegível após excluir arquivos binários, de lock, gerados, de terceiros, minificados e sensíveis reconhecidos.",
          "No hay cambios elegibles tras excluir archivos binarios, de lock, generados, de terceros, minificados y sensibles reconocidos.",
        )}`,
        "",
        options.language,
      ),
      totalShards: 0,
      verdict: verdictDetails.verdict,
      verdictDetails,
    });
  }

  const omissionReasons = plan.omissionReasons.map((reason) =>
    reviewMessage(options.language ?? "en", reason.code, reason),
  );
  let scopeStatus: ReviewScopeStatus = plan.scopeStatus;
  if (options.budgetStopReason !== undefined) {
    const dimension =
      options.budgetStopReason === "calls"
        ? text("inference calls", "inferências", "inferencias")
        : options.budgetStopReason === "input_bytes"
          ? text("processed input", "entrada processada", "entrada procesada")
          : text("reserved output", "saída reservada", "salida reservada");
    omissionReasons.push(
      text(
        `Review model budget exhausted (${dimension}).`,
        `Orçamento do modelo esgotado (${dimension}).`,
        `Presupuesto del modelo agotado (${dimension}).`,
      ),
    );
    scopeStatus = "partial_by_failure";
  }
  let shardsAnalyzed = 0;

  const candidateFindings: ReviewFinding[] = [];
  candidateFindings.push(...(options.additionalFindings ?? []));
  const shardSummaries: string[] = [];
  const counts = new Map<string, number>();
  for (const result of shardResults)
    counts.set(result.shardId, (counts.get(result.shardId) ?? 0) + 1);
  let invalidResults = false;
  const admittedResults: ShardReviewResult[] = [];
  for (const result of shardResults) {
    const shard = plan.shards.find((item) => item.id === result.shardId);
    const parsed = shardReviewResultSchema.safeParse(result);
    if (
      !parsed.success ||
      counts.get(result.shardId) !== 1 ||
      shard?.index !== result.shardIndex
    ) {
      invalidResults = true;
      continue;
    }
    admittedResults.push(parsed.data);
  }
  if (invalidResults || admittedResults.length !== plan.shards.length) {
    scopeStatus = "partial_by_failure";
    omissionReasons.push(
      text(
        "Shard results do not uniquely cover the admitted plan.",
        "Os resultados das partes não cobrem o plano admitido de forma única.",
        "Los resultados no cubren de forma única el plan admitido.",
      ),
    );
  }

  for (const result of admittedResults) {
    if (result.status === "failure") {
      scopeStatus = "partial_by_failure";
      omissionReasons.push(
        reviewMessage(options.language ?? "en", "shardFailure", {
          index: result.shardIndex + 1,
          id: result.shardId,
          reason: result.errorReason ? `: ${result.errorReason}` : "",
        }),
      );
    } else {
      shardsAnalyzed += 1;
      for (const code of result.outputLimitations ?? []) {
        omissionReasons.push(
          reviewMessage(
            options.language ?? "en",
            code === "summary_missing"
              ? "shardSummaryMissing"
              : "shardLimitation",
            {
              index: result.shardIndex + 1,
              code,
            },
          ),
        );
        if (
          code === "input_context_omitted" &&
          scopeStatus !== "partial_by_failure"
        )
          scopeStatus = "partial_by_policy";
      }
      candidateFindings.push(...result.findings);
      const trimmedSummary = result.summary.trim();
      if (trimmedSummary.length > 0) {
        shardSummaries.push(trimmedSummary);
      }
    }
  }

  // Deduplicate findings by location and diagnostic
  const dedupedFindingsMap = new Map<string, ReviewFinding>();
  for (const finding of candidateFindings) {
    const key = findingDeduplicationKey(finding);
    const existing = dedupedFindingsMap.get(key);
    if (existing === undefined || finding.confidence > existing.confidence) {
      dedupedFindingsMap.set(key, finding);
    }
  }

  // All files and changed lines across shards for host verification
  const allFiles = plan.shards.flatMap((shard) => shard.files);
  const allChangedLines = plan.shards.flatMap((shard) => shard.changedLines);
  const dedupedCandidates = Array.from(dedupedFindingsMap.values());

  const verifiedFindings =
    options.evidenceVerifier?.verify(dedupedCandidates) ??
    verifyFindingsWithCanonicalEvidence(dedupedCandidates, {
      changedLines: allChangedLines,
      files: allFiles,
      surface: plan.shards.flatMap((shard) => shard.surface ?? []),
      truncated: scopeStatus !== "complete",
    });

  const sortedFindings = (
    options.canonicalFindings ?? verifiedFindings.findings
  ).toSorted(compareFindings);

  const isAnyShardDegraded =
    (options.reconciliation?.unverifiedCount ?? 0) > 0 ||
    verifiedFindings.rejections.length > 0 ||
    admittedResults.some(
      (result) =>
        result.status === "success" &&
        (result.summary.trim().length === 0 ||
          result.isDegraded === true ||
          (result.outputLimitations?.length ?? 0) > 0),
    );
  if (verifiedFindings.rejections.length > 0)
    omissionReasons.push(
      text(
        "Candidate evidence was rejected by canonical verification.",
        "Evidências de candidatos foram rejeitadas pela verificação canônica.",
        "La verificación canónica rechazó evidencias de candidatos.",
      ),
    );

  const verdictDetails = determineReviewVerdict({
    language: options.language,
    findings: sortedFindings,
    isDegraded: isAnyShardDegraded,
    options: options.verdictPolicy,
    scopeStatus,
    shardsAnalyzed,
    totalShards: plan.shards.length,
  });

  const cleanApproval =
    verdictDetails.verdict === "APPROVE" && sortedFindings.length === 0;
  const prefix = [
    formatReviewSummaryHeader({
      verdict: verdictDetails.verdict,
      activeFindingsCount: sortedFindings.length,
      scopeStatus,
      isDegraded: isAnyShardDegraded,
      shardsAnalyzed,
      totalShards: plan.shards.length,
      language: options.language,
    }),
    ...(cleanApproval ? [] : verdictDetails.reasons),
  ].join("\n\n");
  const summarySections: string[] = [];
  const incomplete = scopeStatus !== "complete" || isAnyShardDegraded;
  const narrativeContent = incomplete
    ? text(
        "No conclusion is made about omitted changes or unfinished investigation.",
        "Não há conclusão sobre alterações omitidas ou investigação inacabada.",
        "No hay conclusión sobre cambios omitidos ni investigación sin terminar.",
      )
    : shardSummaries.length
      ? shardSummaries.join("\n\n")
      : text(
          "No narrative summary is available; refer to the verified findings and review coverage.",
          "Resumo narrativo indisponível; consulte os achados verificados e a cobertura da revisão.",
          "Resumen narrativo no disponible; consulte los hallazgos verificados y la cobertura de la revisión.",
        );

  const narrative = `${incomplete ? text("### Coverage", "### Cobertura", "### Cobertura") : text("### Changes reviewed", "### Mudanças revisadas", "### Cambios revisados")}\n\n${narrativeContent}`;

  const limitations: string[] = [];
  if (scopeStatus === "partial_by_policy") {
    limitations.push(
      text(
        "Some eligible patches or context sections were omitted by a deterministic host limit.",
        "Alguns patches elegíveis ou seções de contexto foram omitidos por um limite determinístico do host.",
        "Algunos patches elegibles o secciones de contexto fueron omitidos por un límite determinista del host.",
      ),
    );
  } else if (scopeStatus === "partial_by_failure" && !omissionReasons.length) {
    limitations.push(
      text(
        "Some changes could not be analyzed because execution failed.",
        "Algumas alterações não puderam ser analisadas porque a execução falhou.",
        "Algunos cambios no pudieron analizarse porque falló la ejecución.",
      ),
    );
  }

  if (options.reconciliation !== undefined) {
    const reconSection = formatReconciliationSection(
      options.reconciliation,
      options.language,
    );
    if (reconSection.length > 0) {
      summarySections.push(reconSection);
    }
  }

  if (omissionReasons.length)
    limitations.push(
      [...new Set(omissionReasons)].map((reason) => `- ${reason}`).join("\n"),
    );
  if (limitations.length)
    summarySections.push(
      `${text("### Review limitations", "### Limitações da revisão", "### Limitaciones de la revisión")}\n\n${limitations.join("\n\n")}`,
    );

  if (options.publication && options.publication.findings.length > 0)
    summarySections.push(
      formatConfiguredFindings(
        options.publication.findings,
        options.publication.output,
      ),
    );

  const lowSeverity = sortedFindings.filter(
    (finding) => classifyFindingPublication(finding) === "summary_only",
  );
  if (lowSeverity.length > 0) {
    summarySections.push(
      [
        text(
          "Low-severity observations:",
          "Observações de baixa severidade:",
          "Observaciones de baja gravedad:",
        ),
        ...lowSeverity.map((finding) => `- ${finding.diagnostic}`),
      ].join("\n"),
    );
  }

  if (options.structuralImpact !== undefined) {
    const structuralSection = formatStructuralImpactSection(
      options.structuralImpact,
      options.language,
    );
    if (structuralSection.length > 0) {
      summarySections.push(structuralSection);
    }
  }

  const finalSummary = fitPublicationSummary(
    prefix,
    narrative,
    summarySections.join("\n\n"),
    options.language,
  );

  return aggregatedReviewResultSchema.parse({
    findings: sortedFindings.map((f) => ({
      confidence: f.confidence,
      diagnostic: f.diagnostic,
      evidence: f.evidence.map((e) => ({
        ...(e.endLine !== undefined ? { endLine: e.endLine } : {}),
        excerpt: e.excerpt,
        path: e.path,
        reason: e.reason,
        startLine: e.startLine,
      })),
      location: {
        line: f.location.line,
        path: f.location.path,
        side: f.location.side,
        ...(f.location.startLine !== undefined
          ? { startLine: f.location.startLine }
          : {}),
      },
      severity: f.severity,
      ...(f.suggestion !== undefined ? { suggestion: f.suggestion } : {}),
    })),
    ...(isAnyShardDegraded ? { isDegraded: true } : {}),
    omissionReasons,
    reconciliation: options.reconciliation,
    scopeStatus,
    shardsAnalyzed,
    summary: finalSummary,
    totalShards: plan.shards.length,
    verdict: verdictDetails.verdict,
    verdictDetails,
  });
}
