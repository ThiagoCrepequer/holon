# Bancada local das melhorias do core — 2026-10-08

Executar na raiz, com Node do intervalo oficial e dependências instaladas:

```bash
node --import ./packages/evaluation/node_modules/tsx/dist/loader.mjs \
  docs/research/experiments/2026-10-08-review-core-implementation/benchmarks.mts
```

O script grava [results.json](results.json), com versões, amostras, p50/p95,
contagens e equivalência verificada. Não usa provider, GitHub, Docker ou recursos
remotos. O código antes/depois está explícito no script; a auditoria histórica
continua ancorada em `1941a4f`.

| Experimento | Carga e comparação                                                               | O que pode demonstrar                                                     |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Índice      | 800 linhas, 100 batches, 15 rodadas; reparsing versus índice compartilhado       | Custo local e equivalência das verificações canônicas                     |
| Tools       | 96 requests lógicos, 12 consultas únicas, sete rodadas; 1 ms por execução física | Redução de execuções repetidas; não é latência de container real          |
| Scheduling  | Nove tarefas, três slots, pesos 100/10/10 repetidos, 15 rodadas                  | Ociosidade e p95 com timers controlados; bytes podem ser proxy imperfeito |
| Contexto    | Três arquivos, limite de dois por shard, relação explícita produtor/consumidor   | Cobertura da relação pelo planner; não é recall do modelo                 |
| Quotas      | Um envelope de 1 MB e oito de 50 kB, teto de 4 MB                                | Inviabilidade da parcela igual e viabilidade matemática da ponderada      |
| Incremental | Mesma dependência, consumidor alterado e grafo incompleto                        | Política conservadora de invalidação, sem omitir trabalho do runtime      |

O baseline de tools executa cada chamada; a variante compartilha resultados
completos. Ambas retornam a mesma sequência de outputs e recebem 96
solicitações lógicas. A reserva durável é provada nos testes do ledger e na fatia
vertical, não neste timer workload. A carga selecionada contém repetição alta; não extrapolar
87,5% de economia para todo PR.

O timer de leitura mede o trecho compartilhado pelo cache. Ele não contabiliza
revalidação de lease/escopo, RPCs do SDK, checkout nem cleanup; esses custos
permanecem no runtime. A contagem de execuções do exemplo não representa o total
de operações externas de uma revisão.

Ponderação não modifica quotas duráveis nem habilita empréstimo de modelo. O
harness `compareEvaluationSubjects` compara subjects nas mesmas fixtures e
reporta regressões, melhorias e falhas. Não há resultado de diversidade live.

Não declarar equivalência causal, aumento de precisão ou ganho do provider com
essas medições. Holdout sintético e provider controlado permitem verificar o
protocolo; avaliação de qualidade exige casos adjudicados independentemente e
subject Think real em ambiente autorizado.
