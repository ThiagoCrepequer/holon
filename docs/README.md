---
id: DOCS-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-08-30
---

# Mapa da documentacao

Este arquivo e o ponto de entrada canonico para humanos e agentes. A
documentacao distingue deliberadamente evidencias historicas, decisoes
normativas, arquitetura pretendida e planejamento ainda nao aprovado.

## Caminhos de leitura

| Objetivo                                     | Leia primeiro                                                                     | Continue em                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Entender o produto                           | [Visao](product/vision.md)                                                        | [Escopo do MVP](product/mvp-scope.md)                                                                                                     |
| Entender o que foi decidido                  | [Indice de decisoes](decisions/README.md)                                         | [ADRs 0001-0013](decisions/README.md#registro)                                                                                            |
| Auditar afirmacoes sobre Cloudflare e GitHub | [Investigacoes](research/README.md)                                               | [Relatorio de viabilidade](research/2026-08-29-cloudflare-pr-review-feasibility.md)                                                       |
| Entender o desenho do sistema                | [Arquitetura](architecture/README.md)                                             | [Contexto](architecture/system-context.md) e [containers](architecture/container-view.md)                                                 |
| Entender o ecossistema TypeScript            | [Investigacao do toolchain](research/2026-08-29-typescript-monorepo-toolchain.md) | [Decisao do monorepo](decisions/0002-adopt-typescript-monorepo-toolchain.md) e [fronteiras tecnicas](architecture/technical-ecosystem.md) |
| Implementar o fluxo de review                | [Fluxo de execucao](architecture/review-runtime-flow.md)                          | [Estado e idempotencia](architecture/state-and-idempotency.md)                                                                            |
| Trabalhar com seguranca                      | [Trust boundaries](architecture/security-and-trust-boundaries.md)                 | [Ciclo de vida dos dados](architecture/data-lifecycle.md)                                                                                 |
| Desenvolver e operar                         | [Operação](operations/README.md)                                                  | [GitHub App](operations/github-app.md) e [deploy](operations/deployment.md)                                                               |
| Planejar a entrega                           | [Plano do MVP](planning/mvp-delivery-plan.md)                                     | [Bootstrap tecnico](planning/technical-bootstrap.md) e [questoes em aberto](planning/open-questions.md)                                   |
| Entender payloads estáveis                   | [Contratos](contracts/README.md)                                                  | `packages/contracts/src`                                                                                                                  |

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
