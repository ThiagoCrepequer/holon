---
id: OPERATIONS-ERROR-OBSERVABILITY
kind: reference
status: deprecated
owners:
  - core-team
last-reviewed: 2026-09-27
---

# Diagnóstico de erros nos Workers

> Histórico anterior à ADR-0040. O pacote de observabilidade e seus wrappers
> foram removidos. Há somente logs nativos simples; este catálogo não descreve
> mais a cobertura atual. Consulte [retirada operacional](admin-retirement.md).

As configurações dos três Workers habilitam logs de invocação da Cloudflare com
amostragem integral. Um handler novo recebe automaticamente registro de
invocação e de exceção não tratada, sem chamar `withErrorReporting`. Falhas
capturadas que resultam em resposta de sucesso ou de erro controlado não são
reconhecidas automaticamente como falhas pela plataforma.

Para esses casos, o logger compartilhado escreve um objeto estruturado com
`console.error`, de modo que os campos sejam indexáveis no Workers Logs. Filtre
por `severity = error` e pelo campo `event`. Use `runId`, `workflowInstanceId`, `repositoryId`, `pullRequestNumber`,
`messageId` ou `deliveryId` para correlacionar uma execução. O `errorId` é um
identificador novo para cada registro, não uma chave de deduplicação.

Os registros incluem o nome e código seguro do erro, `statusCode`, `retryable`,
`errorPhase` e metadados seguros da causa quando disponíveis. Campos ausentes
significam que a informação não estava disponível ou não passou pela validação.
Os eventos mais úteis para uma análise que não iniciou são
`webhook.queue_send_failed`, `queue.batch_dispatch_failed`,
`queue.workflow_dispatch_failed`, `workflow.step_failed` e
`github.operation_failed`. A falha de um `createBatch` gera um registro para o
lote e um por grupo reconciliado, com `disposition` indicando `recovered` ou
`retry`. O consumidor do console registra por mensagem as falhas com
`disposition = retry` ou `quarantine`; falhas em cada destino de telemetria
também geram registros próprios. Falhas parciais ao extrair ou interpretar artefatos
de CI geram `ci.artifact_partial_failure` com tipo de operação e índice do
artefato, sem registrar seu nome ou conteúdo.

`withErrorReporting` é um adaptador para as poucas fronteiras que propagam uma
exceção e precisam acrescentar contexto seguro; não deve envolver toda função
nova. Funções internas são cobertas pela fronteira existente quando o erro
propaga. Um novo handler independente precisa de uma fronteira ou do registro
automático da Cloudflare. Quando um `catch` recupera uma falha, um batch
continua parcialmente ou uma função devolve um resultado degradado, somente
o código que conhece essa decisão pode emitir o evento por item. Não há
interceptador global capaz de deduzir que uma operação concluída foi parcial.

A instrumentação preserva a exceção original e a decisão de ack/retry; falhas
no próprio logger não devem alterar a execução. Ela não substitui um sink
externo de retenção, alertas ou tracing distribuído.
Os logs de plataforma para exceções não tratadas continuam complementares.
Eles podem incluir a mensagem original da exceção e metadados da requisição;
por isso os erros lançados nas fronteiras também devem evitar dados sensíveis.
Não há garantia de registrar erros que ocorram antes da inicialização do Worker
ou quando a plataforma não conseguir persistir logs.

## Segurança dos registros

O logger compartilhado só aceita campos de contexto enumerados e identificadores
com formato restrito. Não registra mensagens ou stacks de exceções, prompts,
diffs, conteúdo de arquivos, bodies HTTP, cabeçalhos de autorização ou chaves.
Novos pontos de falha tratados ou degradados devem usar `reportError` de
`@holon/observability`, passando somente IDs e fases operacionais. O adaptador
`withErrorReporting` é reservado para novas fronteiras sem captura central. Se uma
biblioteca encapsular o erro, preserve apenas metadados tipados seguros
(código, status, fase e nome de origem validado). Não passe objetos de exceção, requisição ou resposta completos
para `console.error`.

## Verificação e operação

Após publicar os Workers em ambiente autorizado, provoque uma falha controlada
em ambiente de teste e confira o registro no painel de Workers Logs. Para um
lote parcial, confira o registro do batch e o resultado por item antes de
considerar um retry seguro. `pnpm verify` valida código e testes locais; não
prova disponibilidade, retenção, permissão de leitura nem entrega dos logs da
conta Cloudflare.

Fontes Cloudflare verificadas em 2026-09-27:
[boas práticas de Workers](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/),
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[regras de Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) e
[retries parciais de Queues](https://developers.cloudflare.com/queues/configuration/batching-retries/).

## Autenticação do GitHub App

Os eventos `github.operation_failed`, `workflow.step_failed` e
`queue.follow_up_failed` incluem `errorReason` e `errorMessage` de um catálogo
fechado. A mensagem explica o motivo operacional; nunca é copiada da exceção
ou do body HTTP. `originCode` aceita somente códigos nativos conhecidos e
`githubRequestId` aceita o identificador hexadecimal retornado pelo GitHub.
Erros desconhecidos permanecem explícitos como `github_unknown_failure`; não
há promessa de recuperar texto descartado de execuções anteriores.

As fases separam `auth_configuration`, `jwt_signing` (inclui importação da
chave pelo assinador), `installation_token_request`,
`installation_token_response` e `pull_request_refs`. Falhas anteriores ou
posteriores às fronteiras instrumentadas do SDK mantêm `app_auth` ou
`installation_auth`. O hook de assinatura conserva a biblioteca, o cache do
SDK e o ajuste de relógio, sem implementar JWT manualmente. Erros normalizados
para Workflows preservam os metadados seguros em memória e acrescentam fase e
motivo à mensagem terminal; assim `wrangler workflows instances describe`
continua útil mesmo quando a plataforma não preserva propriedades customizadas.

Para o incidente do smoke, consulte o Worker `holon-control-plane`, selecione
o horário da execução e filtre por `event = github.operation_failed`. Use
`pullRequestNumber`, `runId` e `workflowInstanceId` quando presentes. O histórico
de etapas do Workflow não substitui os eventos de console. A leitura pela API
exige a permissão Workers Observability Write; `wrangler tail` captura somente
novos eventos. Nenhuma execução real, rotação ou deploy é disparado pelos testes.

Verificado localmente em 2026-09-27: com o pacote instalado
`universal-github-app-jwt@2.2.2`, o runtime Workers rejeita PKCS#1 com
`github_key_pkcs1_unsupported`; uma chave sintética PKCS#8 consegue assinar um JWT
verificado independentemente antes da resposta HTTP simulada. Isso reproduz
uma causa possível do incidente, sem afirmar qual segredo está implantado.

## Achados rejeitados pela evidência canônica

O evento `model.evidence_rejected` registra o primeiro motivo de rejeição de
cada candidato, com `severity = warning`, `shardIndex`, `candidateKind`
(`finding` ou `resolution`), `findingIndex` e, quando aplicável, `evidenceIndex`.
Todos os índices começam em zero e se referem à lista original daquele shard.
O evento herda `runId`, `workflowInstanceId`, `repositoryId` e
`pullRequestNumber` do Workflow. O sufixo do `eventId` diferencia os candidatos.

| `reason`                    | Significado                                               |
| --------------------------- | --------------------------------------------------------- |
| `location_file_missing`     | Arquivo do comentário não consta no contexto canônico.    |
| `location_outside_hunk`     | Intervalo do comentário não está contido em um hunk.      |
| `location_not_added`        | Linha de ancoragem não é uma linha adicionada.            |
| `evidence_file_missing`     | Arquivo da evidência não consta no contexto.              |
| `evidence_range_too_large`  | Intervalo ultrapassa o limite do validador.               |
| `evidence_range_missing`    | Uma linha citada não existe no patch disponível.          |
| `evidence_excerpt_empty`    | Citação vazia após normalização de espaços.               |
| `evidence_excerpt_mismatch` | Citação não corresponde ao conteúdo das linhas indicadas. |
| `finding_contract_invalid`  | Candidato não atende às demais invariantes de domínio.    |

Não são registrados caminhos, trechos, diagnósticos do modelo nem mensagens de
exceção. Não há reparo automático ou relaxamento do gate. Uma falha ao emitir
esse log não muda a aceitação nem a decisão de retry. O evento agregado
`model.output_limits` continua informando a quantidade de candidatos rejeitados.
Esses motivos somente estarão disponíveis para execuções feitas com a nova
instrumentação; não podem ser reconstruídos dos contadores antigos.

## Orçamentos e timeout da análise (2026-09-27)

`model.phase_started`, `model.phase_finished`, `model.phase_failed`,
`model.round_started`, `model.round_finished` e `model.recovery_scheduled`
registram fase, tentativa, rodada quando aplicável, duração, limite aplicado e
saldo da fase em milissegundos. O contexto adiciona run/Workflow/PR, shard e rota
de modelo configurada. Nenhum evento contém prompt, mensagens da investigação,
respostas de ferramenta ou texto de exceção. Falhas do logger não alteram a revisão.

Em `model.phase_failed`, `generation_step_timeout` indica o limite de uma rodada;
`phase_budget_exhausted` indica o fim do prazo da fase;
`insufficient_recovery_budget` indica que não há 60 segundos para iniciar recuperação.
`provider_transient`, `provider_permanent` e `generation_failed` distinguem falhas
HTTP classificadas e falhas não classificadas da geração. `remainingMs` se refere
à fase, não a um orçamento renovado a cada tentativa. Veja os tetos e reservas em
[fluxo de execução](../architecture/review-runtime-flow.md).

`repository.tool_started`, `repository.tool_finished` e `repository.tool_failed`
registram nome da ferramenta, shard e duração, sem argumentos ou conteúdo.
`repository_tool_timeout` permanece uma falha de infraestrutura
(`RepositoryToolError`), separada de `ModelGenerationTimeoutError`. Esgotamento
de ferramentas usa `tool_budget_exhausted`. O timeout externo do Workflow continua
visível no histórico do step na Cloudflare; ele pode impedir a execução de callbacks
finais, portanto um evento de início sem término também exige consultar esse histórico.

Os testes usam o AI SDK instalado e relógio simulado para exercitar cancelamento,
continuidade de mensagens, recuperação e esgotamento. Não representam medições de
latência do provider em produção. Os tetos iniciais são uma escolha operacional
com margem; devem ser reavaliados usando as durações registradas.

Referências verificadas em 2026-09-27:
[timeouts do AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/settings#timeout) e
[configuração de retries e timeout de Workflows](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/).

## Diagnóstico de reviews grandes

`review.coverage_planned` informa arquivos/bytes/linhas elegíveis e selecionados,
partes planejadas, concorrência e motivos de omissão serializados (somente códigos
e contagens). `model.output_limits` inclui `omittedSections` e todos os motivos
locais, inclusive orçamento de ferramentas; seu `eventId` inclui o shard.

`model.investigation_stopped` distingue `completed`, `round_limit`,
`tool_budget_exhausted`, `empty_analysis`, `output_length`, `generation_step_timeout`,
`phase_budget_exhausted`, `checks_unresolved` e `provider_transient_failure`. Inclui rodada concluída,
chamadas distintas e tempo restante. Compare-o aos eventos de fase para distinguir
limite de chamadas, rodadas e tempo; `investigation_incomplete` sozinho não prova
timeout. Eventos não contêm prompts, argumentos das tools, caminhos ou código.

Ondas aparecem como `analysis-wave-N` nos checkpoints, e partes mantêm
`analyze-shard-N`. O teto de 64 partes é admissão de trabalho; cinco é concorrência.
Não confundir limite de contexto global com truncamento de todos os prompts.

A partir da ADR-0043, `model.phase_failed` inclui `roundDurationMs` e
`timeoutScope` (`generation_step` ou `phase`). `durationMs` continua medindo a
tentativa inteira. Uma rodada inclui inferência e ferramentas, portanto seu
timeout não prova lentidão do provider. Correlacione `repository.tool_operation`
pelo runId: `lease_check`, `read_file`, `command_start` e `command_output`.
O evento registra espera cancelada ou encerrada, sem argumentos ou conteúdo.

Conforme a [ADR-0044](../decisions/0044-track-review-investigation-progress.md),
`model.investigation_progress` registra por rodada `durationMs`, `reason`
(finish reason), `outputTokens` e `reasoningTokens` quando o provider os fornece.
`repositoryRequests`, `toolCalls`, `cacheHits`, `coveringReadHits` e
`truncatedResults`, `readCalls` e `searchCalls` são contagens acumuladas da investigação, inclusive retomadas;
use diferenças entre rodadas, não some os valores acumulados. Checkpoints não
consomem chamadas de repositório. `reviewedChecks`, `pendingChecks` e
`blockedChecks` indicam cobertura declarada, não validação independente; `closing`
indica que o host reservou a rodada para encerramento. Os campos ausentes de
usage significam informação indisponível, não zero tokens.

Compare latência de rodada com as operações do executor. Muitos acertos em cache
sugerem repetição de consultas; muitas chamadas sem cache exigem avaliar se as
perguntas causais eram necessárias. As métricas não registram argumentos nem
permitem reconstruir o código revisado. Corpo indisponível no Gateway não deve
motivar habilitar coleta de prompts para medir redundância.
