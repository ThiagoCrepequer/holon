import type { ReviewLanguage } from "./review-language.js";

export const reviewMessages = {
  configurationInvalid: {
    en: "Repository configuration (.github/holon.yml or .holon.yml) could not be applied:\n\n> {reason}",
    "pt-BR":
      "Não foi possível aplicar a configuração do repositório (.github/holon.yml ou .holon.yml):\n\n> {reason}",
    es: "No se pudo aplicar la configuración del repositorio (.github/holon.yml o .holon.yml):\n\n> {reason}",
  },
  configurationInvalidTitle: {
    en: "Repository configuration failed",
    "pt-BR": "Falha na configuração do repositório",
    es: "Falló la configuración del repositorio",
  },
  configurationFix: {
    en: "Correct the configuration on the base branch to resume automated reviews.",
    "pt-BR":
      "Corrija a configuração na branch base para retomar as revisões automáticas.",
    es: "Corrija la configuración en la rama base para reanudar las revisiones automáticas.",
  },
  configurationUnknown: {
    en: "Repository configuration could not be validated.",
    "pt-BR": "Não foi possível validar a configuração do repositório.",
    es: "No se pudo validar la configuración del repositorio.",
  },
  configurationConflict: {
    en: "Use only one configuration file: .github/holon.yml or .holon.yml.",
    "pt-BR":
      "Use somente um arquivo de configuração: .github/holon.yml ou .holon.yml.",
    es: "Use un solo archivo de configuración: .github/holon.yml o .holon.yml.",
  },
  configurationYaml: {
    en: "Repository configuration contains unsupported or invalid YAML.",
    "pt-BR": "A configuração contém YAML inválido ou não suportado.",
    es: "La configuración contiene YAML inválido o no compatible.",
  },
  configurationSchema: {
    en: "Repository configuration does not match the strict configuration schema.",
    "pt-BR": "A configuração não corresponde ao schema estrito.",
    es: "La configuración no coincide con el schema estricto.",
  },
  configurationFile: {
    en: "A configuration source failed file validation.",
    "pt-BR": "Uma fonte de configuração falhou na validação de arquivo.",
    es: "Una fuente de configuración falló la validación de archivo.",
  },
  configurationAccess: {
    en: "Repository configuration could not be read with the installation permissions.",
    "pt-BR": "As permissões da instalação não permitiram ler a configuração.",
    es: "Los permisos de la instalación no permitieron leer la configuración.",
  },
  configurationSnapshot: {
    en: "The configuration base snapshot is unavailable.",
    "pt-BR": "O snapshot da base da configuração está indisponível.",
    es: "El snapshot base de la configuración no está disponible.",
  },
  configurationSize: {
    en: "A repository configuration source exceeds its byte limit.",
    "pt-BR": "Uma fonte de configuração excede seu limite de bytes.",
    es: "Una fuente de configuración supera su límite de bytes.",
  },
  configurationBudget: {
    en: "Repository configuration exceeds a supported processing budget.",
    "pt-BR": "A configuração excede um limite de processamento suportado.",
    es: "La configuración supera un límite de procesamiento compatible.",
  },
  configurationIntegrity: {
    en: "The saved repository configuration failed integrity validation.",
    "pt-BR": "A configuração persistida falhou na validação de integridade.",
    es: "La configuración guardada falló la validación de integridad.",
  },
  configurationRoot: {
    en: "A configured project root does not exist in the base snapshot.",
    "pt-BR": "Um root de projeto configurado não existe no snapshot da base.",
    es: "Una raíz de proyecto configurada no existe en el snapshot base.",
  },
  configurationReference: {
    en: "A referenced configuration file is missing or excluded.",
    "pt-BR":
      "Um arquivo referenciado na configuração está ausente ou excluído.",
    es: "Un archivo referenciado en la configuración está ausente o excluido.",
  },
  configurationCompatibility: {
    en: "A declared compatibility constraint is invalid for its ecosystem.",
    "pt-BR":
      "Uma restrição de compatibilidade declarada é inválida para seu ecossistema.",
    es: "Una restricción de compatibilidad declarada no es válida para su ecosistema.",
  },
  all_excluded: {
    en: "All {count} eligible file(s) in this pull request were excluded by repository policy.",
    "pt-BR":
      "Todos os {count} arquivos elegíveis deste pull request foram excluídos pela política do repositório.",
    es: "Los {count} archivos elegibles de este pull request fueron excluidos por la política del repositorio.",
  },
  unsupported: {
    en: "No supported or non-binary files found in the pull request diff.",
    "pt-BR":
      "Nenhum arquivo compatível ou não binário encontrado no diff do pull request.",
    es: "No se encontraron archivos compatibles o no binarios en el diff del pull request.",
  },
  oversized_patches: {
    en: "{count} eligible file(s) contain lines or metadata that cannot fit the {bytes}-byte partition budget; those units were omitted.",
    "pt-BR":
      "{count} arquivos elegíveis contêm linhas ou metadados que não cabem no orçamento de {bytes} bytes por parte; essas unidades foram omitidas.",
    es: "{count} archivos elegibles contienen líneas o metadatos que no caben en {bytes} bytes por parte; esas unidades fueron omitidas.",
  },
  file_limit: {
    en: "{count} eligible file(s) omitted by the 50-file limit across shards.",
    "pt-BR":
      "{count} arquivos elegíveis foram omitidos pelo limite de 50 arquivos entre as partes.",
    es: "Se omitieron {count} archivos elegibles por el límite de 50 archivos entre las partes.",
  },
  policy_excluded: {
    en: "{count} eligible file(s) excluded by repository policy.",
    "pt-BR":
      "{count} arquivos elegíveis foram excluídos pela política do repositório.",
    es: "Se excluyeron {count} archivos elegibles por la política del repositorio.",
  },
  shard_limit: {
    en: "Review was bounded to the first {maximum} priority shards out of {planned} planned shards by policy.",
    "pt-BR":
      "A revisão foi limitada às primeiras {maximum} partes prioritárias de {planned} partes planejadas pela política.",
    es: "La política limitó la revisión a las primeras {maximum} partes prioritarias de {planned} partes planificadas.",
  },
  executor_budget: {
    en: "Eligible patches or context sections were omitted by the executor budget.",
    "pt-BR":
      "Patches elegíveis ou seções de contexto foram omitidos pelo limite do executor.",
    es: "Se omitieron patches elegibles o secciones de contexto por el límite del ejecutor.",
  },
  shardFailure: {
    en: "Shard {index} ({id}) failed during analysis{reason}.",
    "pt-BR": "A parte {index} ({id}) falhou durante a análise{reason}.",
    es: "La parte {index} ({id}) falló durante el análisis{reason}.",
  },
  shardLimitation: {
    en: "Shard {index}: {code}.",
    "pt-BR": "Parte {index}: {code}.",
    es: "Parte {index}: {code}.",
  },
  exported_symbol_removed: {
    en: "Exported symbol removed",
    "pt-BR": "Símbolo exportado removido",
    es: "Símbolo exportado eliminado",
  },
  signature_changed: {
    en: "Signature changed",
    "pt-BR": "Assinatura alterada",
    es: "Firma modificada",
  },
  schema_field_removed: {
    en: "Schema field removed",
    "pt-BR": "Campo do schema removido",
    es: "Campo del esquema eliminado",
  },
  sql_destructive_migration: {
    en: "Destructive database operation",
    "pt-BR": "Operação destrutiva no banco de dados",
    es: "Operación destructiva en la base de datos",
  },
  synthesisUnavailable: {
    en: "Narrative synthesis was unavailable. Refer to the verified findings and coverage in this review.",
    "pt-BR":
      "A síntese narrativa não estava disponível. Consulte os achados verificados e a cobertura desta revisão.",
    es: "La síntesis narrativa no estaba disponible. Consulta los hallazgos verificados y la cobertura de esta revisión.",
  },
  finalizationFailed: {
    en: "Review finalization failed after recovery. Findings from the unfinished investigation were not published; this review is incomplete.",
    "pt-BR":
      "A finalização da revisão falhou após a recuperação. Os achados da investigação inacabada não foram publicados; esta revisão está incompleta.",
    es: "La finalización de la revisión falló tras la recuperación. No se publicaron los hallazgos de la investigación inconclusa; esta revisión está incompleta.",
  },
  narrativeOmitted: {
    en: "[Additional narrative omitted to fit the publication budget.]",
    "pt-BR":
      "[Narrativa adicional omitida para respeitar o limite de publicação.]",
    es: "[Narrativa adicional omitida para respetar el límite de publicación.]",
  },
  detailOmitted: {
    en: "[Additional detail omitted.]",
    "pt-BR": "[Detalhes adicionais omitidos.]",
    es: "[Detalles adicionales omitidos.]",
  },
  publicationCounts: {
    en: "Findings: {total} active; {inline} eligible new inline comments; {remaining} without a new inline comment. All findings remain in the console.",
    "pt-BR":
      "Achados: {total} ativos; {inline} novos comentários inline elegíveis; {remaining} sem novo comentário inline. Todos os achados permanecem no console.",
    es: "Hallazgos: {total} activos; {inline} nuevos comentarios inline elegibles; {remaining} sin nuevo comentario inline. Todos los hallazgos permanecen en la consola.",
  },
  suggestedAction: {
    en: "Suggested action",
    "pt-BR": "Ação sugerida",
    es: "Acción sugerida",
  },
  evidence: {
    en: "Evidence",
    "pt-BR": "Evidência",
    es: "Evidencia",
  },
  resolved: {
    en: "✅ Issue resolved in commit `{sha}`.",
    "pt-BR": "✅ Defeito resolvido no commit `{sha}`.",
    es: "✅ Problema resuelto en el commit `{sha}`.",
  },
  feedbackUpdated: {
    en: "Review updated to reflect current human feedback.",
    "pt-BR": "Revisão atualizada para refletir o feedback humano atual.",
    es: "Revisión actualizada para reflejar los comentarios humanos actuales.",
  },
  ciTitle: {
    en: "### 🧪 CI Test & Coverage Evidence",
    "pt-BR": "### 🧪 Evidências de testes e cobertura de CI",
    es: "### 🧪 Evidencias de pruebas y cobertura de CI",
  },
  ciUnavailable: {
    en: "*CI test and coverage artifacts were not available for this run.*",
    "pt-BR":
      "*Os artefatos de testes e cobertura de CI não estavam disponíveis para esta execução.*",
    es: "*Los artefactos de pruebas y cobertura de CI no estaban disponibles para esta ejecución.*",
  },
  ciCoverage: {
    en: "- **Changed lines coverage**: {percentage}% ({covered}/{total} lines covered)",
    "pt-BR":
      "- **Cobertura das linhas alteradas**: {percentage}% ({covered}/{total} linhas cobertas)",
    es: "- **Cobertura de líneas modificadas**: {percentage}% ({covered}/{total} líneas cubiertas)",
  },
  ciUncovered: {
    en: "  - **Uncovered lines**:",
    "pt-BR": "  - **Linhas sem cobertura**:",
    es: "  - **Líneas sin cobertura**:",
  },
  ciLines: {
    en: "lines",
    "pt-BR": "linhas",
    es: "líneas",
  },
  ciMoreLines: {
    en: "...and {count} more lines",
    "pt-BR": "...e mais {count} linhas",
    es: "...y {count} líneas más",
  },
  ciMoreFiles: {
    en: "    - *...and {count} more files with uncovered lines.*",
    "pt-BR": "    - *...e mais {count} arquivos com linhas sem cobertura.*",
    es: "    - *...y {count} archivos más con líneas sin cobertura.*",
  },
  ciSuite: {
    en: "- **Test suite**: {passed} passed, {failed} failed, {skipped} skipped, {total} total{duration}",
    "pt-BR":
      "- **Suíte de testes**: {passed} passaram, {failed} falharam, {skipped} ignorados, {total} no total{duration}",
    es: "- **Suite de pruebas**: {passed} pasaron, {failed} fallaron, {skipped} omitidos, {total} en total{duration}",
  },
  ciFailed: {
    en: "  - **Failed tests ({count})**:",
    "pt-BR": "  - **Testes que falharam ({count})**:",
    es: "  - **Pruebas fallidas ({count})**:",
  },
  ciTestFailed: {
    en: "Test failed",
    "pt-BR": "Teste falhou",
    es: "Prueba fallida",
  },
  ciMoreFailed: {
    en: "    - *...and {count} more failed tests.*",
    "pt-BR": "    - *...e mais {count} testes que falharam.*",
    es: "    - *...y {count} pruebas fallidas más.*",
  },
  ciWorkflow: {
    en: "CI Workflow",
    "pt-BR": "Workflow de CI",
    es: "Workflow de CI",
  },
  ciRun: {
    en: "run",
    "pt-BR": "execução",
    es: "ejecución",
  },
  ciSource: {
    en: "Source",
    "pt-BR": "Origem",
    es: "Origen",
  },
  superseded: {
    en: "A newer commit or updated base was detected on this pull request. This review run was superseded.",
    "pt-BR":
      "Um novo commit ou uma atualização da base foi detectado neste pull request. Esta revisão foi substituída.",
    es: "Se detectó un nuevo commit o una base actualizada en este pull request. Esta revisión fue sustituida.",
  },
  supersededTitle: {
    en: "Holon Review Superseded",
    "pt-BR": "Revisão Holon substituída",
    es: "Revisión Holon sustituida",
  },
  inProgress: {
    en: "Holon is reviewing pull request changes for functional regressions, contract breaks, and security flaws.",
    "pt-BR":
      "O Holon está revisando as alterações do pull request em busca de regressões funcionais, quebras de contrato e falhas de segurança.",
    es: "Holon está revisando los cambios del pull request en busca de regresiones funcionales, rupturas de contratos y fallos de seguridad.",
  },
  inProgressTitle: {
    en: "Holon Review in progress",
    "pt-BR": "Revisão Holon em andamento",
    es: "Revisión Holon en curso",
  },
  failedTitle: {
    en: "Holon Review Failed",
    "pt-BR": "A revisão Holon falhou",
    es: "La revisión Holon falló",
  },
  failed: {
    en: "Holon encountered a system failure and could not complete the automated review. Scheduled for cleanup.",
    "pt-BR":
      "O Holon encontrou uma falha de sistema e não conseguiu concluir a revisão automática. A limpeza foi agendada.",
    es: "Holon encontró un fallo del sistema y no pudo completar la revisión automática. La limpieza fue programada.",
  },
  failureNotice: {
    en: "Holon could not complete this automated review. The run was stopped and its repository sandbox was scheduled for cleanup. Push a new commit or synchronize the pull request to start a fresh run.",
    "pt-BR":
      "O Holon não conseguiu concluir esta revisão automática. A execução foi interrompida e a limpeza do sandbox foi agendada. Envie um novo commit ou sincronize o pull request para iniciar outra execução.",
    es: "Holon no pudo completar esta revisión automática. La ejecución se detuvo y se programó la limpieza del sandbox. Envía un nuevo commit o sincroniza el pull request para iniciar otra ejecución.",
  },
  identityPending: {
    en: "### Identity revalidation pending ({count})",
    "pt-BR": "### Revalidação de identidade pendente ({count})",
    es: "### Revalidación de identidad pendiente ({count})",
  },
  identityPendingReason: {
    en: "Evidence cannot uniquely match these findings to previous findings. New inline comments and resolutions for the ambiguous group are withheld.",
    "pt-BR":
      "A evidência não permite associar estes achados de forma única aos anteriores. Novos comentários inline e resoluções do grupo ambíguo foram suspensos.",
    es: "La evidencia no permite asociar estos hallazgos de forma única con los anteriores. Se suspendieron los nuevos comentarios inline y las resoluciones del grupo ambiguo.",
  },
} as const;
export type ReviewMessageCode = keyof typeof reviewMessages;
export function reviewMessage(
  language: ReviewLanguage,
  code: ReviewMessageCode,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return reviewMessages[code][language].replace(
    /\{([a-zA-Z]+)\}/gu,
    (match, name: string) => String(values[name] ?? match),
  );
}
