import type { ReviewOutputPreferences } from "@holon/contracts";
import {
  aggregatedReviewResultSchema,
  type AggregatedReviewResult,
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
  formatVerdictBadge,
  type Finding,
  type FindingSeverity,
  type ReviewVerdictPolicyOptions,
} from "@holon/domain";

import { verifyFindingsWithCanonicalEvidence } from "./evidence.js";
import { formatConfiguredFindings } from "./inline-publication-plan.js";
import { fitPublicationSummary } from "./publication-summary.js";

export interface AggregateShardReviewOptions {
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
  if (report.testGaps.length > 0) {
    parts.push(
      text(
        `- 🧪 **Test Gaps**: ${report.testGaps.length} source file(s) modified without corresponding test file in PR`,
        `- 🧪 **Lacunas de testes**: ${report.testGaps.length} arquivo(s) fonte modificado(s) sem teste correspondente no PR`,
        `- 🧪 **Brechas de pruebas**: ${report.testGaps.length} archivo(s) fuente modificado(s) sin prueba correspondiente en el PR`,
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
      summary: text(
        "No eligible changes were found after excluding binary, lock, generated, vendored, minified, and recognized sensitive files.",
        "Nenhuma alteração elegível após excluir arquivos binários, de lock, gerados, de terceiros, minificados e sensíveis reconhecidos.",
        "No hay cambios elegibles tras excluir archivos binarios, de lock, generados, de terceros, minificados y sensibles reconocidos.",
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
  let shardsAnalyzed = 0;

  const candidateFindings: ReviewFinding[] = [];
  candidateFindings.push(...(options.additionalFindings ?? []));
  const shardSummaries: string[] = [];

  for (const result of shardResults) {
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
          reviewMessage(options.language ?? "en", "shardLimitation", {
            index: result.shardIndex + 1,
            code,
          }),
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

  const verifiedFindings = verifyFindingsWithCanonicalEvidence(
    dedupedCandidates,
    {
      changedLines: allChangedLines,
      files: allFiles,
      surface: plan.shards.flatMap((shard) => shard.surface ?? []),
      truncated: scopeStatus !== "complete",
    },
  );

  const sortedFindings = (
    options.canonicalFindings ?? verifiedFindings.findings
  ).toSorted(compareFindings);

  const isAnyShardDegraded =
    (options.reconciliation?.unverifiedCount ?? 0) > 0 ||
    shardResults.some((result) => result.isDegraded === true);

  const verdictDetails = determineReviewVerdict({
    language: options.language,
    findings: sortedFindings,
    isDegraded: isAnyShardDegraded,
    options: options.verdictPolicy,
    scopeStatus,
    shardsAnalyzed,
    totalShards: plan.shards.length,
  });

  // Compose summary
  const summarySections: string[] = [
    formatVerdictBadge(verdictDetails.verdict, options.language),
  ];
  if (verdictDetails.reasons.length > 0) {
    summarySections.push(verdictDetails.reasons.join(" "));
  }

  const prefix = summarySections.join("\n\n");
  summarySections.length = 0;
  const incomplete = scopeStatus !== "complete" || isAnyShardDegraded;
  const narrative = incomplete
    ? text(
        `This review is incomplete. ${sortedFindings.length} verified finding(s) were retained from ${shardsAnalyzed} of ${plan.shards.length} planned shards. No conclusion is made about omitted changes or unfinished investigation.`,
        `Esta revisão está incompleta. ${sortedFindings.length} achado(s) verificado(s) foram mantidos em ${shardsAnalyzed} de ${plan.shards.length} partes planejadas. Não há conclusão sobre alterações omitidas ou investigação inacabada.`,
        `Esta revisión está incompleta. Se conservaron ${sortedFindings.length} hallazgo(s) verificado(s) en ${shardsAnalyzed} de ${plan.shards.length} partes previstas. No hay conclusión sobre cambios omitidos ni investigación sin terminar.`,
      )
    : shardSummaries.length
      ? shardSummaries.join("\n\n")
      : text(
          "No narrative summary is available; refer to the verified findings and review coverage.",
          "Resumo narrativo indisponível; consulte os achados verificados e a cobertura da revisão.",
          "Resumen narrativo no disponible; consulte los hallazgos verificados y la cobertura de la revisión.",
        );

  if (scopeStatus === "partial_by_policy") {
    summarySections.push(
      text(
        "Partial review: at least one eligible patch or context section was omitted by a deterministic host budget.",
        "Revisão parcial: ao menos um patch elegível ou seção de contexto foi omitido por um limite determinístico do host.",
        "Revisión parcial: al menos un patch elegible o sección de contexto fue omitido por un límite determinista del host.",
      ),
    );
  } else if (scopeStatus === "partial_by_failure") {
    summarySections.push(
      text(
        "Partial review: some changes could not be analyzed due to an execution failure.",
        "Revisão parcial: algumas alterações não puderam ser analisadas devido a uma falha de execução.",
        "Revisión parcial: algunos cambios no pudieron analizarse por un fallo de ejecución.",
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
    summarySections.push(
      text(
        "Review limitations:\n",
        "Limitações da revisão:\n",
        "Limitaciones de la revisión:\n",
      ) +
        [...new Set(omissionReasons)].map((reason) => `- ${reason}`).join("\n"),
    );

  if (options.publication)
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
