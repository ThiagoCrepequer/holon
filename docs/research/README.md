---
id: RESEARCH-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-10-05
---

# Investigacoes

Investigacoes sao snapshots datados. Elas registram o que era verificavel na
data de corte, quais afirmacoes foram corrigidas e quais duvidas permaneceram.
Nao criam uma decisao por si so.

## Relatorios

- [Viabilidade da plataforma Cloudflare para review de PRs](2026-08-29-cloudflare-pr-review-feasibility.md)
- [Ecossistema TypeScript e monorepo](2026-08-29-typescript-monorepo-toolchain.md)
- [Incidente de egress e retries do Sandbox](2026-08-30-sandbox-egress-and-retry-incident.md)
- [Incidente de path e retries do AI Gateway](2026-08-30-ai-gateway-provider-path-incident.md)
- [Incidente de conclusão do review agentivo](2026-08-30-agentic-review-completion-incident.md)
- [Incidente de output truncado e replay da sessão agentiva](2026-08-30-model-output-and-retry-incident.md)
- [Incidente de diff divergente e output semântico ausente](2026-08-30-canonical-diff-and-semantic-output-incident.md)
- [Smoke remoto do fluxo de review do GitHub App](2026-08-31-live-github-app-review-smoke.md)
- [Toolchain e arquitetura do Console Operacional Interno](2026-09-04-internal-operational-console-toolchain.md)
- [Confiabilidade do core de review](2026-09-08-review-core-reliability.md)
- [Omissão de contexto antes do planejamento](2026-09-08-context-budget-omission.md)
- [Configuração e schema para editores](2026-09-09-repository-configuration-and-editor-schema.md)
- [Arquitetura e estado da arte para serviço de busca de documentação](2026-09-10-technical-documentation-retrieval-service.md)

- [PR #99: rollout do Sandbox e amplificação da falha](2026-09-28-review-99-rollout-and-failure-amplification.md)
- [Exemplos e runtime de Cloudflare Agents para o review](2026-10-03-cloudflare-agents-examples-and-runtime-audit.md)
- [PR #121: review parcial e formato do feedback](2026-10-04-pr121-partial-review.md)
- [PR #124: candidatos sem evidência interromperam o shard](2026-10-04-pr124-empty-evidence.md)
- [PR #125: Workflows concluídos com resumo ausente](2026-10-04-pr125-missing-summary.md)

- [Coletânea de bibliotecas para o dashboard dos usuários](2026-10-04-dashboard-library-landscape.md)
- [Referências de UI e movimento para o dashboard](2026-10-04-dashboard-ui-motion-references.md)
- [Autenticação do dashboard: descoberta, políticas acordadas e histórico](2026-10-04-dashboard-authentication-discovery.md)
- [Autenticação e persistência: adapter D1, tenancy e provas restantes](2026-10-04-dashboard-auth-persistence-investigation.md)
- [Leitura, autorização GitHub e experimento de busca/índices](2026-10-04-dashboard-read-model-investigation.md)
- [Entrega de emails: outbox, Queue, recuperação e limite de idempotência](2026-10-04-dashboard-email-delivery-investigation.md)
- [Revisão de robustez do planejamento: achados, ajustes e gates](2026-10-04-dashboard-plan-robustness-review.md)
- [Plugin GitHub: reserva atômica de code, retenção e limites](2026-10-05-dashboard-code-redemption-plugin.md)
- [Milestone 0: resultados e limites das provas executáveis](2026-10-05-dashboard-milestone-zero-results.md)
- [Prova Workerd/D1 de autenticação: linking verificado e gate concorrente](2026-10-05-dashboard-auth-proof.md)
- [OAuth: avaliação normativa de PKCE, CSRF e não reutilização de code](2026-10-05-dashboard-oauth-security-requirements.md)
- [Prova Router/Hono/Query, i18n e CSP no build real](2026-10-05-dashboard-browser-proof.md)
- [Prova SQLite DO de transação, obrigação e alarm](2026-10-05-dashboard-ledger-proof.md)

Para implementar o dashboard, comece pelo [plano consolidado](../planning/dashboard-implementation-plan.md).
As seções datadas das pesquisas preservam a evolução do entendimento; os
ajustes de robustez atuais delimitam o que está comprovado e o que ainda é gate.

## Politica de manutencao

- Preserve a conclusao original.
- Adicione erratas datadas quando uma API mudar ou uma fonte for corrigida.
- Promova uma conclusao para ADR quando ela resultar em escolha normativa.
- Use prioritariamente documentacao oficial, schemas publicados e testes
  reproduziveis.
