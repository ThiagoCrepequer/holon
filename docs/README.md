---
id: DOCS-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Mapa da documentacao

Este arquivo e o ponto de entrada canonico para humanos e agentes. A
documentacao distingue deliberadamente evidencias historicas, decisoes
normativas, arquitetura pretendida e planejamento ainda nao aprovado.

O [backlog do dashboard no GitHub](planning/dashboard-github-backlog.md)
localiza as entregas, milestones e gates dessa evolução. Os
[resultados do milestone 0](research/2026-10-05-dashboard-milestone-zero-results.md)
registram os gates com GO local da composição, incluindo o plugin auth; não representam
um dashboard publicado.

## Caminhos de leitura

| Objetivo                                     | Leia primeiro                                                                     | Continue em                                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entender o produto                           | [Visao](product/vision.md)                                                        | [Escopo do MVP](product/mvp-scope.md)                                                                                                                                                 |
| Entender o que foi decidido                  | [Indice de decisoes](decisions/README.md)                                         | [Registro completo de ADRs](decisions/README.md#registro)                                                                                                                             |
| Auditar afirmacoes sobre Cloudflare e GitHub | [Investigacoes](research/README.md)                                               | [Relatorio de viabilidade](research/2026-08-29-cloudflare-pr-review-feasibility.md)                                                                                                   |
| Entender o desenho do sistema                | [Arquitetura](architecture/README.md)                                             | [Contexto](architecture/system-context.md) e [containers](architecture/container-view.md)                                                                                             |
| Entender o ecossistema TypeScript            | [Investigacao do toolchain](research/2026-08-29-typescript-monorepo-toolchain.md) | [Decisao do monorepo](decisions/0002-adopt-typescript-monorepo-toolchain.md) e [fronteiras tecnicas](architecture/technical-ecosystem.md)                                             |
| Encontrar contexto para implementar          | [Guia de engenharia](engineering/README.md)                                       | [TypeScript e módulos](engineering/typescript-and-module-design.md), [runtime e integrações](engineering/runtime-and-integrations.md) e [testes](engineering/testing-and-evidence.md) |
| Criar marca, site, LP ou interface           | [Identidade e design system](brand/README.md)                                     | [UI Kit](brand/ui-kit/index.html), [fundamentos](brand/foundations.md) e [integração](brand/implementation.md)                                                                        |
| Implementar o fluxo de review                | [Fluxo de execucao](architecture/review-runtime-flow.md)                          | [Estado e idempotencia](architecture/state-and-idempotency.md)                                                                                                                        |
| Trabalhar com seguranca                      | [Trust boundaries](architecture/security-and-trust-boundaries.md)                 | [Ciclo de vida dos dados](architecture/data-lifecycle.md)                                                                                                                             |
| Desenvolver e operar                         | [Operação](operations/README.md)                                                  | [GitHub App](operations/github-app.md), [deploy](operations/deployment.md) e [avaliações](operations/evaluations.md)                                                                  |
| Planejar a entrega                           | [Plano do MVP](planning/mvp-delivery-plan.md)                                     | [Bootstrap tecnico](planning/technical-bootstrap.md) e [questoes em aberto](planning/open-questions.md)                                                                               |
| Evoluir o core de review                     | [Roadmap do core](planning/review-core-evolution-roadmap.md)                      | [Contrato de qualidade](product/review-quality-contract.md) e [fluxo de execucao](architecture/review-runtime-flow.md)                                                                |
| Entender a migração do motor de review       | [ADR-0049](decisions/0049-use-cloudflare-think-for-pr-review.md)                  | [Plano histórico](planning/think-review-agent-migration.md) e [fluxo atual](architecture/review-runtime-flow.md)                                                                      |
| Entender payloads estáveis                   | [Contratos](contracts/README.md)                                                  | `packages/contracts/src`                                                                                                                                                              |
| Entender a retirada do admin                 | [ADR-0040](decisions/0040-retire-admin-and-analytical-storage.md)                 | [Retirada operacional](operations/admin-retirement.md)                                                                                                                                |

Plano de funcionalidade proposto: [Identificação de tecnologias e versões por projeto](planning/project-version-identification-plan.md), com monorepos, inferência assistida, cache e integração ao workflow.

Para o core de revisão, a [auditoria de 2026-10-08](research/2026-10-08-review-core-audit.md)
registra defeitos reproduzidos e limites dos testes. O
[guia de qualidade](engineering/review-core-quality.md) define práticas esperadas;
a [comparação externa](research/2026-10-08-review-system-comparison.md) e o
[plano de melhorias](planning/review-core-improvement-proposal.md) fundamentam
evoluções de precisão, uso de tools e velocidade. O
[relatório de implementação](research/2026-10-08-review-core-implementation.md)
liga cada entrega aos testes, benchmarks e gates ainda abertos; a
[ADR-0056](decisions/0056-preserve-review-evidence-and-schedule-stable-lanes.md)
registra o runtime resultante.

A [continuação de 2026-10-09](research/2026-10-09-review-core-code-follow-up.md)
separa novos defeitos corrigidos no código/benchmark das hipóteses sobre a
capacidade do Gemma e registra as provas correspondentes.

O [ajuste de cobertura após o PR #184](research/2026-10-09-review-context-coverage.md)
registra a separação de omissões, janelas compartilhadas e a política de
severidade fornecida ao modelo, com regressões locais e par sintético no Gateway.
Sua continuação registra o orçamento estrutural considerado no agrupamento e
o replay limitado do PR #185, conforme a
[ADR-0061](decisions/0061-pack-review-shards-with-structural-context-budget.md).

A verificação de candidatos antes da publicação segue a
[ADR-0050](decisions/0050-verify-finding-causality-before-publication.md), o
[contrato de qualidade](product/review-quality-contract.md#verificação-causal-antes-da-publicação)
e o [fluxo atual](architecture/review-runtime-flow.md).

Pesquisa para uma evolução futura: [Coletânea de bibliotecas para o dashboard](research/2026-10-04-dashboard-library-landscape.md), com fronteiras propostas de React Router SSR/API Hono e radar de bibliotecas. A [análise das referências de UI](research/2026-10-04-dashboard-ui-motion-references.md) sustenta o [guia de movimento](brand/motion.md) do design system.

Fundações locais do dashboard: [ADR-0054](decisions/0054-establish-user-dashboard-foundations.md) e [arquitetura](architecture/user-dashboard.md).

Referência de engenharia do dashboard: [Organização de aplicações web e dependências](engineering/frontend-application-structure.md). A [descoberta de autenticação](research/2026-10-04-dashboard-authentication-discovery.md) registra Better Auth + Drizzle/D1 e as políticas acordadas; suporte e recuperação da integração continuam a provar.

A [revisão de decisões do dashboard](planning/dashboard-engineering-decision-review.md) acompanha a entrevista de engenharia e qualidade, com Q1–Q37 registradas e Worker/fila de emails acordados. As investigações de [auth/D1](research/2026-10-04-dashboard-auth-persistence-investigation.md), [leitura/busca](research/2026-10-04-dashboard-read-model-investigation.md) e [entrega de emails](research/2026-10-04-dashboard-email-delivery-investigation.md) delimitam evidência e provas restantes.

O [modelo de identidade e workspaces](engineering/dashboard-identity-and-workspaces.md)
registra o modelo de produto acordado: organização e workspace são o mesmo
conceito, com memberships N:M e integração GitHub explícita. O primeiro recorte M2 implementa identidade e tenancy no runtime local;
M3 acrescenta convites, conexões e grants locais; M4 acrescenta entrega
recuperável conforme a [matriz de evidência](planning/dashboard-milestone-four-evidence.md).
M5 acrescenta projeção e leitura privada conforme a [matriz M5](planning/dashboard-milestone-five-evidence.md).
Envio real e benchmark/PITR remotos dependem de operação autorizada.

Para iniciar essa evolução, use o [plano de implementação do dashboard](planning/dashboard-implementation-plan.md),
consolidado após a [revisão de robustez](research/2026-10-04-dashboard-plan-robustness-review.md).
Ele liga as escolhas Q1–Q37 à sequência e aos gates bloqueantes, incluindo a
viabilidade auth/D1. A [prova atual](research/2026-10-05-dashboard-auth-proof.md)
recupera cadastro por linking nativo de email verificado, aprovado em 2026-10-05;
o [plugin de reserva D1](research/2026-10-05-dashboard-code-redemption-plugin.md)
satisfaz o gate de não reutilização concorrente de code na bancada, conforme a
[avaliação OAuth](research/2026-10-05-dashboard-oauth-security-requirements.md). [Segurança web](engineering/web-security-and-data-boundaries.md)
e [ambientes/recuperação](operations/dashboard-environments-and-recovery.md)
completam as referências propostas; a skill [dashboard-engineering](../.agents/skills/dashboard-engineering/SKILL.md)
direciona agentes às fontes afetadas. Essas pesquisas preservam as provas datadas; o estado implementado é descrito
na arquitetura e nos resultados M1/M2 abaixo.

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

- [Memória incremental do repositório](architecture/repository-memory.md) e [operação](operations/repository-memory.md): observações, propostas e regras aprovadas pela ADR-0051.

Perguntas e contestações em findings seguem a [ADR-0052](decisions/0052-answer-finding-questions-in-pr-threads.md) e o [guia de uso e operação](operations/finding-clarification.md).

A [fundação M1](research/2026-10-06-dashboard-foundation-results.md) registra
workspaces, comandos, gates locais e critérios ainda dependentes de auth,
convites, entrega e leitura privada. Sua existência não significa deploy nem
runtime SaaS autenticado em produção.

O [primeiro recorte M2](research/2026-10-07-dashboard-identity-tenancy-results.md)
registra auth/tenancy locais e o complemento de #134, em PR stacked sobre M1.
Não representa encerramento integral de M1/M2 nem operação remota.

A [revisão final de M1](research/2026-10-07-dashboard-milestone-one-final-review.md)
rastreia #132–#138 e a separação autorizada dos gates de integração nas issues
donas, com limites entre prova local e validação remota.

A [continuação do benchmark real](research/2026-10-08-review-core-live-benchmark.md) registra o orçamento de US$ 0,50, correções do inventário/contrato causal e gates ainda abertos após repetição e falso positivo.

Os [resultados M3](research/2026-10-08-dashboard-milestone-three-results.md)
rastreiam #145–#149: credenciais/refresh, dupla autoridade GitHub, grants e
convites atômicos por alvo, com provas Workerd/D1/browser e limites remotos.

- [Evidência de Dashboard 5](planning/dashboard-milestone-five-evidence.md): causalidade, leitura privada e limites de prova.
- [Evidência de Dashboard 4](planning/dashboard-milestone-four-evidence.md): critérios e limites locais de entrega recuperável.
