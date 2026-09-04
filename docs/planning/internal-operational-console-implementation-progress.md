---
id: PLAN-ADMIN-PROGRESS-001
kind: planning
status: current
owners:
  - core-team
last-reviewed: 2026-09-04
related:
  - internal-operational-console-plan.md
  - ../decisions/0029-adopt-internal-operational-console-and-d1-read-model.md
---

# Registro Persistente de Progresso: Console Operacional Interno do Holon

Este documento rastreia o progresso contínuo e verificável da implementação do Console Operacional Interno (`apps/admin`), D1 read model, outbox durável no ledger, Queue consumer, design system `@holon/ui`, dashboard e ferramentas operacionais, conforme definido no plano canônico `docs/planning/internal-operational-console-plan.md`.

## Status Geral por Fase

| Fase       | Descrição                                                                 | Status       | Data de Conclusão |
| :--------- | :------------------------------------------------------------------------ | :----------- | :---------------- |
| **Fase 0** | Preflight, pesquisa datada e ADR-0029                                     | Concluída    | 2026-09-04        |
| **Fase 1** | Contratos e políticas puras                                               | Concluída    | 2026-09-04        |
| **Fase 2** | Skeleton do apps/admin (Worker composto, bindings, migration)             | Concluída    | 2026-09-04        |
| **Fase 3** | D1 e Queue consumer (idempotência, quarentena, retenção, paginação)       | Concluída    | 2026-09-04        |
| **Fase 4** | Control plane: producer, outbox no ledger, alarm multiplexado e RPC V1    | Concluída    | 2026-09-04        |
| **Fase 5** | Design system `@holon/ui` (tokens, componentes, acessibilidade)           | Concluída    | 2026-09-04        |
| **Fase 6** | Rotas e dashboard (SSR React Router, loaders, drawer, visualizações)      | Concluída    | 2026-09-04        |
| **Fase 7** | Segurança e operação (Access JWT, CSP, Analytics/Queue adapters, CLI DLQ) | Concluída    | 2026-09-04        |
| **Fase 8** | Verificação completa e consolidação de qualidade                          | Em andamento | —                 |

---

## Detalhamento de Execução

### Fase 0 — Preflight e decisão arquitetural

- [x] Confirmação de git workspace, branch atual (`feat/declarative-repository-policy`), sem divergências não intencionais.
- [x] Resolução de versões atuais e compatíveis da stack (React 19, React Router v8, Tailwind CSS v4, Base UI, Recharts, Jose).
- [x] Criação da pesquisa datada com fontes primárias (`docs/research/2026-09-04-internal-operational-console-toolchain.md`).
- [x] Redação do ADR-0029 (`docs/decisions/0029-adopt-internal-operational-console-and-d1-read-model.md`).
- [x] Atualização de índices e documentação arquitetural e operacional.

### Fase 1 — Contratos e políticas puras

- [x] Implementação de `packages/contracts/src/admin-projection.ts` (evento V1, payload, reviewPhaseReached, validação temporal).
- [x] Implementação de serialização RFC 8785 e canonical payload hash (`buildAdminProjectionEventV1`).
- [x] Implementação de `packages/contracts/src/admin-run-detail.ts` (DTO de detalhe read-only V1).
- [x] Implementação de cursor keyset HMAC-SHA-256 e keyring rotation (`packages/contracts/src/admin-cursor.ts`).
- [x] Exportações em `packages/contracts/src/index.ts`.
- [x] Testes unitários puros com vetores fixos, Unicode e bordas.

### Fase 2 — Skeleton do apps/admin

- [x] Configuração do workspace `apps/admin` e integração ao pnpm-workspace / turbo.
- [x] Composição de handlers em `apps/admin/workers/app.ts` (`fetch`, `queue`, `scheduled`).
- [x] Configuração de `wrangler.jsonc` com D1, Queues, Service Binding `ADMIN_READ_API`, custom domain com `workers_dev: false` e `preview_urls: false`.
- [x] Migration D1 `apps/admin/migrations/0001_initial_admin_read_model.sql` (`admin_runs`, `admin_metadata`, `admin_projection_quarantine`).
- [x] Testes de integração de coexistência de handlers e validação de types.

### Fase 3 — D1 e Queue consumer

- [x] Implementação do adaptador D1 em `apps/admin`.
- [x] Consumidor de Queue com idempotência estrita (`ON CONFLICT(run_id) DO NOTHING` e detecção de conflitos de payload).
- [x] Mecanismo de quarentena segura (`admin_projection_quarantine`) sem gravação de payload bruto.
- [x] Paginação keyset, busca estruturada e query builder seguro (bind parameters).
- [x] Handler `scheduled` para retenção temporal bounded em D1 (180 dias runs, 30 dias quarentena).
- [x] Suíte de testes com `@cloudflare/vitest-plugin`.

### Fase 4 — Control plane producer, outbox e RPC

- [x] Binding `ADMIN_PROJECTION_QUEUE` em `apps/control-plane`.
- [x] Schema SQLite de `projection_tasks` no `ReviewLedgerObject`.
- [x] Multiplexação do scheduler de `alarm()` (prioridade absoluta para cleanup, lease de 2min, backoff exponencial, estado `exhausted`).
- [x] Pipeline de finalização do Workflow: gravação de task outbox antes do send, retry explícito, marcação de conclusão sem impactar outcome da review.
- [x] Implementação de `AdminReadEntrypoint` no control plane e método `getSanitizedAdminRunDetailV1` no ledger.
- [x] Sanitização defensiva allowlisted e estruturação de resumo CI sem expor dados não confiáveis.
- [x] Testes no control plane com falhas injetadas de Queue provando isolamento da review.

### Fase 5 — Design system `@holon/ui`

- [x] Criação do workspace `packages/ui`.
- [x] Tokens semânticos e folha de estilos `theme.css`.
- [x] Componentes: button, icon-button, badge, card, metric-card, dialog, drawer, select, tabs, table, skeleton, empty-state, chart-frame.
- [x] Componentes com contratos de acessibilidade (ARIA, foco, navegação por teclado, reduced motion, tabular-nums).
- [x] Testes de componentes com Vitest, Testing Library e Axe, incluindo interação real de foco/fechamento do diálogo.

### Fase 6 — Rotas e dashboard

- [x] Implementação da aplicação React Router em `apps/admin/app`.
- [x] Rota `/`: métricas exatas D1, tendências aproximadas Analytics Engine, distribuição de vereditos, runs recentes, estados de degradação.
- [x] Rota `/runs`: filtros, paginação, busca estruturada, empty states específicos.
- [x] Rota `/runs/:runId`: visualização drawer/page, chamada RPC via Service Binding sob demanda, exibição de telemetria e findings consolidados.
- [x] Equivalentes tabulares/textuais acessíveis para dados gráficos.
- [x] Build SSR/cliente via plugin oficial Cloudflare Vite e React Router, com gráfico carregado em chunk cliente e fallback estável de hidratação.

### Fase 7 — Segurança e operação

- [x] Middleware Cloudflare Access JWT (validação RS256, JWKS com refresh e cache, verificação de audiência e email corporativo).
- [x] Headers de segurança com CSP nonce-based dinâmico por requisição SSR.
- [x] Adaptadores server-side para Cloudflare Analytics Engine SQL API e Queue Metrics API com degradação tolerante.
- [x] Endpoint `/readiness` com probes paralelas.
- [x] CLI de replay DLQ em `tooling/admin-cli/replay-dlq.ts` (`--dry-run` default, sem exibição de corpos de mensagem).
- [x] Validação estrita de respostas externas e RPC, replay com validação de schema/hash e confirmação vinculada ao ambiente e IDs das filas.
- [x] Feature flag `ADMIN_PROJECTION_ENABLED`, watermark de cutover e cron diário de retenção.
- [x] Runbooks operacionais em `docs/operations/`.

### Fase 8 — Verificação completa

- [x] Execução das suítes focadas de control plane, admin, contracts, CLI e design system.
- [x] `pnpm format:check`, `pnpm lint` e `pnpm typecheck` sobre o head corrigido do PR.
- [x] Gates de cobertura dos pacotes alterados: control plane, admin (Workers + cliente), CLI e design system.
- [x] Build de produção SSR/cliente do `apps/admin`.
- [ ] Executar `pnpm verify` global sobre o head final em CI ou ambiente local com suporte completo a Workers/Containers.
- [ ] Executar jornadas Playwright e regressão visual em staging protegido por Access; requer credenciais e autorização explícita para efeito externo.
- [ ] Confirmar o rollout contra conta Cloudflare, GitHub App e repositório privado reais. A implementação permanece localmente verificada até essa prova.
