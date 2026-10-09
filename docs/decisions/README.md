---
id: DECISIONS-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Decisões

Decisões arquiteturais significativas são registradas em ADRs numerados. O
formato é uma adaptação enxuta de Markdown Architectural Decision Records.

## Registro

A [ADR-0042 — Equilibrar shards e investigação](0042-balance-review-shards-and-investigation-budgets.md)
substitui os limites de particionamento e investigação da ADR-0039, preservando
suas garantias de cobertura, concorrência, replay e publicação.

A [ADR-0040 — Retirar admin e persistência analítica](0040-retire-admin-and-analytical-storage.md)
substitui as disposições de observabilidade própria e console das ADRs 0023/0029
e de retenção administrativa das ADRs 0034/0037. As garantias funcionais continuam
vigentes; os textos anteriores são preservados como histórico.

| ADR                                                                                   | Título                                                                     | Status       | Data       |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------ | ---------- |
| [ADR-0001](0001-adopt-incremental-mvp-architecture.md)                                | Adotar arquitetura incremental para o MVP                                  | `accepted`   | 2026-08-29 |
| [ADR-0002](0002-adopt-typescript-monorepo-toolchain.md)                               | Adotar monorepo TypeScript com pnpm e Turborepo                            | `accepted`   | 2026-08-29 |
| [ADR-0003](0003-adopt-initial-typescript-application-stack.md)                        | Adotar stack TypeScript inicial e um unico control-plane Worker            | `accepted`   | 2026-08-29 |
| [ADR-0004](0004-adopt-workflows-do-ledger-and-sandbox-executor.md)                    | Adotar Workflows, ledger por PR e executor Sandbox isolado                 | `accepted`   | 2026-08-29 |
| [ADR-0005](0005-use-ai-gateway-rest-api-with-ai-sdk.md)                               | Usar a API REST atual do AI Gateway com AI SDK                             | `superseded` | 2026-08-29 |
| [ADR-0006](0006-use-granular-workflow-checkpoints.md)                                 | Usar checkpoints granulares e contexto efêmero no Sandbox                  | `superseded` | 2026-08-29 |
| [ADR-0007](0007-use-ai-gateway-compat-with-byok.md)                                   | Usar AI Gateway Compat com Custom Provider e BYOK                          | `superseded` | 2026-08-30 |
| [ADR-0008](0008-bound-sandbox-lifetime-and-use-virtual-github-egress.md)              | Limitar vida do Sandbox e usar egress GitHub por host virtual              | `accepted`   | 2026-08-30 |
| [ADR-0009](0009-use-provider-specific-ai-gateway-route.md)                            | Usar rota específica do Custom Provider e uma camada de retries            | `superseded` | 2026-08-30 |
| [ADR-0010](0010-use-dynamic-route-for-pr-review.md)                                   | Usar Dynamic Route para selecionar o modelo de PR review                   | `superseded` | 2026-08-30 |
| [ADR-0011](0011-centralize-model-fallback-in-dynamic-route.md)                        | Centralizar fallback de modelo na Dynamic Route                            | `superseded` | 2026-08-30 |
| [ADR-0012](0012-use-canonical-diff-and-bounded-semantic-recovery.md)                  | Usar diff canônico e recuperação semântica limitada                        | `superseded` | 2026-08-30 |
| [ADR-0013](0013-use-tiered-structural-and-textual-review.md)                          | Usar diff canônico, review estrutural JS/TS e textual elegível             | `superseded` | 2026-08-30 |
| [ADR-0014](0014-version-executor-rpc-and-broker-github-credentials.md)                | Versionar RPC e emitir credenciais GitHub por broker                       | `superseded` | 2026-08-30 |
| [ADR-0015](0015-use-causal-admission-and-durable-terminal-cleanup.md)                 | Usar admissão causal e cleanup terminal durável                            | `superseded` | 2026-08-30 |
| [ADR-0016](0016-require-complete-patches-and-host-verifiable-evidence.md)             | Exigir patches completos e evidência verificável pelo host                 | `superseded` | 2026-08-30 |
| [ADR-0017](0017-select-review-output-harness-from-evidence.md)                        | Selecionar harness de saída por avaliação comparativa                      | `superseded` | 2026-08-31 |
| [ADR-0018](0018-adopt-two-phase-decoupled-review-generator.md)                        | Adotar gerador desacoplado em duas fases com gate no host                  | `superseded` | 2026-09-01 |
| [ADR-0019](0019-derive-deterministic-review-verdict-by-policy.md)                     | Derivar veredito determinístico de review por política no host             | `accepted`   | 2026-09-02 |
| [ADR-0020](0020-reconcile-findings-across-commits-with-stable-fingerprints.md)        | Reconciliar findings entre commits via fingerprinting e ciclo              | `superseded` | 2026-09-02 |
| [ADR-0021](0021-capture-human-feedback-and-calibration-signals.md)                    | Capturar feedback humano, comandos de dispensa e calibração                | `accepted`   | 2026-09-02 |
| [ADR-0022](0022-adopt-deterministic-structural-analyzers.md)                          | Adotar analisadores estruturais determinísticos em duas camadas            | `superseded` | 2026-09-03 |
| [ADR-0023](0023-adopt-cloudflare-native-operational-reliability-and-observability.md) | Adotar confiabilidade operacional e observabilidade nativa Cloudflare      | `accepted`   | 2026-09-03 |
| [ADR-0024](0024-persist-canonical-review-decision-for-feedback.md)                    | Persistir a decisão canônica da review para feedback                       | `accepted`   | 2026-09-03 |
| [ADR-0025](0025-bound-structural-analysis-and-promote-verifiable-findings.md)         | Limitar análise estrutural e promover findings verificáveis                | `superseded` | 2026-09-03 |
| [ADR-0026](0026-centralize-github-app-keyring-and-enable-zero-downtime-rotation.md)   | Centralizar keyring do GitHub App e habilitar rotação de chave             | `superseded` | 2026-09-03 |
| [ADR-0027](0027-actively-supersede-obsolete-review-workflows.md)                      | Cancelar ativamente Workflows de review causalmente obsoletos              | `accepted`   | 2026-09-03 |
| [ADR-0028](0028-adopt-declarative-repository-policy.md)                               | Adotar configuração declarativa por repositório com ancoragem na base      | `superseded` | 2026-09-03 |
| [ADR-0029](0029-adopt-internal-operational-console-and-d1-read-model.md)              | Adotar console operacional interno com read model D1 e projeção assíncrona | `superseded` | 2026-09-04 |

| [ADR-0030](0030-identify-project-versions-from-snapshot-evidence.md) | Identificar versões por projeto com evidências do snapshot | `superseded` | 2026-09-05 |

## Regras

- Use o próximo número sequencial e um nome em kebab-case.
- Uma decisão aceita não é apagada nem silenciosamente reescrita.
- Uma mudança cria outro ADR com `supersedes` e marca o anterior como
  `superseded`.
- Opções rejeitadas e consequências negativas são parte obrigatória da decisão.
- Critérios de confirmação dizem como verificar se a decisão funcionou.
- Use [o template de ADR](../templates/decision.md).

- [ADR-0031 — Identificação de versões como comportamento padrão](0031-always-identify-project-versions.md)

- [ADR-0032 — Exigir contratos RPC atuais](0032-require-current-rpc-contracts.md) — substituída pela ADR-0035.

- [ADR-0033 — Investigar sinais estruturais e preservar saída](0033-investigate-structural-leads-and-preserve-review-output.md)

- [ADR-0034 — Checkpoints duráveis e revalidação conservadora](0034-make-review-checkpoints-and-revalidation-durable.md)

- [ADR-0035 — Planejar o contexto completo antes dos limites de shards](0035-plan-complete-context-before-sharding.md)

- [ADR-0036 — Manter um único contrato atual durante o desenvolvimento](0036-use-single-current-development-contracts.md) — decisão vigente para contratos internos.

- [ADR-0037 — Compilar configuração imutável por execução](0037-compile-repository-configuration-per-run.md) — decisão vigente para autoridade, snapshots, identidade head/base e apresentação.

- [ADR-0038 — Análise paralela e publicação durável](0038-harden-parallel-review-and-publication.md) — decisão vigente para concorrência, recuperação, CI e contexto complementar.

- [ADR-0039 — Particionar reviews grandes e limitar concorrência](0039-partition-large-reviews-and-bound-concurrency.md) — substitui o planejamento/agendamento da ADR-0038; preserva suas outras garantias.

- [ADR-0043 — Coordenar investigação, cancelamento e ciclo do Sandbox](0043-bound-investigation-and-sandbox-lifecycle.md) — substitui a política de investigação da ADR-0042.

- [ADR-0044 — Acompanhar cobertura e encerrar investigação por checkpoint](0044-track-review-investigation-progress.md) — complementa a ADR-0043, com cache por intervalo e métricas de eficiência.

- [ADR-0045 — Exigir progresso e limitar o gasto agregado](0045-bound-review-generation-expenditure.md) — substitui a ADR-0044 quanto à cadência, encerramento e escopo do cache.

- [ADR-0046 — Proteger conclusão por shard e reproduzir incidentes localmente](0046-protect-shard-completion-and-local-replay.md) — substitui a admissão compartilhada e o tratamento de checkpoints rejeitados da ADR-0045.

- [ADR-0047 — Proteger o caminho normal de deploy](0047-guard-coordinated-deployments.md) — `superseded` pela ADR-0048; ferramenta manual preservada como opção.

- [ADR-0048 — Restaurar deploy automático dos Workers](0048-restore-automatic-worker-deployments.md) — substitui o bloqueio obrigatório da ADR-0047; guarda preservada como ferramenta manual opcional.

- [ADR-0049 — Usar Agents SDK e Think na revisão](0049-use-cloudflare-think-for-pr-review.md) — substitui o motor próprio das ADRs 0018 e 0046; preserva um teto agregado por run e a validação causal.

- [ADR-0050 — Verificar causalidade antes da publicação](0050-verify-finding-causality-before-publication.md) — complementa a ADR-0049 com uma conversa isolada para confirmar ou refutar candidatos e um gate determinístico no host.

- [ADR-0051 — Aprender regras do repositório com aprovação de mantenedor](0051-learn-repository-rules-with-maintainer-approval.md): memória funcional, outbox e snapshots por run.

- [ADR-0052 — Responder perguntas sobre findings](0052-answer-finding-questions-in-pr-threads.md) — investigação limitada na discussão inline, correção auditável e publicação idempotente.

- [ADR-0053 — Alinhar admissão de shards ao orçamento de geração](0053-align-review-admission-with-generation-budget.md) — admissão e quotas substituídas pela ADR-0055; causas duráveis de falha preservadas.

- [ADR-0054 — Estabelecer as fundações do dashboard dos usuários](0054-establish-user-dashboard-foundations.md) — SSR/API, UI, persistência por autoridade, email privado e gates locais.

- [ADR-0055 — Financiar reviews grandes com investigação protegida](0055-fund-large-reviews-with-protected-investigation.md) — perfis, quotas, empréstimo após checkpoint e verificações de contrato entre partes.

- [ADR-0056 — Preservar evidência e agendar análise em lanes estáveis](0056-preserve-review-evidence-and-schedule-stable-lanes.md) — evidência, cache, receipts e lanes; regras de orçamento compostas com a ADR-0055 pela ADR-0059.

- [ADR-0057 — Rastrear declarações cujo corpo mudou no HEAD verificado](0057-trace-edited-declarations-in-verified-head.md).

- [ADR-0058 — Selecionar receipts do host nos assessments causais](0058-select-host-evidence-receipts-in-causal-assessments.md).

- [ADR-0059 — Compor lanes estáveis com perfis de orçamento](0059-compose-stable-review-lanes-with-budget-profiles.md) — conserva as decisões de orçamento da main e libera saldo somente após checkpoint.
