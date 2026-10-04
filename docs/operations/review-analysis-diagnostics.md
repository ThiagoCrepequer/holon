---
id: OPERATIONS-REVIEW-ANALYSIS-DIAGNOSTICS
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Diagnóstico de análise parcial ou interrompida

Use o `runId` do Check Run ou do marcador da review para correlacionar a
instância de `holon-review-workflow`, os `ReviewShardWorkflow` e os logs do
`holon-control-plane`. `wrangler workflows instances list` e
`wrangler workflows instances describe <workflow> <id> --no-step-output`
mostram estados e etapas sem imprimir os resultados privados. Um Workflow pai
concluído ainda pode representar análise parcial: confirme o Check Run e os
eventos abaixo. `wrangler tail` acompanha somente eventos novos.

Para um shard, `agent_workflow_failed` significa apenas que o
`ReviewShardWorkflow` terminou com status `errored`. Esse código não distingue
falha do provider, orçamento, tool ou runtime. O ID da instância do shard é
`review-` seguido do SHA-256 hexadecimal de `<runId>:<shardIndex>:<phase>` (índice
começa em zero; fase `investigation` ou `causal_verification`). Para execuções
anteriores à separação das fases, confirme a fórmula no artefato implantado.
Consulte
`wrangler workflows instances describe holon-review-shard-workflow <id> --no-step-output`
e correlacione com os eventos do Agent antes de atribuir uma causa. Evite
imprimir step output ou trace payload em relatórios operacionais: eles podem
conter código privado. Sem acesso à instância ou ao trace, registre a causa
interna como não determinada.

Quando a instância terminar com erro após `review-shard:wait-1`, confira o tipo
do erro e o schema da resposta antes de atribuir a falha ao provider. Na
execução do PR #121 em 2026-10-04, um `ZodError` resultou de `summary` vazio
aceito pelo schema do prompt e rejeitado pelo parser de transporte. A
[API de step do Cloudflare Workflows](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/step/)
(documentação verificada em 2026-10-04) permite consultar a saída integral
quando `wrangler describe` a trunca. Essa saída pode conter código privado:
inspecione em processo, sem imprimir ou persistir payload, e relate somente
estado, etapa e falhas de schema. Veja a
[investigação do PR #121](../research/2026-10-04-pr121-partial-review.md).

Na execução do PR #124 em 2026-10-04, dois candidatos com `evidence: []`
causaram `too_small` em `findings[0].evidence` e `findings[1].evidence` após o
step concluído. A correção descarta candidatos sem evidências válidas e conserva
o shard como degradado, com `evidence_rejected`; não o transforma em análise
limpa. Veja a [investigação do PR #124](../research/2026-10-04-pr124-empty-evidence.md).

| Evento                                                                   | Interpretação                                                                                                                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.budget_rejected`                                                  | O ledger recusou uma inferência pelo teto **agregado da run**. `rule`, `current`, `requested` e `limit` identificam a dimensão; shard e fase ajudam a localizar a chamada. |
| `repository.tool_budget_rejected`                                        | A run alcançou o teto agregado de 96 consultas; `totalCurrent` e `totalLimit` mostram a admissão transacional.                                                             |
| `review.shard_failed`                                                    | O shard falhou ou expirou. `reason` distingue falha do Agent Workflow, deadline e erros classificados do provider.                                                         |
| `review.shard_partial`                                                   | O shard devolveu limitações, contexto omitido, evidência rejeitada ou saída degradada.                                                                                     |
| `review.analysis_partial`                                                | Escopo, partes planejadas, concluídas, falhas e degradadas da revisão.                                                                                                     |
| `review.analysis_step_failed`, `review.analysis_failed`, `review.failed` | Etapa ou run interrompida; correlacione com estado do Workflow e cleanup.                                                                                                  |
| `project.identification_partial`                                         | Identificação parcial de projetos; isoladamente, não determina falha de review.                                                                                            |

Os tetos de modelo são 64 inferências, 4.000.000 bytes de entrada serializada
e 120.000 tokens de saída reservados ou consumidos por run, compartilhados
entre shards. Uso desconhecido conserva a reserva máxima. A decisão de
admissão não mede custo faturado. A [ADR-0049](../decisions/0049-use-cloudflare-think-for-pr-review.md)
substitui a divisão por shard da ADR-0046.

O Agent tracing fica habilitado durante o beta. Com
`AGENT_TRACE_PAYLOADS=enabled`, mensagens e outputs de tools podem conter
trechos do repositório; restrinja acesso e desabilite a captura quando o
usuário solicitar. Os logs estruturados não devem conter prompt, diff,
argumento de ferramenta, resposta integral, stack, erro arbitrário ou
credencial. Falhas de log não alteram admissão, veredito ou cleanup.

Implementação: `apps/control-plane/src/review/review-agent.ts`,
`ledger/review-generation-budget-store.ts`, `ledger/review-tool-budget-store.ts`,
`review/review-analysis.ts` e `review/review-workflow.ts`.
