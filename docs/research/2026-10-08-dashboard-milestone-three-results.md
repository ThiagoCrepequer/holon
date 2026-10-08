---
id: RESEARCH-DASHBOARD-MILESTONE-THREE-RESULTS
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
related:
  - ../architecture/user-dashboard.md
  - ../operations/dashboard-environments-and-recovery.md
  - ../planning/dashboard-github-backlog.md
---

# Milestone 3: GitHub e convites

## Escopo e base

A entrega cobre todas as cinco issues de [Dashboard 3](https://github.com/ThiagoCrepequer/holon/milestone/4):
#145–#149, sobre a conclusão M2 do PR #177. Base de revisão isolada M3:
`ffa012f46175f185b07774d1ae2e950f58289355`. A branch parte também do main
`1941a4f`; não reescreve o PR M2 nem mistura seu diff nos critérios abaixo.
Documentos de planejamento são propostas; os contratos/código/testes e ADRs
aceitos definem o estado implementado.

## Critérios conferidos

| Issue e critério                                                                                           | Implementação e oráculo                                                                                                                                              | Resultado local                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [#145](https://github.com/ThiagoCrepequer/holon/issues/145): todos os caminhos de refresh coordenados      | `github-credentials.server.ts`, `github-user.server.ts`, plugin nativo; D1 CAS/claim com reads independentes, provider conta exchanges, primeiro OAuth criptografado | Coberto: um vencedor, disputa/lease, refresh nativo fechado, write OAuth avança geração                                                |
| #145: unknown outcome recuperável sem retry cego                                                           | Claim perdido, resposta/commit perdido, par inválido/expirado e cifra inválida; endpoint de status + reconexão de subject estável                                    | Coberto: desconecta generation esperada, não sobrescreve novo OAuth, não repete refresh incerto                                        |
| #145: runbook e evidência de rotação                                                                       | Ring público Better Auth compartilhado; OAuth nativo escreve envelope versionado, leitura legada preservada; runbook separado por token/client secret/CSRF           | Coberto localmente; ensaio e smoke remotos dependem de operação autorizada                                                             |
| [#146](https://github.com/ThiagoCrepequer/holon/issues/146): Q31 positiva/negativa nos dois lados          | Provider controlado com IDs estáveis, App correta, conta pessoal e org admin ativo, paginação memberships/instalações; D1 owner atual/prova reauth guardada          | Coberto: membro local, membro org, outra conta/App e instalação suspensa negados; remoção durante I/O impede commit                    |
| #146: múltiplas instalações/um workspace auditável sem PII                                                 | PK installation + state/generation/creator; batches reais de disputa entre equipes e prova escopada; DTO sem username/token                                          | Coberto: um vínculo vence; vários IDs cabem no workspace; unlink não transfere alocação                                                |
| #146: UI real, sem auto-share/transfer                                                                     | Lista autoritativa, reauth nativa + confirmação explícita, estados active/suspended/revoked                                                                          | Browser comprova link e suspensão por RPC privado; login não conecta automaticamente                                                   |
| [#147](https://github.com/ThiagoCrepequer/holon/issues/147): política única em entradas privadas           | `WorkspaceCollaborationPort.authorizeReviews` retorna scope após admissão atual + full grants; Hono usa a porta, SSR/M5 recebe a mesma fronteira                     | Implementado para consumidores atuais; dataset e loaders privados serão integrados em M5                                               |
| #147: Q30 e identidade atual                                                                               | Cache positivo/negativo ≤60 s desde início da observação; keys/gerações, sessão/membership D1 e snapshot final; webhook assinado → Queue + RPC com receipts          | Coberto: TTL, invalidação, revogação, replay de evento após reconexão, corrida durante captura e indisponibilidade fail closed         |
| #147: autorização antes da paginação                                                                       | Todas as páginas de instalações/repos/memberships; teto externo 100 páginas falha fechado; sem LIMIT de conexões ao construir scope                                  | Coberto por páginas posteriores, total inconsistente, duplicatas e páginas incompletas; M5 deverá aplicar scope antes de LIMIT interno |
| [#148](https://github.com/ThiagoCrepequer/holon/issues/148): convite + obrigação atômicos em D1 real local | Batch guardada, trigger de falha independente na segunda escrita; contagem direta das tabelas, concurrent retries                                                    | Coberto: rollback integral, nenhuma intenção órfã, mesmo operation ID conserva convite/job                                             |
| #148: IDs/deadline/orçamento/política                                                                      | ID opaco compartilhado com job; TTL/deadline 7 dias, attempts 0/max 5, next_action_at, budgets 10/min ator/equipe e 30/min equipe                                    | Definido no schema/runbook e conferido por queries independentes e disputa concorrente                                                 |
| #148: sem envio em request/perda silenciosa                                                                | Somente intenção D1, DTO intent_recorded, não chama sender; unknown mantém operation ID                                                                              | Coberto; sender/reconciliador M4 ainda não implementados, intenção conserva a obrigação                                                |
| #148: gates de abuso transferidos de #137                                                                  | Email/body limitados, extra keys negadas, owner atual, budgets globais entre instâncias; HTTP 429 + Retry-After                                                      | Coberto: negação não cria convite/job; retry não consome orçamento outra vez                                                           |
| [#149](https://github.com/ThiagoCrepequer/holon/issues/149): pending→terminal e replay                     | POST + email atual provider + CAS de estado/prazo/account/geração; accepted_by + membership na mesma batch; cron limitado                                            | Coberto: aceitar/cancelar/expirar, corrida cancel/aceite, replay do mesmo User e remoção posterior                                     |
| #149: alvo/role corretos                                                                                   | Email secundário verificado permitido, primário não obrigatório; trim/lowercase somente; member inserido sem promover owner                                          | Coberto: alvo errado/outro User/plus/dot não equivalente, conta/geração trocada, prazo e sessão revogados                              |
| #149: privacidade/UI/cancelamento                                                                          | GET/HEAD genéricos sem lookup de convite, POST CSRF; owner vê alvo apenas na gestão, aceite não devolve dados privados; mensagens bilíngues                          | Browser/HTTP provam scanners sem efeito; UI informa bloqueio futuro e ausência de confirmação de envio                                 |

Além do checklist, testes cobrem payload externo inválido, 401/403/429/5xx,
falhas de transporte, replay de prova, unicidade concorrente, rollback provocado,
consumo de reauth atômico, acesso por outro workspace, membership removida com
sessão válida, negação sem ressurreição e dados de provider não serializados.
As guards usam relógio SQLite no commit e não contadores D1 iguais a 1, pois
triggers podem participar de `meta.changes`.

## Evidência executável

Suites relevantes:

- `packages/contracts/test/dashboard-collaboration.test.ts`: valida limites e
  contratos externos/internos, email e versão de chave.
- `packages/auth/test/github-user.test.ts` e `github-reconnection-native.test.ts`:
  D1 real Workerd, HTTP GitHub controlado, PKCE/OAuth nativo e envelopes de tokens.
- `packages/db/test/{credential-coordination,github-connections-grants,invitation-lifecycle,collaboration}.test.ts`:
  D1 real, concorrência, triggers e leituras SQL independentes.
- `apps/dashboard/test/support/collaboration-cases.ts`: mesma composição real
  em Node/Miniflare e Workerd; HTTP handlers testados com fronteiras de erro.
- `apps/control-plane/test/dashboard-access-events.test.ts` e webhook:
  HMAC real sintético, Queue/RPC e retry; browser faz RPC service binding real.
- `apps/dashboard/test/browser/milestone-three.spec.ts`: OAuth/reauth nativo,
  equipe/convite/email secundário/aceite, link/suspensão/grants e cancelamento,
  en/pt-BR, largura 320 px e axe em Chromium/Firefox/WebKit. Harness substitui
  somente o provider externo e oferece inspeção de estado para o oráculo.

Primeiras execuções encontraram checagem inválida `meta.changes === 1` diante de
triggers, erro de API da fixture OAuth e imports Cloudflare em runner Node;
foram corrigidos sem diminuir gates. O teste inicial de coordenação registrou
módulo ainda ausente; não foi evidência de falha comportamental. Casos de convite
não têm registro completo red-before-fix; resultado verde final não é prova de
TDD integral. Catálogos foram extraídos novamente após dividir os painéis UI.

## Revisão independente

A skill `code-review` realizou duas revisões sobre a base M3 fixada, com spec
nas cinco issues e padrões no AGENTS/engenharia/arquitetura do Holon.

### Standards

Um achado P1: aguardar o novo RPC antes de revoke/restore impedia a transição
existente do core quando o dashboard falhava. Corrigido com efeitos independentes
em `Promise.allSettled`, aguardando ambas as autoridades antes da resposta. O
teste primeiro falhou com zero calls de revoke; após correção confirma revoke
mesmo em erro de dashboard e preserva mensagem durável. A revisão posterior
confirmou o encerramento do achado, sem outro problema sustentado.

### Spec

Dois achados P1: o primeiro grant podia expirar enquanto outra instalação era
consultada; a última revalidação GitHub conferia instalação acessível sem
reconfirmar admin ativo da organização. Corrigidos com snapshot do prazo original
por instalação e guarda final conjunta de TTL/gerações/cache, mais leitura final
da membership por organização com ID/state/role conferidos. Ambos os testes
falharam antes da correção; o cenário de membership também cobre pending e ID
incompatível. A revisão posterior confirmou os dois achados encerrados.

Resumo: Standards 1 e Spec 2 achados iniciais; nenhum achado sustentado restante
após correção. Validação final abaixo mantém os limites de evidência.

## Comandos e resultado final

A bancada usou Node **24.11.0** e pnpm **11.24.0**. `pnpm install --frozen-lockfile`
preparou as dependências sem alterar lockfile. `pnpm format`, `pnpm lint`,
`pnpm test:architecture`, typechecks/testes focados e dry-run do dashboard foram
executados durante a implementação. O gate final é `pnpm verify`, preservando
thresholds e código de produção no cálculo.

Antes do gate final, o teste antigo M1 esperava 404 para
`/api/invitations/accept`: M3 agora interpreta `accept` como qualquer ID opaco e
retorna GET/HEAD genérico 200. O teste passou a conferir o DTO genérico exato,
HEAD e POST inválido ainda 405, preservando a prova de ausência de efeitos.
Outro teste antigo de gestão foi atualizado para permitir destinatário ao owner;
negação a member e aceite sem dados privados permanecem cobertos.

**`pnpm verify`: PASS (exit 0)** em 2026-10-08: marca/schema/config, formatter,
lint, typecheck, arquitetura, cobertura de todos os workspaces e build/dry-runs,
inclusive imagem Docker do Sandbox. Turbo concluiu 21 tarefas de tipos,
32 de cobertura e 17 de build (parte delas com cache por hash do artefato).
Não houve exclusão de produção, redução de threshold ou remoção de teste falho.

Suites relevantes no gate: auth **118**, DB **148**, dashboard Node **144**,
dashboard Workerd **90**, control-plane **355** testes; browser da fundação
**12**, autenticados **33** (9 de M3) e prova M0 **60**. Todos passaram.
Cobertura statements/branches/functions/lines:

| Suite             | Statements | Branches | Functions | Lines  |
| ----------------- | ---------- | -------- | --------- | ------ |
| Auth              | 93.69%     | 86.88%   | 98.41%    | 94.34% |
| DB                | 94.93%     | 86.84%   | 100%      | 95.74% |
| Dashboard Node    | 96.31%     | 93.99%   | 95.74%    | 97%    |
| Dashboard Workerd | 96.27%     | 91.82%   | 98.57%    | 96.8%  |
| Control-plane     | 91.74%     | 86.41%   | 92.64%    | 93.05% |

Revisão das correções confirmou ausência de achados sustentados pendentes;
`git diff --check` e lint passaram após atualizar esta evidência documental.
O PR mantém a dependência de #177, ainda aberto na consulta de 2026-10-08;
a branch incorpora também o main já publicado para preservar seus gates.

## Limites e sequência seguinte

Não houve deploy, secrets, migration remota, GitHub real nem email real. Não há
novo dataset privado, sender ou refresh remoto demonstrado. M4 conserva as
intenções e seus budgets; M5 integra scope aos filtros/SSR/detalhe antes de
paginação. A gestão exibe até 100 convites recentes; grants externos têm teto
100 páginas de 100 com fail closed, sem autorização parcial.

O provider e D1 não participam de transação distribuída. Q30 limita cache a 60 s;
evento atrasado/ausente e mudança externa posterior à prova não são atomicidade
linearizável. Receipt impede reaplicação da mesma delivery, não deduz causalidade
de eventos GitHub nunca recebidos. Transferência administrativa permanece fora
do recorte; estados revogados preservam alocação para reconexão no mesmo espaço.

Build/dry-run prova composição do artefato, sem executar integrações remotas.
Matriz de engines/axe local não prova aparelhos/versões estáveis Q3 completos;
#163/#167 continuam donos da promoção e dos smokes reais autorizados.
