---
id: DECISIONS-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-08-30
---

# Decisões

Decisões arquiteturais significativas são registradas em ADRs numerados. O
formato é uma adaptação enxuta de Markdown Architectural Decision Records.

## Registro

| ADR                                                                       | Título                                                          | Status       | Data       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------ | ---------- |
| [ADR-0001](0001-adopt-incremental-mvp-architecture.md)                    | Adotar arquitetura incremental para o MVP                       | `accepted`   | 2026-08-29 |
| [ADR-0002](0002-adopt-typescript-monorepo-toolchain.md)                   | Adotar monorepo TypeScript com pnpm e Turborepo                 | `accepted`   | 2026-08-29 |
| [ADR-0003](0003-adopt-initial-typescript-application-stack.md)            | Adotar stack TypeScript inicial e um unico control-plane Worker | `accepted`   | 2026-08-29 |
| [ADR-0004](0004-adopt-workflows-do-ledger-and-sandbox-executor.md)        | Adotar Workflows, ledger por PR e executor Sandbox isolado      | `accepted`   | 2026-08-29 |
| [ADR-0005](0005-use-ai-gateway-rest-api-with-ai-sdk.md)                   | Usar a API REST atual do AI Gateway com AI SDK                  | `superseded` | 2026-08-29 |
| [ADR-0006](0006-use-granular-workflow-checkpoints.md)                     | Usar checkpoints granulares e contexto efêmero no Sandbox       | `accepted`   | 2026-08-29 |
| [ADR-0007](0007-use-ai-gateway-compat-with-byok.md)                       | Usar AI Gateway Compat com Custom Provider e BYOK               | `superseded` | 2026-08-30 |
| [ADR-0008](0008-bound-sandbox-lifetime-and-use-virtual-github-egress.md)  | Limitar vida do Sandbox e usar egress GitHub por host virtual   | `accepted`   | 2026-08-30 |
| [ADR-0009](0009-use-provider-specific-ai-gateway-route.md)                | Usar rota específica do Custom Provider e uma camada de retries | `superseded` | 2026-08-30 |
| [ADR-0010](0010-use-dynamic-route-for-pr-review.md)                       | Usar Dynamic Route para selecionar o modelo de PR review        | `superseded` | 2026-08-30 |
| [ADR-0011](0011-centralize-model-fallback-in-dynamic-route.md)            | Centralizar fallback de modelo na Dynamic Route                 | `superseded` | 2026-08-30 |
| [ADR-0012](0012-use-canonical-diff-and-bounded-semantic-recovery.md)      | Usar diff canônico e recuperação semântica limitada             | `superseded` | 2026-08-30 |
| [ADR-0013](0013-use-tiered-structural-and-textual-review.md)              | Usar diff canônico, review estrutural JS/TS e textual elegível  | `accepted`   | 2026-08-30 |
| [ADR-0014](0014-version-executor-rpc-and-broker-github-credentials.md)    | Versionar RPC e emitir credenciais GitHub por broker            | `accepted`   | 2026-08-30 |
| [ADR-0015](0015-use-causal-admission-and-durable-terminal-cleanup.md)     | Usar admissão causal e cleanup terminal durável                 | `accepted`   | 2026-08-30 |
| [ADR-0016](0016-require-complete-patches-and-host-verifiable-evidence.md) | Exigir patches completos e evidência verificável pelo host      | `accepted`   | 2026-08-30 |
| [ADR-0017](0017-select-review-output-harness-from-evidence.md)            | Selecionar harness de saída por avaliação comparativa           | `proposed`   | 2026-08-31 |

## Regras

- Use o próximo número sequencial e um nome em kebab-case.
- Uma decisão aceita não é apagada nem silenciosamente reescrita.
- Uma mudança cria outro ADR com `supersedes` e marca o anterior como
  `superseded`.
- Opções rejeitadas e consequências negativas são parte obrigatória da decisão.
- Critérios de confirmação dizem como verificar se a decisão funcionou.
- Use [o template de ADR](../templates/decision.md).
