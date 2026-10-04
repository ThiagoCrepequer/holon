# Holon

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/assets/logo/holon-lockup-inverse.svg">
  <img src="docs/brand/assets/logo/holon-lockup-primary.svg" alt="Holon — cada mudança, no seu contexto" width="240">
</picture>

Holon e uma plataforma de revisao de Pull Requests por IA, integrada ao GitHub
por meio de um GitHub App e projetada para executar sobre a plataforma
Cloudflare.

O repositorio contem a primeira implementacao executavel do MVP: webhook,
Queue, Workflow, ledger idempotente em Durable Object SQLite, agente Think por
shard, executor isolado com Sandbox, AI Gateway e publicacao pela GitHub REST API. Ela foi
validada localmente e por dry-run; nenhum ambiente remoto foi implantado por
esta documentacao.

## Validacao local

Requisitos: Node.js 24, pnpm 11.24 e Docker compativel para construir a imagem
do executor.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` confere formatacao, lint, tipos, cobertura, bundles Workers e a
imagem do executor sem realizar deploy.

## Comece por aqui

- [Mapa da documentacao](docs/README.md)
- [Escopo do MVP](docs/product/mvp-scope.md)
- [Investigacao de viabilidade](docs/research/2026-08-29-cloudflare-pr-review-feasibility.md)
- [ADR-0001: arquitetura incremental do MVP](docs/decisions/0001-adopt-incremental-mvp-architecture.md)
- [ADR-0002: monorepo TypeScript com pnpm e Turborepo](docs/decisions/0002-adopt-typescript-monorepo-toolchain.md)
- [ADR-0003: stack TypeScript inicial](docs/decisions/0003-adopt-initial-typescript-application-stack.md)
- [ADR-0004: Workflows, ledger e Sandbox](docs/decisions/0004-adopt-workflows-do-ledger-and-sandbox-executor.md)
- [Índice de decisões e status dos ADRs](docs/decisions/README.md)
- [ADR-0049: agente Think para review](docs/decisions/0049-use-cloudflare-think-for-pr-review.md)
- [ADR-0038: análise paralela e publicação](docs/decisions/0038-harden-parallel-review-and-publication.md)
- [Ecossistema tecnico](docs/architecture/technical-ecosystem.md)
- [Guia de engenharia e contexto](docs/engineering/README.md)
- [Identidade, design system e UI Kit](docs/brand/README.md)
- [Skills do projeto](.agents/skills/README.md)
- [Desenvolvimento local](docs/operations/local-development.md)
- [Configuracao do GitHub App](docs/operations/github-app.md)
- [Deploy e operacao](docs/operations/deployment.md)
- [Questoes em aberto](docs/planning/open-questions.md)

Agentes de codigo devem ler [AGENTS.md](AGENTS.md) antes de trabalhar neste
repositorio.
