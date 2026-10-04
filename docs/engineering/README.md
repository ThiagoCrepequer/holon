---
id: ENGINEERING-GUIDE
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Guia de engenharia do Holon

Este é o ponto de entrada para entender **onde uma mudança pertence, quais
contratos deve preservar e como comprová-la**. Serve para todo o monorepo.
Leia o trecho pertinente à tarefa; o guia não substitui código, manifests,
[ADRs aceitos](../decisions/README.md) ou contratos executáveis.

## Fontes e precedência

1. A solicitação atual define objetivo e escopo. O [produto](../product/mvp-scope.md)
   e o [glossário](../glossary.md) definem comportamento e vocabulário.
2. ADRs aceitos registram decisões. [Arquitetura](../architecture/README.md) e
   [contratos](../contracts/README.md) descrevem o desenho vigente; confirme
   ambos no código, nos manifests e nos testes antes de editar.
3. [Operações](../operations/README.md) trazem comandos e limites de ambiente.
   [Pesquisas](../research/README.md) são evidências datadas;
   [planos](../planning/) são propostas, não contratos implementados.
4. Para API externa, confira documentação primária atual, versão no lockfile e
   comportamento em teste. Registre data e fonte junto da conclusão. Uma página
   genérica não prova a combinação específica usada pelo Holon.

## Mapa do repositório

| Local                                                                          | Responsabilidade                                                                       | Onde confirmar                                                                              |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/control-plane`                                                           | Webhook, Queue, Workflow, ledger, composição, feedback e publicação.                   | `src/index.ts`, `src/review-workflow.ts`, `src/ledger-object.ts`, Wrangler e testes do app. |
| `apps/repository-executor`                                                     | Snapshot e ferramentas de leitura sobre Sandbox isolado; política de egress e cleanup. | `src/executor-service.ts`, `src/repository-tools.ts`, Wrangler, Dockerfile e testes.        |
| `packages/domain`                                                              | Identidades, estados e invariantes sem SDK de infraestrutura.                          | `src/index.ts` e testes puros.                                                              |
| `packages/application`                                                         | Casos de uso, portas, agregação, evidência e políticas de publicação.                  | `src/ports.ts`, `src/execute-review.ts` e testes.                                           |
| `packages/contracts`                                                           | Schemas runtime das fronteiras externas e payloads persistidos.                        | `src/index.ts`, schemas, exemplos e testes de rejeição.                                     |
| `packages/github` e `packages/model`                                           | Adapters GitHub e de modelo.                                                           | `package.json`, exports, `src` e testes de contrato/comportamento.                          |
| `packages/repository-analysis`, `repository-config` e `project-identification` | Diff, elegibilidade, configuração e fatos de projetos no snapshot.                     | Entradas `src/index.ts`, [grafo](../architecture/technical-ecosystem.md) e testes.          |
| `packages/evaluation`                                                          | Corpus, recordings, graders e execução de avaliação.                                   | [Runbook de avaliação](../operations/evaluations.md), package scripts e testes.             |
| `packages/test-kit`                                                            | Fixtures e builders usados somente por testes.                                         | `src/index.ts` e imports em testes; não deve virar dependência de produção.                 |
| `tooling/config-cli` e `tooling/typescript`                                    | Comandos locais de configuração e tsconfig compartilhado.                              | `package.json`, `cli.ts`, `schema.ts`, `base.json` e testes.                                |
| `docs` e `.agents/skills`                                                      | Decisões, instruções, pesquisas e métodos de trabalho.                                 | Este índice e [catálogo de skills](../../.agents/skills/README.md).                         |

O [ecossistema técnico](../architecture/technical-ecosystem.md) mostra o grafo
permitido. Os manifests de cada workspace são a fonte para dependências,
exports e scripts concretos. Não crie pacote para uma fronteira que uma subpasta
interna resolveria.

## Encontre o contexto pela mudança

| Se a tarefa envolve…                               | Comece por…                                                                                                                               | Depois confira…                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Veredito, findings ou cobertura                    | [Contrato de qualidade](../product/review-quality-contract.md), [fluxo](../architecture/review-runtime-flow.md)                           | Domínio, aplicação, output schema e corpus de avaliação.                                            |
| Webhook, eventos ou resposta ao GitHub             | [Fronteiras de confiança](../architecture/security-and-trust-boundaries.md), [estado](../architecture/state-and-idempotency.md)           | Handler, publisher, ledger, permissões e testes de redelivery.                                      |
| Queue, Workflow, DO, Sandbox ou modelo             | [Runtime e integrações](runtime-and-integrations.md)                                                                                      | Bindings, contrato de porta/RPC, falhas, retries e testes Workerd.                                  |
| Configuração por repositório ou versões do projeto | [Operação da configuração](../operations/repository-configuration.md), [identificação](../architecture/project-version-identification.md) | Compilador, CLI, schemas, snapshot, digests e testes.                                               |
| Feedback humano, evidência de CI ou publicação     | [Fluxo](../architecture/review-runtime-flow.md), [estado](../architecture/state-and-idempotency.md)                                       | Entrada do evento, ledger, publisher, autorização e comentário reconciliado.                        |
| Código TypeScript ou fronteira de módulo           | [Tipos e módulos](typescript-and-module-design.md)                                                                                        | `tooling/typescript/base.json`, imports e callers reais.                                            |
| Marca, site, LP ou interface                       | [Identidade e design system](../brand/README.md)                                                                                          | Tokens semânticos, assets oficiais, estados, responsividade e [UI Kit](../brand/ui-kit/index.html). |
| Testes, avaliação ou entrega                       | [Testes e evidência](testing-and-evidence.md)                                                                                             | Scripts afetados, [desenvolvimento local](../operations/local-development.md) e runbook remoto.     |
| Secrets, GitHub App ou deploy                      | [Operação](../operations/README.md) e [segurança](../architecture/security-and-trust-boundaries.md)                                       | Ambiente, artefato, permissões, rotação e autorização antes do efeito remoto.                       |
| Incidente ou comportamento histórico               | [Pesquisas](../research/README.md)                                                                                                        | Código/configuração atuais e ADR que governa o estado presente.                                     |

## Fluxo de trabalho

1. Enuncie comportamento e identidade afetada; localize contrato e ADR.
2. Trace produtor, validação, estado, consumidor e efeito externo no código.
3. Escolha uma mudança coesa e uma fronteira observável para testá-la. Consulte
   [tipos e módulos](typescript-and-module-design.md) e
   [testes](testing-and-evidence.md) conforme a tarefa.
4. Valide o caminho permitido e falhas relevantes: entrada inválida, retry,
   concorrência, autoridade, persistência e terminalização quando aplicáveis.
5. Atualize consumidores, testes, arquitetura e operação na mesma entrega.
   Quando uma decisão aceita mudar, escreva outro ADR; preserve o histórico.
6. Relate comandos, resultado e o limite entre prova local, dry-run, smoke
   remoto e comportamento em produção.

A documentação de engenharia contém regras reutilizáveis do projeto. Detalhes
de uma migração ou experimento pertencem ao plano e à pesquisa específicos;
eles só entram aqui quando virarem parte do runtime vigente ou uma regra geral.
