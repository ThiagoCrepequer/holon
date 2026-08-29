---
id: RESEARCH-2026-08-29-TS-MONOREPO
kind: research
status: current
date: 2026-08-29
verified-at: 2026-08-29
owners:
  - core-team
related:
  - ../decisions/0002-adopt-typescript-monorepo-toolchain.md
  - ../decisions/0003-adopt-initial-typescript-application-stack.md
---

# Ecossistema TypeScript e monorepo

## Pergunta

Qual conjunto inicial de runtime, package manager, orquestrador, ferramentas de
qualidade e bibliotecas reduz complexidade para o MVP sem acoplar o dominio a
Cloudflare, GitHub ou a um provedor de modelo?

## Resumo dos achados

### Fatos confirmados

- Node.js 24 esta em LTS; Node.js 26 ainda esta na linha Current. A propria
  politica do projeto Node recomenda linhas LTS para aplicacoes de producao.
- TypeScript 7 esta estavel e usa o novo compilador nativo. O release tambem
  tornou `strict` o padrao, mas configuracoes importantes continuarao explicitas
  no repositorio para nao depender de defaults mutaveis.
- pnpm oferece workspaces nativos. O protocolo `workspace:` impede que uma
  dependencia interna seja silenciosamente resolvida no registry, e catalogs
  centralizam versoes repetidas.
- Turborepo usa o grafo de pacotes produzido pelo package manager e acrescenta
  um grafo de tarefas. O cache pressupoe tarefas deterministicas; remote cache e
  opcional.
- Oxlint suporta lint type-aware sobre TypeScript 7, inclusive regras de
  promises, mas sua cobertura ainda nao e completa. O modo `typeCheck` continua
  experimental.
- Oxfmt oferece workflow compativel com Prettier para TypeScript, JSON, JSONC,
  YAML e Markdown, com algumas limitacoes documentadas para plugins.
- Cloudflare recomenda gerar tipos de runtime e bindings com `wrangler types`.
  Desde agosto de 2026, a integracao recomendada com Vitest e
  `@cloudflare/vitest-plugin`, que substitui o pool anterior.
- Um Worker pode expor handlers `fetch` e `queue` no mesmo script. Workflows pode
  ser definido no projeto que o aciona ou em outro script por binding.
- A integracao documentada entre AI Gateway e AI SDK usa
  `ai-gateway-provider`. AI SDK aceita Zod ou JSON Schema para tool calls e
  outputs estruturados.
- A API atual de comentarios de review do GitHub prefere `line`, `side`,
  `start_line` e `start_side`; `position` esta em processo de encerramento.

### Inferencias para Holon

- pnpm e o fundamento do workspace; Turborepo deve permanecer uma camada fina
  de execucao, e nao uma fonte paralela de metadados de pacotes.
- O monorepo inicial tera poucos deployables, mas varias bibliotecas com
  typecheck e testes independentes. Adotar Turborepo no bootstrap evita trocar o
  contrato de comandos quando esse grafo crescer.
- `tsc --noEmit` deve continuar sendo a autoridade de tipos. Oxlint sera usado
  para regras semanticas e nao como substituto do compilador.
- Bibliotecas internas podem inicialmente exportar TypeScript diretamente,
  porque Wrangler e Vitest entendem esse formato. Uma etapa de compilacao so
  deve ser criada para pacote publicado ou consumidor que exija JavaScript.
- O primeiro deploy pode reunir webhook, Queue consumer e Workflow definition.
  Separar esses handlers antes de uma necessidade operacional criaria bindings,
  secrets e pipelines adicionais sem isolamento relevante.

## Opcoes comparadas

| Area             | Escolha recomendada   | Alternativas avaliadas           | Motivo principal                            |
| ---------------- | --------------------- | -------------------------------- | ------------------------------------------- |
| Runtime local/CI | Node.js 24 LTS        | Node.js 26 Current               | Estabilidade e suporte LTS                  |
| Linguagem        | TypeScript 7, ESM     | TypeScript 6                     | Projeto novo e toolchain nativa             |
| Workspace        | pnpm workspaces       | npm ou Yarn workspaces           | `workspace:`, catalogs e lockfile unico     |
| Task runner      | Turborepo enxuto      | pnpm recursivo ou Nx             | Grafo e cache com baixa intrusao            |
| Formatter        | Oxfmt                 | Prettier ou Biome                | Compatibilidade ampla e toolchain TS 7      |
| Linter           | Oxlint type-aware     | ESLint + typescript-eslint       | Velocidade e regras relevantes ao backend   |
| Typecheck        | `tsc --noEmit`        | typecheck experimental do Oxlint | Diagnostico oficial e estavel               |
| Testes           | Vitest                | Node test runner ou Jest         | Integracao oficial atual com Workers        |
| Router HTTP      | Hono na borda         | Fetch manual ou framework Node   | Web Standards e integracao Workers          |
| Validacao        | Zod 4                 | validacao manual ou Valibot      | Schemas compartilhados com AI SDK           |
| GitHub           | Octokit modular       | Probot                           | Menor acoplamento a middleware Node         |
| LLM              | AI SDK atras de porta | SDK direto de cada provedor      | Tool calling e output estruturado portaveis |

## Riscos e limites

- Oxlint type-aware exige TypeScript 7 e ainda declara cobertura incompleta. Uma
  regra ausente pode justificar ESLint complementar ou substituto, mas somente
  com caso concreto.
- Oxfmt nao implementa todo plugin de Prettier. O MVP nao depende de plugins
  especializados; a decisao deve ser revista se isso mudar.
- Cache incorreto e pior que ausencia de cache. `deploy`, `dev`, migracoes e
  tarefas com efeitos externos nao podem usar cache.
- Cloudflare Sandbox esta em transicao para a API 1.0. A linha de dependencia
  deve ser decidida no spike do executor, nao no bootstrap do control-plane.
- TypeScript 7 e novo. O bootstrap precisa validar Octokit, Wrangler, Vitest,
  AI SDK e Oxc juntos antes de considerar o ecossistema confirmado em codigo.

## Fontes primarias

Verificadas em 2026-08-29:

- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [pnpm workspaces](https://pnpm.io/workspaces)
- [pnpm catalogs](https://pnpm.io/catalogs)
- [Turborepo package and task graphs](https://turborepo.dev/docs/core-concepts/package-and-task-graph)
- [Turborepo caching](https://turborepo.dev/docs/crafting-your-repository/caching)
- [Oxlint](https://oxc.rs/docs/guide/usage/linter)
- [Oxlint type-aware](https://oxc.rs/docs/guide/usage/linter/type-aware.html)
- [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [TypeScript em Workers](https://developers.cloudflare.com/workers/languages/typescript/)
- [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Cloudflare Queues JavaScript API](https://developers.cloudflare.com/queues/configuration/javascript-apis/)
- [Workflows Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)
- [AI Gateway com AI SDK](https://developers.cloudflare.com/ai-gateway/integrations/vercel-ai-sdk/)
- [AI SDK tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [GitHub review comments](https://docs.github.com/en/rest/pulls/comments)
- [Octokit App authentication](https://github.com/octokit/auth-app.js/)
- [Octokit webhook methods](https://github.com/octokit/webhooks-methods.js/)
