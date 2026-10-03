---
id: DOCS-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-10-03
---

# Mapa da documentacao

Este arquivo e o ponto de entrada canonico para humanos e agentes. A
documentacao distingue deliberadamente evidencias historicas, decisoes
normativas, arquitetura pretendida e planejamento ainda nao aprovado.

## Caminhos de leitura

| Objetivo                                     | Leia primeiro                                                                     | Continue em                                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entender o produto                           | [Visao](product/vision.md)                                                        | [Escopo do MVP](product/mvp-scope.md)                                                                                                                                                 |
| Entender o que foi decidido                  | [Indice de decisoes](decisions/README.md)                                         | [Registro completo de ADRs](decisions/README.md#registro)                                                                                                                             |
| Auditar afirmacoes sobre Cloudflare e GitHub | [Investigacoes](research/README.md)                                               | [Relatorio de viabilidade](research/2026-08-29-cloudflare-pr-review-feasibility.md)                                                                                                   |
| Entender o desenho do sistema                | [Arquitetura](architecture/README.md)                                             | [Contexto](architecture/system-context.md) e [containers](architecture/container-view.md)                                                                                             |
| Entender o ecossistema TypeScript            | [Investigacao do toolchain](research/2026-08-29-typescript-monorepo-toolchain.md) | [Decisao do monorepo](decisions/0002-adopt-typescript-monorepo-toolchain.md) e [fronteiras tecnicas](architecture/technical-ecosystem.md)                                             |
| Encontrar contexto para implementar          | [Guia de engenharia](engineering/README.md)                                       | [TypeScript e módulos](engineering/typescript-and-module-design.md), [runtime e integrações](engineering/runtime-and-integrations.md) e [testes](engineering/testing-and-evidence.md) |
| Implementar o fluxo de review                | [Fluxo de execucao](architecture/review-runtime-flow.md)                          | [Estado e idempotencia](architecture/state-and-idempotency.md)                                                                                                                        |
| Trabalhar com seguranca                      | [Trust boundaries](architecture/security-and-trust-boundaries.md)                 | [Ciclo de vida dos dados](architecture/data-lifecycle.md)                                                                                                                             |
| Desenvolver e operar                         | [Operação](operations/README.md)                                                  | [GitHub App](operations/github-app.md), [deploy](operations/deployment.md) e [avaliações](operations/evaluations.md)                                                                  |
| Planejar a entrega                           | [Plano do MVP](planning/mvp-delivery-plan.md)                                     | [Bootstrap tecnico](planning/technical-bootstrap.md) e [questoes em aberto](planning/open-questions.md)                                                                               |
| Evoluir o core de review                     | [Roadmap do core](planning/review-core-evolution-roadmap.md)                      | [Contrato de qualidade](product/review-quality-contract.md) e [fluxo de execucao](architecture/review-runtime-flow.md)                                                                |
| Entender a migração do motor de review       | [ADR-0046](decisions/0046-use-cloudflare-think-for-pr-review.md)                  | [Plano histórico](planning/think-review-agent-migration.md) e [fluxo atual](architecture/review-runtime-flow.md)                                                                      |
| Entender payloads estáveis                   | [Contratos](contracts/README.md)                                                  | `packages/contracts/src`                                                                                                                                                              |
| Entender a retirada do admin                 | [ADR-0040](decisions/0040-retire-admin-and-analytical-storage.md)                 | [Retirada operacional](operations/admin-retirement.md)                                                                                                                                |

Plano de funcionalidade proposto: [Identificação de tecnologias e versões por projeto](planning/project-version-identification-plan.md), com monorepos, inferência assistida, cache e integração ao workflow.

## Semantica dos documentos

| Tipo           | Autoridade                                    | Politica de alteracao                                    |
| -------------- | --------------------------------------------- | -------------------------------------------------------- |
| `decision`     | Normativa quando `accepted`                   | Nao reescrever a decisao; criar ADR que a substitua      |
| `architecture` | Desenho vigente ou proposto conforme `status` | Atualizar junto com o sistema                            |
| `research`     | Evidencia datada                              | Preservar a conclusao original e adicionar erratas       |
| `product`      | Intencao e limites do produto                 | Atualizar quando o escopo for renegociado                |
| `planning`     | Nao normativa                                 | Pode evoluir livremente ate virar decisao                |
| `contract`     | Normativa quando implementado                 | Validar por schema e testes                              |
| `index`        | Navegacao canonica                            | Atualizar quando documentos forem adicionados ou movidos |
| `reference`    | Definicoes compartilhadas                     | Manter uma unica definicao por termo                     |

## Status reconhecidos

- `draft`: incompleto e nao pronto para revisao.
- `proposed`: suficientemente definido, ainda nao aceito.
- `accepted`: decisao ou contrato aprovado.
- `current`: descricao que representa o entendimento vigente.
- `superseded`: substituido por documento posterior.
- `deprecated`: ainda existe, mas nao deve orientar trabalho novo.

## Convencoes

- Prosa em portugues; nomes de arquivos, IDs e termos de codigo em ingles.
- Datas em ISO 8601 (`YYYY-MM-DD`).
- Um arquivo responde a uma pergunta principal.
- Diagramas Mermaid sempre sao acompanhados por descricao textual.
- Fontes externas usam links diretos e registram a data de verificacao.
- `docs/glossary.md` e a fonte canonica para nomes e definicoes do dominio.

- [Identificação de versões: arquitetura](architecture/project-version-identification.md)
- [Identificação de versões: operação](operations/project-version-identification.md)

- [Configuração de repositório e editor](operations/repository-configuration.md) — contrato, CLI, limites e rollout da ADR-0037.

- [Migração proposta da observabilidade para Grafana](planning/observability-stack-migration.md): arquitetura futura, biblioteca de instrumentação, entrega durável, métricas e validação após a retirada do admin.
