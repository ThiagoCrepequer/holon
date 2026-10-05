---
id: RESEARCH-2026-10-05-DASHBOARD-LEDGER-PROOF
kind: research
status: current
date: 2026-10-05
verified-at: 2026-10-05
last-reviewed: 2026-10-05
owners:
  - core-team
related:
  - ../planning/dashboard-implementation-plan.md
  - 2026-10-04-dashboard-read-model-investigation.md
  - ../engineering/testing-and-evidence.md
---

# Prova local de revisão, obrigação e alarm no ledger

## Pergunta e resultado

DASH-04 / issue #131 exige verificar a primitiva que poderá sustentar a projeção
no ledger SQLite existente: uma mutação não deve confirmar revisão/obrigação
sem confirmar também seu próximo wake-up.

**GO para a primitiva local `storage.transaction(async ...)` com SQL e
`await storage.setAlarm(...)` na mesma closure. NO-GO para `transactionSync`
seguido de `setAlarm` separado.** Nos cenários exercitados, o primeiro caminho
confirma ou desfaz revisão, tarefa e agendamento juntos; no segundo, a interrupção
após commit SQL conserva tarefa sem alarm, inclusive depois de recriar a instância.
Isso permite avançar a integração planejada; não declara a projeção do core
implementada nem aprova operação remota.

A prova fica em [tooling/dashboard-ledger-proof](../../tooling/dashboard-ledger-proof/README.md).
É workspace privado de teste, sem comando/configuração de deploy ou export de
biblioteca. A implementação do ledger, seus contratos de execução e suas migrações não
foram alterados. A integração do PR regenera somente a identidade gerada do
compilador de configuração exigida pela mudança do lockfile, conforme o
[relatório consolidado](2026-10-05-dashboard-milestone-zero-results.md).

## Ambiente e oráculo

Verificado em **2026-10-05**, sobre a base `f348569eb31800649930327a69c139902d96acf9`:

| Item                         | Configuração efetivamente exercitada                    |
| ---------------------------- | ------------------------------------------------------- |
| Node                         | 24.19.0                                                 |
| pnpm                         | 11.24.0; instalação compartilhada pelo coordenador      |
| Vitest / provider            | 4.1.11 / Istanbul 4.1.11                                |
| Plugin oficial Workers       | `@cloudflare/vitest-plugin` 1.1.2                       |
| Runtime transitivo do plugin | Miniflare 5.20260828.0-alpha / Workerd 1.20260828.1     |
| Compatibility date / flag    | `2026-08-29` / `nodejs_compat`, iguais ao control plane |
| Storage                      | Durable Object SQLite real no Workerd local             |

Cada teste consulta SQL e `getAlarm()` reais por `runInDurableObject`; não usa
mapa ou fake de storage que reproduza o algoritmo. Esperados são revisões,
conteúdo, deadlines, tentativas, tarefas e ausência/presença de alarm conhecidos.
O construtor só inicializa tabelas; não cria wake-up para corrigir uma obrigação
perdida. `abortAllDurableObjects()` descarta instâncias sem apagar dados e permite
consultar persistência após recriação.

A projeção externa é uma porta controlada: sucesso, rejeição ou espera. O caso
concorrente usa RPC real a outro DO do harness, que segura a resposta; uma nova
mutação chega ao ledger antes do término da chamada anterior. Não há D1 remoto,
GitHub, segredo, usuário, conteúdo privado ou destino de email.

## Cenários executados

| Garantia / contraprova                           | Observação no runtime local                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Commit atômico                                   | Revisão 1, conteúdo, obrigação da revisão 1 e alarm no mesmo prazo                                              |
| Falha antes de agendar                           | Exceção dentro da transação preserva revisão/tarefa/alarm anteriores                                            |
| Falha depois de `setAlarm`, antes do commit      | Também restaura o agendamento anterior, sem deixar SQL parcial                                                  |
| Falha após commit / teardown local               | Revisão, obrigação e alarm confirmados continuam após descarte/recriação da instância                           |
| Callback `transactionSync` interrompido          | SQL sofre rollback; callback permanece estritamente síncrono                                                    |
| Commit SQL seguido de interrupção antes do alarm | Contraprova: revisão/tarefa persistem com alarm ausente; construtor não mascara a janela                        |
| Quatro responsabilidades / prazos                | Cleanup, supersession, checks e projeção usam o menor vencimento; agendar depois não posterga trabalho anterior |
| Claim e rearm antes de efeito                    | Porta observa tentativas persistidas e próximo alarm antes do efeito                                            |
| Aborto da transação claim/rearm                  | Exceção dentro da closure após `setAlarm` reverte claims/agendamento; nenhum efeito inicia                      |
| Falha de projeção                                | Rejeição controlada conserva obrigação; cleanup/checks/supersession devidos concluem                            |
| Outage além de seis tentativas                   | Sete rejeições conservam alarm, inclusive após teardown; oitava conclui sem nova mutação de negócio             |
| Revisão nova durante I/O                         | Ack da revisão 1 não apaga tarefa da revisão 2; segunda execução entrega conteúdo novo                          |
| Porta sem configuração                           | Trabalho permanece pendente, sem confirmação fictícia de sucesso                                                |

O teste de aborto da transação claim/rearm chama o handler pelo helper de inspeção,
capturando a exceção no próprio DO. O alarm original não foi consumido pelo
scheduler nessa invocação direta. Ele injeta exceção antes de tentar o commit e demonstra rollback/ausência de efeito;
não demonstra retries nativos depois de uma falha real de storage com evento
já consumido. Esse incidente continua exigindo detecção e recuperação operacional.

## Comandos e evidência

Na raiz, após instalar o workspace com o lockfile do PR:

```sh
pnpm --filter @holon/dashboard-ledger-proof test
pnpm --filter @holon/dashboard-ledger-proof test:coverage
pnpm --filter @holon/dashboard-ledger-proof typecheck
```

Na elaboração, executados diretamente em `tooling/dashboard-ledger-proof` para
não disparar instalação automática concorrente do pnpm:

```sh
./node_modules/.bin/vitest run --config vitest.config.ts --coverage
./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

**14 testes passaram**, sem erros não tratados no resultado final. Cobertura
Istanbul de todo `src/**/*.ts`: linhas **49/49**, statements **56/56**, funções
**14/14** e branches **16/16**, todos **100%**. Thresholds preservados: 90% de
linhas/statements/funções e 85% de branches, sem exclusão de fonte para obter
verde. `coverage/coverage-summary.json` e `coverage/lcov.info` são artefatos
locais regeneráveis; não contêm prova de operação produtiva.

Lint e typecheck do workspace passaram. Formatação usa a configuração do Holon;
o gate completo da composição/PR é responsabilidade da integração desta entrega.

## Limites e consequência para a implementação

- Antes do commit, falhas são exceções injetadas que exercitam rollback real.
  Depois do commit, há exceção e teardown oficial local. O teste de outage
  também descarta a instância após a sétima falha e confirma tarefa/alarm na
  instância recriada, reinstalando somente o controle do efeito externo. Isso não é interrupção
  de processo/disco/região ou crash físico da plataforma; não usamos eviction
  graciosa como sinônimo de crash.
- `Date` é controlado no isolate; os deadlines ficam em 2099 para evitar disparo
  automático de wall clock. `runDurableObjectAlarm` executa/remove o alarm
  persistido. O driver avança o relógio e solicita cada execução existente;
  leituras de inspeção não agendam trabalho. Não simula nem comprova o backoff
  automático da plataforma, entrega regional ou seu limite de seis retries.
- A recuperação após sete rejeições prova a obrigação/rearmamento da aplicação,
  independente de uma nova request de negócio, com storage saudável durante a
  indisponibilidade do efeito externo. Não promete retry infinito se
  storage/runtime não conseguirem confirmar o próximo wake-up.
- `retryDelay=1000` é fixture determinística, não política de produção. O harness
  processa até quatro tipos de tarefa. Integração futura requer trabalho limitado,
  timeout/cancelamento por efeito, backoff/jitter e orçamento operacional medidos.
  Efeitos sequenciais sem deadline poderiam bloquear manutenção se a projeção
  nunca respondesse; a prova cobre rejeição e resposta controladas, não esse hang.
- A porta de projeção não grava D1. Não prova UPSERT, restauração/PITR, migração
  do ledger existente, propagação de metadados, ACL, UI, escala ou latência.
- Ao integrar no core, toda mutação observável e seu próximo wake-up precisam
  usar a primitiva comprovada; reaproveitar os dois passos atuais sem a fronteira
  atômica preservaria a contraprova. A revisão do snapshot não é `runId`,
  `causalVersion` nem revisão de uma tarefa Check Run.

## Fontes primárias conferidas em 2026-10-05

- [Storage SQLite: transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction):
  callback de `transactionSync` não admite Promise; em SQLite a transação async
  inclui operações feitas diretamente em `ctx.storage`, também SQL.
- [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/):
  um agendamento por objeto, substituição por `setAlarm`, execução pelo menos uma
  vez e até seis retries automáticos. A aplicação precisa conservar próxima ação.
- [Test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/):
  inspeção dentro do DO, execução dirigida de alarm e teardown sem excluir storage.
- [Integração oficial Vitest](https://developers.cloudflare.com/workers/testing/vitest-integration/):
  composição local de testes Workers; não substitui smoke remoto autorizado.

Não houve deploy, criação de recurso remoto, binding produtivo, envio ou mudança
no runtime de produção. Este resultado responde ao gate DASH-04 do milestone 0.
