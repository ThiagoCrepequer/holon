# Holon

Holon e uma plataforma de revisao de Pull Requests por IA, integrada ao GitHub
por meio de um GitHub App e projetada para executar sobre a plataforma
Cloudflare.

O repositorio contem a primeira implementacao executavel do MVP: webhook,
Queue, Workflow, ledger idempotente em Durable Object SQLite, executor isolado
com Sandbox, review via AI Gateway e publicacao pela GitHub REST API. Ela foi
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
- [ADR-0005: AI Gateway e AI SDK](docs/decisions/0005-use-ai-gateway-rest-api-with-ai-sdk.md)
- [ADR-0006: checkpoints granulares do Workflow](docs/decisions/0006-use-granular-workflow-checkpoints.md)
- [Ecossistema tecnico](docs/architecture/technical-ecosystem.md)
- [Desenvolvimento local](docs/operations/local-development.md)
- [Configuracao do GitHub App](docs/operations/github-app.md)
- [Deploy e operacao](docs/operations/deployment.md)
- [Questoes em aberto](docs/planning/open-questions.md)

Agentes de codigo devem ler [AGENTS.md](AGENTS.md) antes de trabalhar neste
repositorio.
