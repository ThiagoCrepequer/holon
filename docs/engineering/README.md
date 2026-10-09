---
id: ENGINEERING-GUIDE
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
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

| Local                                                                          | Responsabilidade                                                                       | Onde confirmar                                                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/control-plane`                                                           | Webhook, Queue, Workflow, ledger, composição, feedback e publicação.                   | `src/index.ts`, `src/ingress/`, `src/review/`, `src/ledger/`, Wrangler e testes do app. |
| `apps/repository-executor`                                                     | Snapshot e ferramentas de leitura sobre Sandbox isolado; política de egress e cleanup. | `src/executor-service.ts`, `src/repository-tools.ts`, Wrangler, Dockerfile e testes.    |
| `packages/domain`                                                              | Identidades, estados e invariantes sem SDK de infraestrutura.                          | `src/index.ts` e testes puros.                                                          |
| `packages/application`                                                         | Casos de uso, portas, agregação, evidência e políticas de publicação.                  | `src/ports.ts`, `src/execute-review.ts` e testes.                                       |
| `packages/contracts`                                                           | Schemas runtime das fronteiras externas e payloads persistidos.                        | `src/index.ts`, schemas, exemplos e testes de rejeição.                                 |
| `packages/github` e `packages/model`                                           | Adapters GitHub e de modelo.                                                           | `package.json`, exports, `src` e testes de contrato/comportamento.                      |
| `packages/repository-analysis`, `repository-config` e `project-identification` | Diff, elegibilidade, configuração e fatos de projetos no snapshot.                     | Entradas `src/index.ts`, [grafo](../architecture/technical-ecosystem.md) e testes.      |
| `packages/evaluation`                                                          | Corpus, recordings, graders e execução de avaliação.                                   | [Runbook de avaliação](../operations/evaluations.md), package scripts e testes.         |
| `packages/test-kit`                                                            | Fixtures e builders usados somente por testes.                                         | `src/index.ts` e imports em testes; não deve virar dependência de produção.             |
| `tooling/architecture`, `config-cli` e `typescript`                            | Gate de imports, comandos locais de configuração e tsconfig compartilhado.             | `import-boundaries.test.mjs`, CLI, `base.json` e testes.                                |
| `docs` e `.agents/skills`                                                      | Decisões, instruções, pesquisas e métodos de trabalho.                                 | Este índice e [catálogo de skills](../../.agents/skills/README.md).                     |

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

## Core de revisão: critérios de qualidade

Para mudanças em evidência, shards, tools, verificação, budgets ou publicação,
use [qualidade e organização do core](review-core-quality.md). O guia define
identidade canônica, completude derivada de fatos, omissões explícitas, resultados
de busca inconclusivos, organização por regras e provas de composição.
São padrões esperados; não significam que toda a implementação já os satisfaz.

A [auditoria de 2026-10-08](../research/2026-10-08-review-core-audit.md) registra
defeitos reproduzidos, cobertura e lacunas. A
[comparação externa](../research/2026-10-08-review-system-comparison.md) distingue
mecanismos observáveis de alegações comerciais. O
[plano de melhorias](../planning/review-core-improvement-proposal.md) permanece
proposto e liga cada alternativa a testes e critérios de aceitação.

## Referência para o dashboard dos usuários

A [organização de aplicações web e dependências](frontend-application-structure.md)
registra a direção do dashboard dos usuários: packages com interfaces úteis,
rotas com arquivos privados próximos, features reutilizáveis, schemas/estado
com donos e isolamento browser/server. A fundação local implementada está em [arquitetura do dashboard](../architecture/user-dashboard.md),
com as fronteiras aceitas na ADR-0054. Fluxos posteriores continuam propostos;
o grafo do core mantém suas regras. As regras gerais de módulos
continuam em [TypeScript e módulos](typescript-and-module-design.md).

Better Auth + Drizzle/D1 é a direção escolhida para autenticação, com
[políticas acordadas e integração a provar](../research/2026-10-04-dashboard-authentication-discovery.md).
Cloudflare Email Sending foi escolhido para convites. Auth/tenancy têm composição
local e migrations próprias; envio de convites e recursos remotos continuam
dependentes das issues donas e de operação autorizada.

A [revisão de decisões de engenharia e qualidade](../planning/dashboard-engineering-decision-review.md)
registra Q1–Q37 acordadas e as investigações de auth, leitura e entrega durável
de emails. Q37 aceita retry limitado do mesmo convite quando o resultado externo
é desconhecido, com possível email duplicado. A concordância não demonstra integração real
nem autoriza publicação ou operação de recursos.

O [modelo de identidade e workspaces](dashboard-identity-and-workspaces.md)
registra User, login, membership N:M, pessoal/equipe na mesma entidade,
owner/member e cardinalidade de instalações. Organização é sinônimo de workspace.
Q31–Q34 confirmaram autoridade de vínculo, convites, múltiplos owners e onboarding
self-service mínimo. Q35/Q36 confirmaram Worker privado e fila/retries duráveis.
Login GitHub e pessoal/equipe têm implementação local no recorte M2 incorporado
à fundação M1. As demais jornadas e a prova com serviços reais permanecem futuras.

A [investigação de auth/D1](../research/2026-10-04-dashboard-auth-persistence-investigation.md)
recomenda tenancy Holon própria e delimita falhas/concorrência a provar. A
[investigação de leitura](../research/2026-10-04-dashboard-read-model-investigation.md)
inclui experimento SQLite reproduzível; a
[investigação de entrega](../research/2026-10-04-dashboard-email-delivery-investigation.md)
detalha outbox, Queue e recuperação. São propostas com evidência datada.

O [plano de implementação](../planning/dashboard-implementation-plan.md) é a
entrada atual para sequência, gates e matriz mínima de regressão; o registro
de entrevista preserva as escolhas, sem exigir releitura de todas as rodadas.
A [revisão de robustez](../research/2026-10-04-dashboard-plan-robustness-review.md)
delimita os achados corrigidos e provas ausentes. O candidato auth não está
pronto enquanto cadastro OAuth interrompido não tiver recuperação suportada.

As referências propostas de [segurança web e dados](web-security-and-data-boundaries.md)
e [ambientes/recuperação](../operations/dashboard-environments-and-recovery.md)
definem HTTP/CSRF, sessão pública, conteúdo hostil, efeitos externos e restore.
Use a skill [dashboard-engineering](../../.agents/skills/dashboard-engineering/SKILL.md)
quando a tarefa afetar essa evolução. Ela direciona a leitura e a prova, sem
substituir os guias gerais ou habilitar operação remota.

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
Referências de infraestrutura futura permanecem identificadas como propostas,
separadas do mapa implementado.
