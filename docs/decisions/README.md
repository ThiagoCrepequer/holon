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

| ADR                                                                      | Título                                                          | Status       | Data       |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------ | ---------- |
| [ADR-0001](0001-adopt-incremental-mvp-architecture.md)                   | Adotar arquitetura incremental para o MVP                       | `accepted`   | 2026-08-29 |
| [ADR-0002](0002-adopt-typescript-monorepo-toolchain.md)                  | Adotar monorepo TypeScript com pnpm e Turborepo                 | `accepted`   | 2026-08-29 |
| [ADR-0003](0003-adopt-initial-typescript-application-stack.md)           | Adotar stack TypeScript inicial e um unico control-plane Worker | `accepted`   | 2026-08-29 |
| [ADR-0004](0004-adopt-workflows-do-ledger-and-sandbox-executor.md)       | Adotar Workflows, ledger por PR e executor Sandbox isolado      | `accepted`   | 2026-08-29 |
| [ADR-0005](0005-use-ai-gateway-rest-api-with-ai-sdk.md)                  | Usar a API REST atual do AI Gateway com AI SDK                  | `superseded` | 2026-08-29 |
| [ADR-0006](0006-use-granular-workflow-checkpoints.md)                    | Usar checkpoints granulares e contexto efêmero no Sandbox       | `accepted`   | 2026-08-29 |
| [ADR-0007](0007-use-ai-gateway-compat-with-byok.md)                      | Usar AI Gateway Compat com Custom Provider e BYOK               | `accepted`   | 2026-08-30 |
| [ADR-0008](0008-bound-sandbox-lifetime-and-use-virtual-github-egress.md) | Limitar vida do Sandbox e usar egress GitHub por host virtual   | `accepted`   | 2026-08-30 |

## Regras

- Use o próximo número sequencial e um nome em kebab-case.
- Uma decisão aceita não é apagada nem silenciosamente reescrita.
- Uma mudança cria outro ADR com `supersedes` e marca o anterior como
  `superseded`.
- Opções rejeitadas e consequências negativas são parte obrigatória da decisão.
- Critérios de confirmação dizem como verificar se a decisão funcionou.
- Use [o template de ADR](../templates/decision.md).
