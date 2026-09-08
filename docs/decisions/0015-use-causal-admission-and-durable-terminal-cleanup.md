---
id: ADR-0015
kind: decision
superseded-by: 0036-use-single-current-development-contracts.md
status: superseded
date: 2026-08-30
owners:
  - core-team
supersedes: []
related:
  - 0004-adopt-workflows-do-ledger-and-sandbox-executor.md
  - 0006-use-granular-workflow-checkpoints.md
  - ../architecture/state-and-idempotency.md
  - ../architecture/data-lifecycle.md
---

# Usar admissão causal e cleanup terminal durável

## Contexto e problema

Queue entrega fora de ordem e pelo menos uma vez. Comparar somente a chegada ao
consumer permite que um evento antigo atrasado substitua o head mais novo. Uma
única verificação antes de publicar também deixa uma janela entre múltiplos
POSTs. Por fim, um cleanup executado apenas em `finally` deixa containers órfãos
quando o próprio cleanup falha ou o Workflow esgota retries.

## Decisão

- Webhook e job V2 preservam `pull_request.updated_at`. O ledger ordena primeiro
  por esse relógio causal, depois por `receivedAt` e usa run ID apenas como
  desempate determinístico.
- A evolução do SQLite do Durable Object usa uma tabela explícita de migrations
  e passos transacionais; introspecção ad hoc por `PRAGMA table_info` não é o
  mecanismo de versionamento.
- A admissão da publicação exige atomicamente run `publishing` e run ainda
  mais recente. O head GitHub é relido antes de cada mutação externa, inclusive
  comentário inline, review-resumo e aviso terminal.
- Cada publication claim é condicional à mesma autorização. Marcador, tipo de
  endpoint e ID retornado continuam persistidos para reconciliar timeout
  ambíguo.
- IDs de Workflow derivam deterministicamente do run ID. `createBatch` é tratado
  como idempotente: redelivery já existente é reconhecida e confirmada, sem
  retry infinito do lote.
- Instâncias usam retenção explícita de um dia para sucesso e três dias para
  erro, compatível também com o limite documentado do plano Free.
- Falhas GitHub são classificadas em permanentes, transitórias e rate limit.
  `Retry-After` e reset de quota determinam delay limitado; falha permanente
  vira `NonRetryableError`. A sessão agentiva do modelo permanece sem retry do
  Workflow.
- Toda terminalização que criou Sandbox registra, na mesma transação, uma tarefa
  de cleanup. Um alarm do Durable Object tenta cleanup idempotente com backoff
  limitado por intervalo, persiste tentativas e só marca conclusão após sucesso.
  Credential scopes são removidos quando o cleanup conclui.
- Logs usam event IDs determinísticos, duração e categorias de erro conhecidas;
  mensagens arbitrárias de exceção não são registradas.

## Alternativas rejeitadas

### Ordenar por consumo da Queue

Rejeitada porque consumo não representa a ordem causal do PR.

### Revalidar apenas uma vez antes do primeiro POST

Rejeitada porque um force-push pode ocorrer entre comentários.

### Cleanup best-effort no fim do Workflow

Rejeitada porque uma falha naquele passo perde a obrigação de deleção.

## Consequências

### Positivas

- Eventos atrasados não retomam autoridade sobre um PR atualizado.
- Cada efeito externo tem autorização recente e reconciliação determinística.
- Cleanup sobrevive à falha da execução que o solicitou.

### Negativas

- Cada publicação consome uma leitura adicional do head GitHub.
- Ledger, alarms e migrations ficam mais complexos.
- Três dias de diagnóstico de erro podem ser insuficientes; ampliar exige prova
  do plano Cloudflare e uma nova decisão operacional.

## Critérios de confirmação

- Teste entrega B e depois A e mantém B como latest, inclusive com `updatedAt`
  empatado e `receivedAt` distinto.
- Redelivery com mesmo run ID é ack sem novo Workflow.
- Force-push entre dois POSTs impede o segundo.
- Falha de cleanup deixa tarefa pending, o alarm repete e depois a conclui.
- Rate limit respeita delay do GitHub; 4xx permanente não é repetido.
- Nenhum log contém prompt, diff, arquivo, token ou mensagem arbitrária.

## Evidência

Verificada em 2026-08-30:

- [Cloudflare: regras de Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Cloudflare: Workers API para Workflows](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Cloudflare Durable Objects: alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Durable Objects: SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [GitHub REST API: rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
