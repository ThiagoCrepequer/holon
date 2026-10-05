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

**Auth:** falha entre User e Account deixa User órfão. Remover a falha e iniciar
OAuth com state/code novos não recupera: `account_not_linked`, sem sessão.
O adapter D1 nativo oficial repete o resultado. Email alterado pode criar outro
User, conservando o órfão; fundir por email ou acrescentar hook não é recuperação
íntegra. O relatório registra alternativas suportadas e suas consequências;
PostgreSQL transacional é proposta para decisão/prova, não troca já aprovada.
A condição adicional de consumo concorrente de state também precisa ser
resolvida, sem inferir takeover do simples número de trocas no provider.

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

O comando `test:viability` **termina com exit 1 neste candidato**: quatro asserts
comuns falham nos dois adapters (cadastro interrompido e state concorrente).
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

## Resultado da integração local em 2026-10-05

`pnpm install --frozen-lockfile` e `pnpm verify` passaram com Node 24.19.0 e
pnpm 11.24.0. O gate executou schema/config, formatação, lint, tipos, arquitetura,
testes/cobertura e builds/dry-runs, incluindo a imagem Docker do Sandbox.
Os workspaces existentes conservaram seus thresholds e comandos.

| Bancada | Resultado observado no gate integrado                                                              |
| ------- | -------------------------------------------------------------------------------------------------- |
| Auth    | 15 diagnósticos verdes; 100% linhas/funções/statements, 96,42% branches                            |
| Ledger  | 14 testes verdes; 100% da fonte instrumentada, incluindo persistência após teardown durante outage |
| Browser | 60 testes verdes: 20 cenários × Chromium/Firefox/WebKit, com compatibility date final `2026-10-01` |

O gate auth separado foi executado e terminou **exit 1, quatro falhas** nas
invariantes desejadas, sem erro de fixture usado como causa do NO-GO.
A primeira tentativa do gate geral parou na identidade gerada de configuração,
pois o lockfile entra no hash. O comando oficial `config:schema:generate`
regenerou o artefato e o gate completo passou na execução seguinte; não se
ignorou o check nem se editou o hash manualmente.

Os relatórios donos registram as tentativas iniciais relevantes: limite da
compatibility date auth, composição Query que revertia/corrompia ownership,
janelas de reidratação e revogação e limites dos helpers DO. Esses achados
foram corrigidos ou delimitados e seus cenários ficaram como regressões.
O sucesso local não afirma aprovação da CI remota, merge ou operação produtiva.

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
uma composição oficialmente suportada que recupere User/Account e cumpra as
regressões de identidade/state. Uma alternativa de persistência exige revisar
ADR/grafo, operação/restore e manter identidade, tenancy, convites e outbox na
mesma fronteira transacional. Nenhum desses efeitos foi iniciado neste PR.
