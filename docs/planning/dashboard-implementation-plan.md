---
id: PLAN-DASHBOARD-IMPLEMENTATION
kind: planning
status: proposed
owners:
  - core-team
last-reviewed: 2026-10-08
related:
  - dashboard-engineering-decision-review.md
  - ../engineering/frontend-application-structure.md
  - ../engineering/web-security-and-data-boundaries.md
  - ../operations/dashboard-environments-and-recovery.md
---

# Plano de implementação do dashboard dos usuários

## Objetivo e estado

Entregar login GitHub, pessoal/equipes, onboarding mínimo e lista/detalhe de
reviews autorizadas, em pt-BR/en, com continuidade visual e sem comprometer as
garantias para reduzir o escopo. Q1–Q37 estão no [registro da entrevista](dashboard-engineering-decision-review.md).
Este arquivo responde à sequência de implementação e seus gates, não repete
as perguntas nem transforma pesquisa em arquitetura materializada.

As entregas estão publicadas no [backlog do GitHub](dashboard-github-backlog.md),
com milestones, sub-issues e bloqueios. O mapa registra escopo e links; o
GitHub informa o estado atual de execução.

**Estado: M0 qualificado; fundações locais M1 materializadas conforme
[ADR-0054](../decisions/0054-establish-user-dashboard-foundations.md).**
O [registro M1](../research/2026-10-06-dashboard-foundation-results.md) identifica
comandos, primeiros resultados e limites. O [primeiro recorte M2](../research/2026-10-07-dashboard-identity-tenancy-results.md)
materializa auth/tenancy; o [complemento M2](../research/2026-10-08-dashboard-milestone-two-results.md)
integra sessões/dispositivos, governança com reauth e preferências persistidas
ao SSR e aos controles mínimos. Dados privados de
reviews, convites e conexões GitHub continuam entregas posteriores. O
[runbook](../operations/dashboard-environments-and-recovery.md) registra a
publicação de bootstrap de 2026-10-08, separada desta implementação e das
migrations/deploy futuros. Os [resultados datados](../research/2026-10-05-dashboard-milestone-zero-results.md)
ligam cada gate à bancada e sua evidência. Com a
[política de linking aprovada em 2026-10-05](../engineering/dashboard-identity-and-workspaces.md#vinculação-por-email-verificado-ajuste-aprovado-em-2026-10-05),
Better Auth/Drizzle/D1 e D1 nativo recuperam Account interrompida por novo OAuth
com o mesmo email verificado. A [avaliação normativa de OAuth](../research/2026-10-05-dashboard-oauth-security-requirements.md)
permite outro mecanismo de CSRF com PKCE válido, mas o gate independente de
não reutilização concorrente de code passa nos dois adapters com o
[plugin público aprovado](../research/2026-10-05-dashboard-code-redemption-plugin.md).
O resultado é GO local da composição M0; o GitHub informa revisão/merge e
encerramento de #129 e dependentes. A existência da bancada não implementa
as entregas seguintes. User/Account continuam não atômicos; mudança de email durante a falha
pode deixar User incompleto, sem Account/Session e sem autoridade Holon.
Não aceitar patch do core, bypass de verificação ou recuperação manual
obrigatória de cadastro como dívida para depois. O MVP limita funcionalidades;
segurança, durabilidade e testes dos fluxos incluídos permanecem obrigatórios.

## Fontes e responsabilidades

| Pergunta                                | Fonte canônica desta evolução                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Produto e escolhas confirmadas          | Registro Q1–Q37 e [identidade/workspaces](../engineering/dashboard-identity-and-workspaces.md) |
| Localidade, packages, SSR/API/Query     | [Organização frontend](../engineering/frontend-application-structure.md)                       |
| HTTP, sessão pública, conteúdo e aceite | [Segurança web](../engineering/web-security-and-data-boundaries.md)                            |
| Adapter/cadastro/refresh                | [Investigação auth](../research/2026-10-04-dashboard-auth-persistence-investigation.md)        |
| Projeção/lista/detalhe/paginação        | [Investigação leitura](../research/2026-10-04-dashboard-read-model-investigation.md)           |
| Intenção/Queue/retries/resultado        | [Investigação email](../research/2026-10-04-dashboard-email-delivery-investigation.md)         |
| Prova automatizada e seus limites       | [Testes e evidência](../engineering/testing-and-evidence.md)                                   |
| Marca/tokens/movimento                  | [Design system](../brand/README.md) e [motion](../brand/motion.md)                             |
| Preview, rollout e restore              | [Ambientes e recuperação](../operations/dashboard-environments-and-recovery.md)                |

ADRs aceitos do core continuam prevalecendo. Antes de introduzir novos Workers,
D1 e capacidade de leitura pública autenticada, registrar decisão arquitetural
com alternativas/consequências e atualizar o grafo/contratos atingidos. A
ADR-0040 retirou o admin; o dashboard dos usuários não restaura suas tabelas,
endpoints, recursos ou retenção. Não alterar ADR aceito nem marcar proposta
como aceita por haver teste local.

## Sequência e gates bloqueantes

| Etapa                          | Entrega coesa                                                                                                       | Condição para avançar                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Viabilidade das integrações | Prova isolada da versão estável auth/adapter/D1 e da ponte Router/Query/Workers; prova i18n/build e storage/alarm   | Cadastro interrompido recupera por novo fluxo OAuth sem órfão bloqueante; replay state/code negado; nenhum segredo em JSON; ponte não duplica dataset; obrigação+wake-up têm suporte comprovado |
| 1. Composição e gates          | ADR/grafo, exports browser/server, workspaces estritamente necessários, configs Node/DOM/Workers/browser e comandos | Checks negativos detectam imports/ciclos/vazamento; marca e matriz crítica entram no gate, sem reduzir cobertura do core                                                                        |
| 2. Identidade e tenancy        | Sessão, pessoal idempotente, equipe/owners, DTOs auth restritos, migrations e portas                                | Falhas/concorrência, último owner e revogação passam em runtime real; comandos não fazem efeitos após guarda falha                                                                              |
| 3. GitHub e onboarding         | Conectar instalação por Q31, grants paginados/cache Q30, convite+intenção e aceite por alvo                         | IDs forjados/corridas/CSRF/provider indisponível/replay negados; refresh perdido exige reconexão sem grant antigo                                                                               |
| 4. Email recuperável           | Publisher+vigília D1, Queue, Worker privado, tentativa/claim/resultados/DLQ                                         | Crash em cada janela, publicado sem consumer, retenção esgotada, aceitação tardia e cancelamento não perdem obrigação ou reiniciam orçamento                                                    |
| 5. Lista/detalhe               | Metadados causais, revisão/snapshot/obrigação/alarm, índice D1 paginado e agregado restrito                         | Reordenação/outage além de retries nativos, DTO consistente, cursor/filtros e busca real; nenhuma ACL após paginação ou fan-out por linha                                                       |
| 6. Produto e promoção          | Telas completas, pt-BR/en, estados de sessão/acesso/erro/vazio, motion e operação                                   | Matriz bilíngue crítica por PR, ampla antes de promover, baseline/budgets e smokes autorizados do mesmo artefato                                                                                |

Etapa 0 valida suporte; não cria uma pilha provisória a substituir na etapa 2.
Se o candidato auth não cumprir a invariável por caminho suportado, a composição
fica bloqueada e exige revisão do adapter/persistência antes de continuar essa
dependência. Pode-se trabalhar em regras puras, contratos e UI sintética isolada;
nenhum bypass de login entra no artefato produtivo. Não instalar todas as opções
do radar, copiar todo shadcn ou criar camadas/pastas vazias de bootstrap.

## Matriz mínima de regressão

Cada entrega liga invariável → interface observável → teste → comando → artefato.
Assert do contrato tem oráculo independente; fixture/fake não replica o algoritmo
de produção. Cobertura numérica acompanha, não substitui essa ligação.

| Invariável                       | Cenários mínimos                                                                                                                                                                                                 | Fronteira principal                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Identidade não muda por acidente | Falha User/Account recupera por novo OAuth; replay state/code negado; linking com email recebido/local não verificado negado, Account estável após troca de email, endpoint não permitido, segredo em sessão/SSR | Adapter + Workerd/D1; browser para cookie/fluxo        |
| Autorização atual                | Membership removida, repo/installation/workspace alheios, grant negativo/expirado, provider indisponível, CSRF/redirect                                                                                          | Política pura + handlers/runtimes + browser            |
| Owner e convite íntegros         | Dois últimos owners saem/rebaixam; guarda zero rows sem child/outbox; alvo divergente; aceite/cancelamento concorrentes; replay não recria membership removida                                                   | Persistência D1/constraints/comandos reais             |
| Refresh não fabrica sucesso      | Dois Workers, vencedor/perdedor, resposta remota perdida, falha de gravação, reconexão de identidade diferente                                                                                                   | Porta auth/GitHub e persistência no runtime            |
| Entrega recuperável limitada     | Publicação/ack interrompidos, mensagem expirada, stale lease/sucesso tardio, DLQ/D1 indisponíveis, Q37 sem novo convite                                                                                          | Publisher/consumer + state store + provider controlado |
| Projeção correta                 | Mesma revisão/diferente conteúdo, evento antigo, outage longa/rearm, revisão nova em I/O, restore inferior com entrega antiga após reconstrução/retomada                                                         | Ledger/RPC/D1 no runtime, restore sintético            |
| Página e busca corretas          | DTO aprovado, empate/cursor, filtro muda, ACL pré-LIMIT, contains raro/curto/sem resultado, número+título                                                                                                        | SQL real/normalizador Workers; não só índice sintético |
| Continuidade privada             | Uma leitura por intenção; zero na hidratação; resposta/403 antiga; revogação atual remove cache; foco/scroll/voltar                                                                                              | Browser com build real e respostas controladas         |
| UI bilíngue/acessível            | Catálogos completos, SSR simultâneo, layout longo/320 px/zoom, teclado/contraste, redução durante animação                                                                                                       | DOM + browser 3 engines; complemento humano/mobile     |
| Ambiente recuperável             | Preview sem bindings produtivos, sender sem URL pública, schema/artefato compatíveis, sessão/job revividos por restore                                                                                           | Config/build e ensaio sintético; smoke autorizado      |

Workers local, SQLite sintético, browser emulado e smoke remoto têm evidências
distintas. O gate não passa por rerun de teste flaky, exclusão de produção da
cobertura, config ignorada ou segredo redigido só no screenshot. API/UI críticas
acompanham teste permitido/negado na mesma entrega, não uma fase final de QA.

## Performance mensurável, sem prometer benchmark ausente

Q14/Q15 fixam perfil desktop/mobile limitado e carga 10 mil PRs/repo, página 50,
detalhe 200 findings. Antes da implementação publicar números, escolher dispositivo,
rede, build, cache frio/quente, região e amostra repetível. Registrar JS/CSS/fontes
comprimidos por rota, tarefas longas/INP, LCP/CLS, latência p50/p95 de SSR/filtro/
refresh/RPC, rows_read/rows_written, CPU, payload e lag.

Como referência técnica de usabilidade, [Core Web Vitals](https://web.dev/articles/vitals)
define bons limiares LCP ≤2,5 s, INP ≤200 ms e CLS ≤0,1 no percentil 75 por
mobile/desktop. São alvos candidatos, não métricas já alcançadas. Lab controlado
detecta regressão; não comprova percentis de usuários reais nem mede INP por um
Lighthouse sem interação. Não criar analytics de produto apenas para a prova.

Fixar budgets de rota/API/lag/envio antes de promoção, com dono, protocolo e
limites de plataforma. Baseline ruim não define automaticamente meta aceitável;
falha leva a corrigir query/markup/bundle/composição. Não substituir contains por
busca tokenizada, flexibilizar autorização ou reduzir acessibilidade para obter
tempo melhor. Table/Virtual, highlight e gráficos entram somente quando a tela
exigir; lazy load e DOM limitado são primeira opção, com IDs/semântica preservados.

## Critério de conclusão e registro de evidência

Uma etapa passa quando comportamento e falhas exigidos têm testes, comandos,
resultado e limitações registrados no artefato correspondente. Antes de publicação,
registrar recursos/origens reais, retenção/deadlines, budgets, dono operacional,
schemas/restore e smokes de login/grant/sender autorizados. Nenhuma pendência
de identidade, autorização ou recuperação entra como TODO produtivo.

A revisão documental de **2026-10-04** não executou estas etapas nem aprovou
operação remota. O [relatório da revisão](../research/2026-10-04-dashboard-plan-robustness-review.md)
lista os achados corrigidos e as provas ainda ausentes. Usar este plano como
entrada curta; o registro Q1–Q37 permanece histórico das escolhas.

## Fronteira M1 e integração nas issues donas — 2026-10-07

Por escolha explícita do responsável, #137 entrega a fronteira HTTP e as
políticas dos consumidores atuais (auth/tenancy). As provas que exigem fluxos
futuros acompanham sua implementação: convite/outbox e abuso em #148, scanners e
aceite sem efeito em GET/HEAD em #149, templates/consumer em #152, filtros reais
em #157, SSR/API privados em #158, toasts/onboarding em #159 e Markdown/tracking
em #161. #163 integra essas provas nas jornadas completas antes da promoção.

A reconciliação conserva os requisitos e elimina a dependência circular; não
encerra M3–M6 nem declara implementação ou operação remota. A revisão final dos
critérios M1 está em [revisão final M1](../research/2026-10-07-dashboard-milestone-one-final-review.md).

## Entrega local M3 em 2026-10-08

O [relatório M3](../research/2026-10-08-dashboard-milestone-three-results.md)
rastreia a implementação completa de #145–#149 e os critérios de aceite. Está
sobre a conclusão M2 do PR #177; estado de merge/encerramento é autoridade do
GitHub. M3 materializa coordenação de credenciais, dupla autoridade de conexão,
grants e ciclo de convites com obrigação durável. Email delivery continua em
#150–#153/M4 e dataset/projeção privados em M5. Gates locais não equivalem a
OAuth real, migrations remotas ou publicação. Nenhuma operação remota M3 foi
executada para preparar o PR.
