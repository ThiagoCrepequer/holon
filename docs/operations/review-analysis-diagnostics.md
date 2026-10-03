---
id: OPERATIONS-REVIEW-ANALYSIS-DIAGNOSTICS
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-03
---

# Diagnóstico de análise parcial ou interrompida

Use o `runId` do Check Run ou do marcador da review para correlacionar a
instância de `holon-review-workflow` com os logs de `holon-control-plane`.
`wrangler workflows instances list holon-review-workflow` e
`wrangler workflows instances describe holon-review-workflow <id> --no-step-output`
mostram o histórico de etapas sem imprimir seus resultados privados. O status
`Completed` do Workflow indica que a publicação terminou; consulte o Check Run e
os eventos abaixo para saber se a análise foi completa. `wrangler tail` acompanha
somente eventos novos. Nenhum desses comandos inicia uma nova revisão.

| Evento                                                                   | Pergunta respondida                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.budget_rejected`                                                  | Qual teto agregado recusou a próxima inferência. `rule` indica o primeiro teto na ordem chamadas, entrada, saída; os três campos `*Exceeded` indicam todas as regras que bloquearam a mesma reserva. `*Current`, `*Requested` e `*Limit` são valores numéricos da transação no ledger.                                                    |
| `repository.tool_budget_rejected`                                        | Qual limite de consultas (`shard_calls` ou `run_calls`) bloqueou a ferramenta e quantas reservas já haviam sido feitas.                                                                                                                                                                                                                   |
| `model.phase_failed`                                                     | Fase, tentativa, rodada, motivo, duração, timeout e status HTTP/retryability quando disponíveis. `model_budget_exhausted` deve ser correlacionado com `model.budget_rejected` pelo `runId`.                                                                                                                                               |
| `model.investigation_stopped`                                            | Motivo do encerramento; `rule`, `current` e `limit` mostram a regra de progresso, rodadas, ferramentas ou saída que forçou o fechamento quando aplicável. Para `durable_repository_tool_budget`, consulte `repository.tool_budget_rejected` para o teto e os valores exatos. `model.investigation_progress` fornece contagens por rodada. |
| `review.shard_failed`                                                    | Parte, motivo seguro e, para erro de provider, status HTTP e retryability. Inclui `analysis_deadline` quando uma onda expira antes da inferência.                                                                                                                                                                                         |
| `review.shard_partial`                                                   | Uma razão de degradação ou omissão por evento e parte, com contagem de achados recebidos e verificados quando aplicável.                                                                                                                                                                                                                  |
| `review.analysis_partial`                                                | Escopo final, partes planejadas, analisadas, falhas e degradadas; códigos de omissão do planner. Escopo `complete` ainda pode ter parte degradada.                                                                                                                                                                                        |
| `review.synthesis_failed`                                                | A síntese foi substituída pelo texto seguro de fallback; `errorKind` não contém a mensagem da exceção.                                                                                                                                                                                                                                    |
| `review.analysis_step_failed`, `review.analysis_failed`, `review.failed` | Etapa e fase afetadas ou classe segura do erro terminal. O histórico de retries do Workflow complementa esses eventos.                                                                                                                                                                                                                    |
| `project.identification_partial`                                         | Quantos projetos tiveram identificação parcial; essa limitação não implica, sozinha, falha da revisão.                                                                                                                                                                                                                                    |

Os tetos agregados de revisão são 64 inferências, 4.000.000 bytes de entrada
serializada e 120.000 tokens de saída reservados ou consumidos, compartilhados
por todos os shards, fases e tentativas da run. Uso desconhecido conserva a
reserva máxima. `model.budget_rejected` registra a decisão de admissão, não uma
fatura nem uma medição de tokens efetivamente faturados. Limites de ferramentas
e de tempo possuem eventos separados. Uma rejeição após o deploy desta
instrumentação pode ser atribuída à regra exata; eventos anteriores não podem
ser reconstruídos retroativamente.

Os campos são identificadores, códigos fechados e contagens. Não registrar
prompt, diff, código, resposta do provider, argumento de ferramenta, stack,
mensagem arbitrária ou credencial. Falhas de emissão não alteram admissão,
retries, veredito ou limpeza. Logs são auxiliares ao estado funcional do ledger;
retenção e consulta histórica dependem da configuração e permissões da conta
Cloudflare. Validação local não comprova entrega dos logs remotos.

Implementação: `apps/control-plane/src/review-generation-budget-store.ts`,
`review-tool-budget-store.ts`, `review-analysis.ts`, `review-workflow.ts` e
`packages/model/src/ai-sdk.ts`.
