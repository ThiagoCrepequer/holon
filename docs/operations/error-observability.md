---
id: OPERATIONS-ERROR-OBSERVABILITY
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-09-27
---

# Diagnóstico de erros nos Workers

Os Workers do control plane, executor e console interno escrevem falhas estruturadas
com `console.error`. Em Workers Logs, filtre por `severity = error` e pelo campo
`event`. Use `runId`, `workflowInstanceId`, `repositoryId`, `pullRequestNumber`,
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

A instrumentação fica nas fronteiras de HTTP, Queue, Workflow, RPC, Sandbox e
nos destinos assíncronos. Ela preserva a exceção original e a decisão de
ack/retry; falhas no próprio logger não devem alterar a execução. Ela não
substitui um sink externo de retenção, alertas ou tracing distribuído.
Os logs de plataforma para exceções não tratadas continuam complementares.
Não há garantia de registrar erros que ocorram antes da inicialização do Worker
ou quando a plataforma não conseguir persistir logs.

## Segurança dos registros

O logger compartilhado só aceita campos de contexto enumerados e identificadores
com formato restrito. Não registra mensagens ou stacks de exceções, prompts,
diffs, conteúdo de arquivos, bodies HTTP, cabeçalhos de autorização ou chaves.
Novos pontos de falha devem usar `reportError` ou `withErrorReporting` de
`@holon/observability`, passando somente IDs e fases operacionais. Se uma
biblioteca encapsular o erro, preserve apenas metadados tipados seguros
(código, status, fase e nome de origem validado). Não passe objetos completos
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
