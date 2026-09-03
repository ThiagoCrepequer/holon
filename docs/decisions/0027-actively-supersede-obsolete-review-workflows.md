---
id: ADR-0027
kind: decision
status: accepted
date: 2026-09-03
owners:
  - core-team
supersedes: []
related:
  - 0015-use-causal-admission-and-durable-terminal-cleanup.md
  - 0023-adopt-cloudflare-native-operational-reliability-and-observability.md
  - ../architecture/review-runtime-flow.md
  - ../architecture/state-and-idempotency.md
  - ../architecture/data-lifecycle.md
---

# Cancelar ativamente Workflows de review causalmente obsoletos

## Contexto e problema

O ADR-0015 impede publicação obsoleta por ordenação causal, revalidação do head
e autorização no ledger. Entretanto, um Workflow antigo pode permanecer dentro
de `analyze-review` até o próximo checkpoint depois de um novo
`pull_request.synchronize`. A correção é preservada, mas inferência, quota e
latência continuam sendo consumidas por trabalho cujo resultado não poderá ser
publicado.

Cloudflare Queues entrega pelo menos uma vez e não garante ordem. Por isso, o
consumer não pode decidir qual instância cancelar apenas pela ordem de chegada.
Cloudflare Workflows oferece `terminate({ rollback: true })`, mas a operação
falha para instâncias que já chegaram a estado terminal e não substitui a
persistência de cleanup fora do próprio Workflow.

## Direcionadores

- nunca cancelar uma run causalmente mais nova por entrega fora de ordem;
- não interromper a run antiga antes de a nova autoridade estar persistida;
- manter cleanup recuperável mesmo que a instância cancelada não execute outro
  `finally` ou checkpoint;
- tratar cancelamento como otimização de custo, sem transformá-lo na fronteira
  de correção;
- preservar compatibilidade com Workflows antigos durante rollout;
- não deixar Check Runs terminados ativamente em `in_progress`.

## Opções consideradas

### Cancelar no Queue consumer antes de criar a nova instância

- Prós: reação antecipada ao webhook.
- Contras: usa chegada como causalidade e pode deixar o PR sem executor válido
  se a criação da nova instância falhar.

### Manter somente os checkpoints existentes

- Prós: nenhuma persistência ou integração nova.
- Contras: uma chamada de modelo longa continua consumindo recursos mesmo
  depois de perder autoridade.

### Transferir autoridade no ledger e cancelar depois

- Prós: a decisão causal permanece serializada no Durable Object por PR;
  falhas de cancelamento não devolvem autoridade à run antiga.
- Contras: adiciona tarefas persistidas, alarm e compensação de Check Run.

## Decisão

Escolhemos transferir autoridade no ledger e cancelar depois.

1. `claimRunV2` mantém a ordenação do ADR-0015. Quando promove uma nova run, a
   mesma transação SQLite:
   - muda toda run ativa anterior para `obsolete` com operation ID
     determinístico;
   - registra uma obrigação `workflow_supersessions` por instância antiga;
   - registra cleanup apenas quando o credential scope prova que a preparação
     do Sandbox já começou;
   - atualiza a identidade causal mais recente.
2. O retorno versionado inclui até cem obrigações pendentes. Assim, em A→B→C,
   C também recebe A se B for interrompido antes de cancelá-la.
3. A nova instância executa cada cancelamento em um step pequeno antes de
   preparar o repositório ou chamar o modelo. Ela relê o status, considera
   `complete`, `errored` e `terminated` reconciliados, e usa
   `terminate({ rollback: true })` para estados ativos.
4. `start-check-run` registra rollback que conclui o Check Run conhecido como
   `cancelled`. Cleanup do Sandbox não depende desse rollback: permanece no
   ledger e no executor idempotente.
5. Falha transitória de `terminate` não falha a review mais nova. Supersession e
   cleanup da run substituída ficam `pending` por uma janela de 30 segundos. A
   confirmação do cancelamento antecipa o cleanup; sem confirmação, o alarm
   prioriza cleanup e tenta o cancelamento novamente com backoff exponencial
   limitado a uma hora. As duas obrigações possuem relógios próprios.
6. Revalidação de head, `isLatestRun`, autorização condicional de publicação e
   marcadores idempotentes continuam obrigatórios. Cancelamento ativo reduz
   desperdício; ele não autoriza efeitos externos.

## Consequências

### Positivas

- inferência obsoleta é interrompida perto do handoff causal;
- uma terceira run recupera cancelamentos deixados pela segunda;
- falha ou corrida terminal de `terminate` é reconciliada sem derrubar a run
  atual;
- Sandbox e Check Run possuem compensações explícitas e independentes;
- o protocolo continua correto sob redelivery e entrega fora de ordem.

### Negativas

- o ledger ganha uma migration, uma fila lógica adicional e mais estados de
  manutenção;
- o cancelamento imediato pode levar até 30 segundos para ser retomado pelo
  alarm quando a primeira tentativa falha;
- rollbacks de Workflows precisam ser observados separadamente do status geral
  durante operação;
- no máximo cem cancelamentos são tentados diretamente por uma claim; excesso
  permanece durável e é drenado pelo alarm.

## Critérios de confirmação

- A→B marca A `obsolete`, registra cleanup quando aplicável e só então chama
  `terminate` para a instância de A.
- A→B→C permite que C cancele A e B se ambas continuam pendentes.
- B atrasada depois de C retorna `duplicate` e não cancela C.
- corrida entre `status()` e `terminate()` que termina a instância é tratada
  como sucesso idempotente.
- indisponibilidade transitória mantém obrigação pending e o alarm a conclui.
- rollback de `start-check-run` conclui o Check Run como `cancelled`.
- testes focados e cobertura do control-plane permanecem acima dos thresholds.

## Gatilhos para revisitar

- Cloudflare oferecer cancelamento condicional ou uma chave nativa de
  supersession por entidade;
- mais de cem Workflows pendentes por PR aparecerem em telemetria real;
- rollback deixar de preservar a semântica documentada ou ganhar garantias que
  permitam remover compensações do ledger.

## Evidência

Verificada em 2026-09-03:

- [Cloudflare Workflows: Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Cloudflare Workflows: trigger e terminate](https://developers.cloudflare.com/workflows/build/trigger-workflows/)
- [Cloudflare Queues: garantias de entrega](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Cloudflare Queues: ausência de ordenação](https://developers.cloudflare.com/queues/reference/how-queues-works/)
- [Cloudflare Durable Objects: regras e coordenação](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Cloudflare Durable Objects: alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
