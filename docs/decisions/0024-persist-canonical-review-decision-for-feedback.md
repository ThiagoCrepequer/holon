---
id: ADR-0024
kind: decision
status: accepted
date: 2026-09-03
owners:
  - core-team
related:
  - 0019-derive-deterministic-review-verdict-by-policy.md
  - 0020-reconcile-findings-across-commits-with-stable-fingerprints.md
  - 0021-capture-human-feedback-and-calibration-signals.md
  - ../architecture/state-and-idempotency.md
  - ../architecture/review-runtime-flow.md
---

# Persistir a decisão canônica da review para feedback

## Contexto e problema

O feedback humano chega em webhooks independentes da execução original. Recriar
nesse handler o head SHA, a cobertura, a degradação ou a confiança dos findings
produzia uma segunda interpretação do resultado: o código usava confiança fixa,
assumia escopo completo e tentava redescobrir o Check Run sem o ref exigido pelo
GitHub. Além disso, persistir o feedback antes da autorização e atualizar finding
e evento em operações separadas não suportava redelivery com segurança.

## Decisão

1. A execução persiste no ledger, antes de concluir a publicação, um snapshot da decisão:
   `headSha`, `scopeStatus`, `shardsAnalyzed`, `totalShards`, `isDegraded` e o ID
   já conhecido do Check Run.
2. Cada finding persiste sua confiança validada. O feedback recalcula o veredito
   somente com findings canônicos ativos e suas severidades e confianças reais.
3. Ausência de finding em shard não revisado, com falha ou degradado não implica
   resolução. `obsolete` só é inferido quando a cobertura do PR é completa;
   `resolved` exige que o arquivo tenha sido efetivamente revisado.
4. Feedback que muda o veredito exige autorização antes da mutação. Comentários
   consultam a associação fornecida pelo GitHub; resolução de thread consulta a
   permissão atual do usuário no repositório e aceita `write`, `maintain` ou
   `admin`.
5. O ledger aplica evento e mutação do finding em uma transação identificada pelo
   delivery ID. Redelivery retorna o resultado persistido. A resposta usa marcador
   determinístico e registra o ID retornado pelo GitHub para reconciliar timeout.
6. O handler atualiza diretamente o Check Run persistido. Sem snapshot ou ID não
   fabrica contexto: mantém o feedback registrado e não altera o Check Run.
7. As portas do ledger são separadas por capacidade (`FeedbackLedger`,
   `FindingLifecycleLedger`, `CiEvidenceLedger`, `RunTelemetryLedger`); casos de
   uso não descobrem em runtime métodos opcionais de uma interface superset.

## Consequências

### Positivas

- Feedback e review original compartilham uma única verdade durável.
- Reviews parciais não encerram findings que não puderam ser reavaliados.
- Redelivery deixa de duplicar eventos, respostas e mudanças de estado.
- A autorização não depende de campos ausentes no webhook de thread.

### Negativas e limites

- Runs anteriores à migração não têm snapshot; seu feedback não recalcula Check
  Run até uma nova review criar o estado canônico.
- A mutação do GitHub continua externa à transação SQLite. O marcador e o ID
  persistido fornecem reconciliação, não atomicidade distribuída.

## Alternativas rejeitadas

- Reconstruir o estado consultando todos os comentários e Check Runs do ref:
  adiciona paginação, corrida e outra fonte de verdade.
- Usar confiança padrão alta: transforma ausência de dados em certeza e pode
  bloquear PR incorretamente.
- Autorizar thread por `sender.author_association`: esse campo não pertence ao
  payload do evento adotado.

## Confirmação

- Teste de lifecycle preserva finding ausente quando o shard falha.
- Teste do ledger prova aplicação única por delivery ID e retorno do snapshot.
- Testes do handler provam head/Check Run persistidos e consulta de permissão.
- Teste de feedback prova que confiança e escopo parciais são preservados.
