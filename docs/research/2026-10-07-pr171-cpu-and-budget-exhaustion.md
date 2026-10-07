---
id: RESEARCH-PR171-CPU-BUDGET
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-07
---

# PR #171: CPU do coordenador e admissão após recusa de orçamento

Investigação em 2026-10-07 da [review do PR #171](https://github.com/ThiagoCrepequer/holon/pull/171).
O erro terminal foi CPU do Workflow pai; a recusa anterior de orçamento também
amplificou a execução. As consultas remotas foram de leitura. Este ajuste não
inclui deploy, restart de review, mudança de secrets ou aumento do orçamento
do modelo.

## Fatos observados

A run pertence ao head `fda855e7af51825772b21205faf4341598562fe6` e base
`31e5e9a426ce8864261cab9542f265e8b1d0077d`, repositório GitHub `1350973835`, PR 171. O Workflow pai era
`review-ce13ce92db2bf4477325ee76b91e0ba49e7861dd5705adef6beba437d65eadca`.
A versão nativa do Workflow era `6888577c-11f7-4af2-b62d-edcf4c0146b3`; o Worker
da invocação era `5dabee3c-9c28-40c9-af14-e27fa5757c21`, enviado em
2026-10-05T17:54:37Z. Esses IDs são entidades distintas. A versão não tinha
anotação de commit nem override explícito de CPU nos metadados consultados.

| Evidência                  | Resultado                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Início/fim do pai          | 2026-10-06T23:45:42.457Z / 2026-10-06T23:59:15.551Z                                               |
| Plano                      | 50 shards                                                                                         |
| Step interrompido          | `analyze-review-1`, 2026-10-06T23:59:00.172Z a 2026-10-06T23:59:01.094Z                           |
| Erro nativo                | `Worker exceeded CPU time limit.`                                                                 |
| Invocação                  | `0fa586821d786233797102ba6c5faca9`, `outcome=exceededCpu`, `cpuTimeMs=32000`, `wallTimeMs=799044` |
| Shards falhos              | 35; 33 associados a `model.budget_rejected`, dois anteriores com causa interna não determinada    |
| Primeira recusa de entrada | shard 16, 2026-10-06T23:56:47Z; 3.978.667 bytes consumidos, pedido de 87.021, teto de 4.000.000   |
| Cleanup                    | `cleanup_completed`, primeira tentativa, 2026-10-06T23:59:09.476Z                                 |

O step durou menos de um segundo em wall time, mas a invocação permaneceu viva
por aproximadamente 13 minutos. Os 32 segundos não podem ser atribuídos só à
agregação. Não houve perfil de CPU por função. A limpeza concluiu; a mensagem
pública sobre agendamento da limpeza não demonstrava vazamento de Sandbox.
`agent_workflow_failed` isolado não identifica a causa interna dos dois shards
anteriores às recusas.

## Causa verificável no código e correção

`analyzeReview` coalescia leituras simultâneas, mas descartava o contexto/plano
entre ondas. Para 50 shards sem replay, isso permitia 19 leituras completas
(plano, 17 ondas e agregação) e 69 cálculos de digest (plano, ondas, cada shard
e agregação). O snapshot é imutável para a run e pode ser reutilizado na mesma
invocação, conservando os gates de reconstrução e replay.

O novo snapshot inclui contexto validado, plano e digest em memória. Cada onda
verifica presença/lease; reconstrução invalida a memória e exige digest igual
ao planejamento durável. Retomada cria novo snapshot. Nenhum payload integral
é acrescentado ao checkpoint. O evento `review.analysis_context_loaded` permite
observar cargas sem registrar conteúdo privado.

A primeira recusa de inferência persiste `stop_reason` no plano de orçamento,
na transação existente. A migração 22 é aditiva e conserva reservas antigas.
Cada onda consulta esse estado em step durável; não admite novas ondas após a
recusa, aguarda os peers e contabiliza todos os shards não iniciados. Um
checkpoint final cobre recusa na última onda. Settlement pode liberar saída
para peers já admitidos, mas nunca reabre ondas; não há renovação de saldo.
O resultado mantém achados verificados e informa parcialidade e orçamento no
idioma configurado. Infraestrutura/estado inválidos continuam erro terminal.

`limits.cpu_ms=60000` torna explícito o teto do script, com margem acima da
invocação que atingiu o default de 30 segundos. É uma escolha operacional
limitada, acompanhada da remoção de trabalho repetido; não é um percentil medido
nem a prova de que qualquer entrada admitida caberá nesse teto. Os limites do
modelo (64 chamadas, 4.000.000 bytes e 120.000 tokens de saída) permanecem.

## Provas locais e limites

A regressão de 50 shards falhou antes da correção ao tentar a segunda leitura
completa; depois conclui com uma leitura e cobertura 50/50. A regressão de
admissão após recusa iniciava sete shards antes do ajuste; depois admite três,
aguarda os peers e conserva os quatro restantes como falhas explícitas sem
inferência adicional, inclusive após interrupção da agregação e replay.

Os testes exercitam reconstrução com plano igual/divergente, recarga em nova
invocação, preservação de achados, recusa na única onda, explicação nos três
idiomas, falha de ledger, recusa concorrente, eviction, settlement sem apagar a
parada, validação de autoridade e migração repetível sem alterar reservas.
Esses fixtures não fazem inferências reais e não medem CPU/custo de produção.
Os resultados dos gates executados constam na descrição do PR deste ajuste.

Uma validação remota posterior exige artefato implantado e autorização de
operação. Consulte o [runbook de diagnóstico](../operations/review-analysis-diagnostics.md)
para correlacionar versão, CPU, novas ondas, publicação e cleanup. Não houve
smoke remoto do ajuste nesta investigação.

## Fontes primárias verificadas em 2026-10-07

- [Limites de Workflows](https://developers.cloudflare.com/workflows/reference/limits/):
  a tabela usa a expressão por step, mas a seção de configuração define CPU por
  invocação, default de 30 segundos e `limits.cpu_ms` até 300.000; waits de I/O
  não contam como CPU. A métrica nativa da invocação é a evidência deste caso.
- [Regras de Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/):
  persistência de resultados de steps, replay e cuidados com estado em memória.
- Código afetado: `review/review-analysis.ts`, `review/review-services.ts`,
  `ledger/review-generation-budget-store.ts`, `ledger/ledger-object.ts`,
  `ledger/ledger-migrations.ts` e `packages/application/src/aggregate-reviews.ts`.
