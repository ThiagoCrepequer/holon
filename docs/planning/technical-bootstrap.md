---
id: PLAN-BOOTSTRAP-001
kind: planning
status: current
owners:
  - core-team
last-reviewed: 2026-08-31
related:
  - ../decisions/0002-adopt-typescript-monorepo-toolchain.md
  - ../decisions/0003-adopt-initial-typescript-application-stack.md
  - ../architecture/technical-ecosystem.md
---

# Estado do bootstrap técnico

O bootstrap foi executado em 2026-08-29. Esta página registra o resultado e
separa o que foi provado localmente do que ainda depende de ambiente remoto.

## Etapa 1 — Fundação do workspace — concluída

- Criar manifesto raiz privado e fixar Node.js 24 LTS e uma versao exata de pnpm.
- Criar `pnpm-workspace.yaml` para `apps/*`, `packages/*` e `tooling/*`.
- Adicionar catalogs para dependencias compartilhadas e rejeitar ciclos.
- Criar `turbo.json` somente com tarefas realmente existentes.
- Configurar Oxfmt, Oxlint type-aware e bases TypeScript 7.
- Criar `.gitignore` para dependencias, caches, coverage, artefatos Wrangler e
  secrets locais.

Saida: instalacao limpa e comandos raiz de formatacao, lint e typecheck.

## Etapa 2 — Pacotes puros — concluída

- Criar `domain`, `application`, `contracts` e `test-kit`.
- Definir `ReviewRunIdentity`, estados e portas sem SDK externo.
- Criar schema versionado do envelope `ReviewRequestedV1`.
- Adicionar testes de identidade, transicoes e validacao de envelope.
- Provar que ciclos e importacoes de adapter para dominio falham na verificacao.

Saida: contratos centrais executaveis sem Cloudflare, GitHub ou modelo.

## Etapa 3 — Control plane mínimo — concluída

- Criar `apps/control-plane` e seu `wrangler.jsonc` sem IDs ou secrets reais.
- Gerar tipos de bindings com Wrangler.
- Adicionar Hono com healthcheck e rota de webhook.
- Verificar HMAC sobre body bruto e mapear o payload para o envelope.
- Adicionar producer e consumer da Queue no mesmo modulo.
- Testar handlers com `@cloudflare/vitest-plugin` e bindings locais.

Saida: webhook valido chega ao consumer; payload invalido nao e enfileirado.

## Etapa 4 — Adapters e composição local — concluída

- Criar adapters `github`, `model` e `repository-analysis` com fakes primeiro.
- Encapsular Octokit, AI SDK e parser de diff nas fronteiras definidas.
- Implementar um caso de uso one-shot com ledger em memoria apenas para testes.
- Provar budgets, saida invalida do modelo e reconciliacao de head SHA.

Saida: fluxo local completo sem publicar nem executar codigo de repositorio.

## Etapa 5 — Spikes e decisões — concluída localmente

- Workflows e Durable Object SQLite foram exercitados no Workerd oficial.
- O Sandbox `@next` foi fixado na mesma versão da imagem base.
- O Dockerfile foi construído com sucesso em dry-run do Wrangler.
- `rg` e `ast-grep run` foram executados dentro da imagem contra fixture
  TypeScript; esse smoke detectou e corrigiu o uso incompatível de `scan`.
- Checkpoints granulares, ownership e replay idempotente foram exercitados em
  Workerd.
- ADR-0004 a ADR-0006 registram as escolhas resultantes.

Saida: tecnologias candidatas resolvidas por evidencia.

## Etapa 6 — Integração controlada — parcialmente comprovada

- Registrar um GitHub App de desenvolvimento com menor privilégio.
- Criar recursos Cloudflare e configurar secrets fora do código.
- Executar o corpus e publicação em repositório de teste.
- Medir rate limits, latência, custo e política de retenção reais.

Saida: primeiro vertical slice auditavel em ambiente de desenvolvimento.

Estado em 2026-08-31: GitHub App, Workflow, preparação remota, análise e
publicação foram observados em três smokes públicos. A evidência e suas
limitações estão no
[relatório de smoke remoto](../research/2026-08-31-live-github-app-review-smoke.md).
Repositório privado, redelivery, force-push concorrente, múltiplos findings,
rate limits, custo e retenção continuam pendentes.

## Criterios globais de aceite

- Nenhum segredo ou ID real e versionado.
- `domain` nao tem dependencia de runtime externo.
- Todos os payloads externos sao validados em runtime.
- Tarefas com efeitos externos nao usam cache.
- O mesmo delivery, run e finding nao produzem efeitos duplicados nos testes.
- Outputs normais de Workflow permanecem abaixo de 1 MiB; contexto grande fica
  efêmero no Sandbox.
- A documentação é atualizada quando uma candidata se torna selecionada.
- Validação local e dry-run são descritos com seus limites, sem alegar deploy.
