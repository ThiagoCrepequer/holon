---
id: ADR-0059
kind: decision
status: accepted
date: 2026-10-09
owners: [core-team]
related:
  - 0055-fund-large-reviews-with-protected-investigation.md
  - 0056-preserve-review-evidence-and-schedule-stable-lanes.md
---

# Compor lanes estáveis com perfis de orçamento

## Contexto

A integração da revisão do core encontrou duas decisões concorrentes: a
ADR-0055 já incorporada à `main` financia até 64 partes; a decisão sobre lanes
foi escrita sobre o limite anterior de nove partes e quotas iguais. As decisões
locais receberam os IDs 0056–0058 para preservar o ID publicado da ADR-0055.
Os registros e snapshots dos benchmarks anteriores permanecem históricos.

## Decisão

Esta decisão substitui somente as afirmações da ADR-0056 sobre admissão de nove
partes, teto único, proteção por `floor(96/(2*N))`, tabela `review_tool_plans` e
ausência de quotas ponderadas/empréstimo. Para essas regras prevalece a
ADR-0055, incluindo sua migração 23; a tabela da proposta concorrente não integra
o contrato persistido atual. Não zerar consumo nem adicionar um segundo contrato.

As garantias de evidência, cache, receipts, publicação e lanes da ADR-0056
continuam vigentes. O planejamento sela os perfis e pesos antes das inferências
e persiste a assignment de até três lanes para todas as partes admitidas. Cada
lane conclui uma parte antes de iniciar a próxima. O resultado de
`analyze-shard-N` precisa estar persistido antes de
`completeReviewBudgetShard` liberar a sobra. Essa conclusão é idempotente e é
repetida após restauração do checkpoint para fechar uma possível interrupção
entre resultado e liberação. Falha de infraestrutura não libera saldo de trabalho
sem resultado persistido. Reservas de custo incerto permanecem cobradas.

Um arquivo só permite resolução de findings anteriores quando todas as suas
partes necessárias, inclusive checks de contrato, concluíram sem degradação.
Duplicação de janelas não aumenta a contagem de linhas selecionadas.

## Confirmação e limites

Os checks locais devem conservar os testes de perfis, proteção de peers, dívida
anterior, eviction e replay da ADR-0055, junto com fragmentação, lanes e receipts.
Os ciclos de nove partes usam os caps atuais de investigação, causalidade e
recuperação. Contexto/digest e join de todas as lanes mantêm suas garantias.

Os benchmarks Gemma anteriores validam suas fontes e limites registrados; não
comprovam o ganho real dos perfis maiores nem desta composição. Não houve nova
chamada paga, deploy, alteração de rota ou recurso remoto nessa integração.
