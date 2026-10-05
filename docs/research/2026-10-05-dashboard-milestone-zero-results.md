---
id: RESEARCH-DASHBOARD-MILESTONE-ZERO-RESULTS
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-05
related:
  - ../planning/dashboard-implementation-plan.md
  - ../planning/dashboard-github-backlog.md
  - 2026-10-05-dashboard-auth-proof.md
  - 2026-10-05-dashboard-browser-proof.md
  - 2026-10-05-dashboard-ledger-proof.md
---

# Milestone 0: resultados das provas executáveis

## O que esta entrega permite concluir

As bancadas privadas de `tooling/` tornam os gates do milestone 0 reproduzíveis,
antes de criar Workers/packages de produto. **O milestone permanece bloqueado
pela autenticação D1.** Diagnósticos verdes reproduzem o comportamento do
candidato; não transformam NO-GO em suporte nem autorizam iniciar auth produtiva.

| Entrega        | Resultado                                 | Fonte e fronteira                                                                                         |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| DASH-01 / #128 | Base documental já mergeada               | PR #126; este trabalho parte da base mergeada `f348569eb31800649930327a69c139902d96acf9`                  |
| DASH-02 / #129 | **NO-GO** em Drizzle/D1 e D1 nativo       | [Auth](2026-10-05-dashboard-auth-proof.md): Better Auth real, Workerd/D1 locais, somente GitHub sintético |
| DASH-03 / #130 | **GO local** para a composição de leitura | [Router/Query/i18n/CSP](2026-10-05-dashboard-browser-proof.md): build real e browser contra Workerd local |
| DASH-04 / #131 | **GO local** para a primitiva atômica     | [Ledger](2026-10-05-dashboard-ledger-proof.md): SQL/alarm reais; falhas/relógio/efeitos controlados       |

O [GitHub](../planning/dashboard-github-backlog.md) continua sendo fonte de merge
e encerramento das issues. A primitiva e a bancada browser não implementam
projeção, autenticação, tenancy, telas ou operação do dashboard. ADRs aceitos,
grafo e recursos produtivos permanecem os atuais; as dependências futuras só
podem avançar quando seus próprios gates forem satisfeitos.

## Achados que alteram a implementação futura

**Auth:** o responsável aprovou em 2026-10-05 o linking nativo por email
verificado no provider e no User local, substituindo a restrição anterior de Q32.
Novo OAuth após falha de Account agora recupera em Drizzle/D1 e D1 nativo,
preservando o User original. As 42 provas da primeira atualização cobrem também
verificação recebida/local,
falhas de vínculo, concorrência e estabilidade do User com Account já existente.
Não há hook de recuperação, patch ou mudança de persistência. INSERTs continuam
separados e email alterado durante a falha pode conservar User incompleto sem
Account/Session; onboarding não pode provisionar autoridade a partir de User
isolado. A condição independente de não reutilização concorrente de code continua
falhando: duas token requests, uma sessão pelo código único/PKCE do provider fake.
Não inferir takeover desse número nem relaxar o gate pela aprovação de linking.

**Leitura:** a feature deve ser dona da intenção, HTTP e cancelamento. Query
mantém cache/subscription por APIs públicas. Um snapshot restaurado por
cancelamento/deduplicação não confirma autorização de uma nova navegação.
Bootstrap SSR também não pode repor dados que uma negação já expulsou. O
[guia frontend](../engineering/frontend-application-structure.md#dono-da-leitura-em-ssr-hidratação-e-navegação)
registra a composição refinada; não se implementou outra regra no loader e na API.

**Ledger:** revisão/obrigação e próximo alarm na mesma transação assíncrona
passam juntos ou sofrem rollback. SQL síncrono com `setAlarm` posterior deixa
janela de perda de wake-up. A primitiva permite implementar posteriormente
projeção/cleanup/checks/supersession com mínimo deadline comum e ack condicional.
Rearmamento próprio cobre indisponibilidade do efeito com storage saudável;
não promete recuperação infinita se storage/runtime não confirmarem o wake-up.

## Como executar e interpretar

Requer Node `>=24.11 <25`, pnpm **11.24.0**, dependências exatas e browsers do
Playwright da versão fixada. O build geral também requer Docker para o Sandbox.
Na raiz:

```sh
pnpm install --frozen-lockfile
pnpm --filter @holon/dashboard-browser-proof exec playwright install chromium firefox webkit
pnpm --filter @holon/dashboard-auth-proof test:coverage
pnpm --filter @holon/dashboard-auth-proof test:viability
pnpm --filter @holon/dashboard-ledger-proof test:coverage
pnpm --filter @holon/dashboard-browser-proof test:coverage
pnpm verify
```

O comando `test:viability` **termina com exit 1 neste candidato**: duas provas
de recuperação passam, duas de não reutilização concorrente de code falham nos dois adapters.
Deve ser executado separadamente; não se encadeiam os demais comandos atrás
dele como se seu exit fosse sucesso. Não há `it.fails`, patch do core ou teste
produtivo excluído da cobertura para tornar a integração viável.

`pnpm verify` executa os diagnósticos e provas pelo `test:coverage` do workspace.
A suite de viabilidade é um gate distinto, documentado e ainda NO-GO; CI verde
não satisfaz #129. A CI instala os três engines no Ubuntu e coleta cobertura,
JUnit e `proof-results/`, com retenção de sete dias. Testes browser não são
pulados por cache Turbo; o build declara seus outputs reais. Nenhum threshold
existente do core foi reduzido.

As fontes instrumentadas das bancadas auth/ledger preservam 90% de linhas,
funções/statements e 85% de branches. Browser prova comportamento no build real;
Playwright não fabrica cobertura percentual de fontes. Cada relatório descreve
oráculos e limitações e conserva o resultado das tentativas iniciais relevantes.

## Primeira integração local em 2026-10-05, antes do ajuste de linking

`pnpm install --frozen-lockfile` e `pnpm verify` passaram com Node 24.19.0 e
pnpm 11.24.0. O gate executou schema/config, formatação, lint, tipos, arquitetura,
testes/cobertura e builds/dry-runs, incluindo a imagem Docker do Sandbox.
Os workspaces existentes conservaram seus thresholds e comandos.

| Bancada | Resultado observado no gate integrado                                                              |
| ------- | -------------------------------------------------------------------------------------------------- |
| Auth    | 15 diagnósticos verdes; 100% linhas/funções/statements, 96,42% branches                            |
| Ledger  | 14 testes verdes; 100% da fonte instrumentada, incluindo persistência após teardown durante outage |
| Browser | 60 testes verdes: 20 cenários × Chromium/Firefox/WebKit, com compatibility date final `2026-10-01` |

Nessa primeira execução o gate auth separado terminou **exit 1, quatro falhas**
nas invariantes desejadas, com linking desativado. A atualização aprovada abaixo
substitui o resultado de recuperação, preservando o achado de state concorrente.
A primeira tentativa do gate geral parou na identidade gerada de configuração,
pois o lockfile entra no hash. O comando oficial `config:schema:generate`
regenerou o artefato e o gate completo passou na execução seguinte; não se
ignorou o check nem se editou o hash manualmente.

Os relatórios donos registram as tentativas iniciais relevantes: limite da
compatibility date auth, composição Query que revertia/corrompia ownership,
janelas de reidratação e revogação e limites dos helpers DO. Esses achados
foram corrigidos ou delimitados e seus cenários ficaram como regressões.
O sucesso local não afirma aprovação da CI remota, merge ou operação produtiva.

## Atualização de linking aprovada em 2026-10-05

Sem novas dependências ou mudança de runtime: Better Auth/Drizzle da prova usam
linking implícito padrão e lista vazia de providers que dispensem verificação.
Os novos testes falharam primeiro sob a política antiga e passaram após a alteração.

| Comando                       | Resultado atual                                                          |
| ----------------------------- | ------------------------------------------------------------------------ |
| Auth `test` / `test:coverage` | 42 passaram; 100% linhas/funções/statements e 96,42% branches do harness |
| Auth `typecheck`              | Passou                                                                   |
| Auth `test:viability`         | 2 passaram, 2 falharam; exit 1 por state concorrente                     |

A [prova dona](2026-10-05-dashboard-auth-proof.md#resultado-da-política-aprovada-em-2026-10-05)
registra cenários, oráculos e limites. A aprovação muda a política de email,
não a autoridade de workspace/convite/grant. **#129 e milestone 0 permanecem
bloqueados**. `pnpm verify` passou após esse ajuste: auth executou os 42 testes
com cobertura e browser executou os 60 cenários nos três engines. As tarefas
inalteradas usaram cache Turbo válido (22/24 de cobertura; 12/12 de build/dry-run).
Não houve reconstrução inédita dos artefatos inalterados. A primeira tentativa
desta atualização parou no lint por uma ordenação sem comparator; a asserção foi
corrigida para comparar o conjunto de subjects e o gate foi executado novamente.
O sucesso do gate geral não inclui `test:viability` e não demonstra CI, OAuth real
ou operação produtiva do novo código.

## Revisão normativa de OAuth e PKCE em 2026-10-05

A [avaliação do requisito](2026-10-05-dashboard-oauth-security-requirements.md)
confirma que PKCE pode proteger contra CSRF sem impor state atômico como mecanismo
único. O cliente ainda precisa não reutilizar code. A prova agora valida S256,
verifier, injeção de outro fluxo e downgrade na simulação externa; são **59 casos
diagnósticos verdes**, mantendo cobertura e os **dois casos concorrentes falhos**
no gate separado. Não se dispensou a obrigação normativa nem se demonstrou falha
de PKCE no GitHub real. A submissão repetida do mesmo code pelo cliente continua
bloqueando #129/M0; o comentário do requisito explica a diferença.

`pnpm verify` passou após essa revisão: auth executou os 59 testes com cobertura
e browser executou os 60 cenários nos três engines. Tarefas inalteradas usaram
cache Turbo válido (22/24 de cobertura; 12/12 de build/dry-run). O gate separado
`test:viability` foi reexecutado e terminou exit 1, com duas falhas por duas token
requests em vez de uma. Não houve validação OAuth remota ou deploy.

## Escopo da instalação e limites da evidência

As novas versões ficam nos manifests das bancadas. O catálogo, as versões
diretas de Agents/Think e os manifests de produção não foram atualizados.
O lockfile foi regenerado por pnpm a partir da base mergeada, preservando Vite
8.2.2 e Rolldown 1.2.6 existentes. A resolução compartilhada associa os novos
peers opcionais React e `@noble/hashes` também a snapshots existentes; isso é
visível no lockfile e coberto pelo gate completo, sem edição manual de snapshots. O comando oficial `config:schema:generate`
regenerou a identidade do compilador de configuração, cujo hash inclui o
lockfile; o schema JSON e as regras de configuração não mudaram.

Datas de compatibilidade são parte da prova: auth/ledger usam `2026-08-29` e
`nodejs_compat`, como o core; browser tem seu Wrangler isolado e data registrada
no relatório. Não generalizar suporte para outro binário ou compatibility date.
Versões/fontes externas foram revalidadas em **2026-10-05**, nos relatórios donos.

Não houve criação de recursos Cloudflare, OAuth/GitHub App real, secrets, banco
remoto, DNS, migrations produtivas, deploy ou envio de email. Teardown e exceções
controladas não são crash físico; alarms dirigidos pelo helper não provam sua
entrega regional. Os três engines locais também não comprovam duas versões de
cada browser, Safari iOS ou Chrome Android. Essas evidências pertencem às
entregas posteriores e a smokes explicitamente autorizados.

## Próximo gate

Manter #129 e suas dependências bloqueadas. Para avançar auth, decidir/provar
não reutilização concorrente de code por caminho oficialmente suportado e cumprir
as regressões de identidade/state/PKCE. Recuperação por linking com o mesmo email
verificado já passou; essa aprovação não dispensa a condição independente.
Se outra persistência for necessária, ela exige revisar
ADR/grafo, operação/restore e manter identidade, tenancy, convites e outbox na
mesma fronteira transacional. Nenhum desses efeitos foi iniciado neste PR.
