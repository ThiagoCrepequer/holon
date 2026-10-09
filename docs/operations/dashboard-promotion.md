---
id: OPERATIONS-DASHBOARD-PROMOTION
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Promoção e recuperação de Dashboard 6

## O que pode ser promovido?

Somente um artefato de SHA e ambiente identificados, com evidência de todos os
gates e autorização humana explícita para a operação. O PR de código não
autoriza recursos, secrets, DNS, migrations remotas, deploy ou envio real.
Os manifests preview são fechados e usam UUIDs/origem sintéticos; não são
recursos provisionados. A matriz de [evidência M6](../planning/dashboard-milestone-six-evidence.md)
registra as pendências. Não há deploy automático destes apps na CI.

Em 2026-10-09, o responsável dispensou o provisionamento de preview e autorizou
os deploys e validações diretamente em produção, além do ajuste da #165.
Os Workers produtivos existentes são atualizados; não criar duplicatas de teste.
Preview continua opcional e, quando usado, permanece isolado. A qualificação em
produção usa contas/repositórios de teste e destinatários explicitamente
autorizados, registra o inventário real e preserva dados, secrets e obrigações.
Essa decisão não encerra gates físicos, OAuth humano, provider, alertas ou PITR.
Não executar restore destrutivo de dados produtivos para fabricar prova: o ensaio
coordenado requer inventário, bookmarks, reconciliação e janela de manutenção.

## Inventário e responsáveis

`core-team` responde por admissão, schema, rollout e revisão do grafo; Thiago
Crepequer é o operador registrado da conta Cloudflare no bootstrap. O responsável
pela GitHub App aprova callbacks/permissões. Identificar nominalmente o operador
de cada promoção e o canal de incidentes antes da operação; não inferir plantão
ativo da existência deste documento.

| Superfície          | Local/CI                                              | Preview                                                                                      | Produção                                                                        |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Dashboard           | `holon-dashboard-local`, loopback, D1 `remote:false`  | `holon-dashboard-preview`, ingress desligado, auth off, hold fechado                         | `holon-dashboard`, origem registrada do bootstrap                               |
| Identidade/projeção | dois D1 sintéticos, estado isolado dos testes         | `holon-identity-preview` / `holon-projection-preview`, IDs terminados 11/12 são placeholders | `holon-identity` / `holon-projection`; UUIDs no manifest e runbook do bootstrap |
| Email               | `holon-email-delivery-local`, provider controlado/off | `holon-email-delivery-preview`, provider off, sender `.invalid`                              | `holon-email-delivery`, privado, sender explicitamente permitido                |
| Email Queue/DLQ     | `holon-email-jobs-local` / `holon-email-dlq-local`    | nomes com `-preview`                                                                         | `holon-email-jobs` / `holon-email-dlq`                                          |
| Core/DO/workflows   | harness isolado, GitHub controlado                    | `holon-control-plane-preview`, DO/workflows/Queue próprios                                   | `holon-control-plane`, ledger autoridade                                        |
| Executor            | dry-run e Sandbox local                               | `holon-repository-executor-preview`, broker preview, privado                                 | `holon-repository-executor`, broker core, privado                               |

O grafo RPC exato é validado em `tooling/deploy/dashboard-artifact.mjs`:
dashboard→core `DashboardReviewReader`; dashboard→email; email→dashboard
`EmailDeliveryAuthority`; core→dashboard `ReviewProjectionWriter` e
`GitHubAccessEvents`; core→executor; executor→core `GitHubCredentialBrokerEntrypoint`.
Bindings com alvo/entrypoint incorreto ou DO externo são rejeitados.

O responsável habilitou Email Sending para `crepequer.dev` em 2026-10-09.
O manifest de produção passa a usar `noreply@crepequer.dev`, com allowlist
do remetente e envio habilitado; local/preview continuam sem provider real.
Antes de enviar convites, conferir DNS e manter a visualização do conteúdo
dos emails desativada no domínio, pois o corpo contém links privados.
Configuração e domínio habilitado não demonstram entrega ou recebimento.
Na qualificação de 2026-10-09, o responsável autorizou explicitamente conservar
`Email content preview` habilitado temporariamente. Os envios de teste foram
executados sob essa exceção; a configuração permanece habilitada e sua
desativação posterior não foi executada. Isso não altera o padrão do runbook.
Preview exige inventário dos dois UUIDs produtivos para rejeitar também a
reutilização de um ID sob nome diferente.

Secrets não entram no artefato nem em logs. Inventariar **nomes/owners**, nunca
valores: dashboard `AUTH_SECRET`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`; credenciais GitHub/modelo do core conforme seu
[runbook](deployment.md). Preview recebe key material próprio e registro OAuth
próprio; não importar secrets produtivos. Email usa binding `EMAIL` com sender
restrito. Executor recebe credenciais efêmeras do broker privado, sem secrets
humanos no browser. Conferir os nomes efetivos pela API autorizada antes de
ativar qualquer ambiente; configuração local não demonstra seu isolamento real.

Artefatos sintéticos da CI têm retenção de sete dias. D1/DO/Queue/logs remotos
seguem o plano contratado e a política de [dados](../architecture/data-lifecycle.md).
Registrar retenção efetiva e bookmarks antes do rollout. Queue/DLQ são transporte;
perda de retenção não apaga a obrigação durável do job. Convites têm deadline de
sete dias e budget global de cinco tentativas; restore não renova esses valores.

## Build e identidade dos bytes

Em checkout limpo, SHA fixado, Node >=24.11 <25 / pnpm 11.24.0:

```sh
pnpm install --frozen-lockfile
pnpm verify
node tooling/deploy/dashboard-artifact-cli.mjs "$(git rev-parse HEAD)" local /tmp/holon-release-local
```

A CI executa essa sequência serial. O último comando cria um diretório novo,
recusa output existente/symlinks/source sujo e reconfere HEAD/estado depois da
coleta. Congela os quatro bundles, assets, configs, lockfile, fonte da barreira e
migrations identity/projection, por hash SHA-256 e tamanho; exclui mapas, estado
Wrangler e bundles de fixtures. Não publica, cria recurso ou migra banco remoto.
O manifest prova identidade dos bytes. A ordem do job, build e recibo de
verificação qualificam sua origem; congelar um dist antigo manualmente não prova
que ele veio do SHA declarado.

Para qualificar um ambiente remoto, construir os quatro componentes desse
ambiente na mesma revisão. O dashboard usa `CLOUDFLARE_ENV=preview` ou
`production` e os demais usam `wrangler deploy --env preview --dry-run --outdir
dist` ou produção conforme o manifest. O core/executor usam a configuração
default para produção. Preservar o output exato e conferir todos os bindings
compilados, não só os manifests de origem. A imagem do Sandbox precisa estar
publicada/qualificada por digest imutável em operação autorizada; `./Dockerfile`
não satisfaz o gate de promoção e não pode ser reconstruída entre ambientes como
se fosse o mesmo artefato. O gate de containers não publica imagens.

Preview e produção têm candidatos distintos por ambiente. Os smokes e gates
que qualificam a promoção de produção devem usar seus bytes congelados sob
tráfego restrito; a promoção abre o tráfego autorizado sem rebuild. O mesmo
SHA não torna builds distintos o mesmo artefato. Evidência de preview não
qualifica automaticamente o artefato de produção, e o preflight recusa a troca
de ambiente de um manifest já congelado.

`assertArtifact` reconfere todos os bytes. `assertPromotion` recebe os arquivos
congelados e deriva deles as configurações efetivas, sem aceitar um grafo
avulso. Também confere que nome, bindings, vars, ingress, crons e identidades D1
do dashboard compilado correspondem à fonte congelada; o adapter pode apenas
relocar os caminhos de migration. Trocar bindings, imagem ou modo depois de
congelar invalida a identidade. O preflight exige origem e
schemas instalados, SHA/ambiente de todas as provas, operador/autorização,
rollback com schemas idênticos e mesma implementação da barreira, e imagem
`@sha256` idêntica à configuração do executor. Evidências precisam de timestamp
válido, digest e execução nas últimas 24 horas: `verify`, `bilingual`,
`physicalBrowsers`, `remoteD1`, `oauthPrivate`, `emailProvider`, `recovery`,
`environmentAccess`, `rollback`. O gate `environmentAccess` pertence ao ambiente
do artefato: em produção comprova escopo das contas/repositórios/destinatários
de teste, controle de acesso e ausência de ingress público no sender/executor;
em preview comprova também proteção do domínio e isolamento de recursos.
Prova de preview não satisfaz esse gate de produção. Records sintéticos de unit tests só testam a política;
não autorizam nem substituem as provas reais. A função é preflight, sem deploy.

## Sequência operacional autorizada

1. Identificar conta, ambiente, SHA, artefato, imagem por digest, operador,
   autoridade da GitHub App e autorização com escopo de recursos/efeitos. Verificar
   ausência de público no sender/executor, escopo autorizado dos testes e controle
   de acesso produtivo. Quando houver preview, conferir também proteção de seu
   domínio e isolamento dos recursos. Placeholders abortam prontidão.
2. Registrar inventário remoto de bindings, secrets por nome, schemas/receipts,
   Queue/DLQ, workflows, callbacks, origem/cookies, versões e backups. Conferir
   invariantes e migrations pendentes sem PII; não executar reset.
3. Aplicar apenas migrations autorizadas, com bookmark e teste de restore.
   Preservar `AUTH_SECRET`; sua rotação segue o runbook de identidade. Publicar os
   componentes do mesmo contrato, com sender inicialmente off e tráfego restrito.
4. Executar OAuth humano real: conta pessoal permitida/negada, organização admin
   e membro, link/unlink, revogação humana/App, grants expirados, convite para
   alvo novo verificado, aceite único e último owner. Executar sender/Queue/cron
   com destinatários de teste autorizados, incluindo resultado desconhecido.
5. Executar benchmark D1 remoto e drill coordenado abaixo; testar alertas reais,
   Safari/Chrome/Firefox nas duas últimas versões estáveis, Safari físico e
   dispositivo móvel físico. Emulação não satisfaz esses gates.
6. Conferir evidências/rollback com `assertPromotion`, abrir tráfego restrito,
   validar observação e ampliar somente após estabilidade. Não chamar o MVP de
   promovido enquanto qualquer gate estiver pendente. Falha conserva o hold.

## Barreira independente e restore coordenado

`DASHBOARD_RECOVERY_MODE` é configuração de implantação fora do D1 restaurado.
Ausência/valor inválido fecha o serviço. `closed` bloqueia HTTP privado/público,
cron, novos claims/start de email e writes de projeção. `rebuilding` mantém
HTTP/cron/email fechados e permite reconstrução pelo writer privado, com a cerca
D1 vigente. `active` só depois da reconciliação. Registrar resultado causal de
email em voo continua permitido: pausa não cancela efeito externo.

1. Fechar dashboard/claims/writer por configuração independente e pausar ingress,
   Queue consumers/produtores do escopo. Registrar sessões/revogações,
   memberships removidas, budget/deadline, efeitos externos e inventário completo
   dos ledgers/projeções. Guardar estado **antes** de Time Travel.
2. Abrir a cerca D1 por `beginRecovery(g)` privado. Restaurar identidade/DO/D1
   pelos procedimentos autorizados, preservando um caminho de rollback. Restaurar
   a projeção de um backup não pode restaurar a cerca antiga: instalar nova cerca
   depois da operação antes de aceitar qualquer writer.
3. Invalidar sessões/provas/grants restaurados e reconciliar memberships contra
   revogações confiáveis. Não reabrir com estado de permissão do backup. Reconciliar
   accepted/canceled/unknown e orçamento de email com receipts conhecidos, sem
   zerar tentativas/deadlines e sem atribuir geração nova a tentativa antiga.
4. Em `rebuilding`, executar `resumeProjection` de cada ledger restaurado com sua
   geração efetiva e a nova cerca D1, conforme o [runbook de projeção](dashboard-review-projection.md).
   Reconstruir somente leitura; não relançar review, editar checkout/head,
   remover cleanup/checks ou devolver membership pelo replay.
5. Conferir inventário completo, geração/revisão, nenhuma linha antiga, alarm
   durável e tarefas de efeitos. `activateRecovery` é CAS, não bypass de inventário.
   Repetir capturas antigas e mensagens Queue: devem ser fenced/terminais, sem
   novo budget ou acesso. Falha mantém HTTP fechado.
6. Reabrir por `active` após prova/owner; observar recuperação dos sinais e
   rejeição das sessões/revogações antigas. Rollback de código não desfaz schema
   nem email. Um rollback sem a mesma barreira/schema é recusado pelo preflight.

O teste local integrado usa D1 real com índice 100→60, nova geração, entrega
100/g antiga, identidade revogada, resultado tardio aceito e mensagem Queue
antiga. O core testa separadamente DO/alarm/geração e limpeza. Esses testes não
demonstram PITR Cloudflare coordenado de quatro autoridades; a execução remota
continua gate obrigatório, com duração, receipts e inventário a registrar.

## Sinais, limites e resposta

Logs contêm eventos fixos, códigos/contagens/duração; nunca emails, URLs OAuth,
prompts/diffs, bodies ou mensagens arbitrárias de erro. Invocation logs continuam
off. `projection_read` registra rows_read/returned/duração; `private_review_read`
registra list/detail por código e sucesso/falha, sem coordenadas privadas;
`dashboard.projection_attempt/result/retry` registra attempt, idade da fonte e
duração. Idade de fonte estável não é lag de uma tarefa pendente. A admissão
de grants emite `github_authority_health` sem IDs privados; o agendamento de
manutenção emite `dashboard.alarm_health` e propaga a falha original, preservando
rollback transacional e a obrigação durável.

| Sinal                                       | Limite                                 | Responsável / ação / recuperação                                                                     |
| ------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `email_health` code 2                       | overdue >300000 ms: cinco janelas cron | core-team: conferir D1/cron/Queue/publisher; code 0 após retomada                                    |
| `email_health` code 1                       | qualquer resultado unknown             | core-team: reconciliar tentativa causal/provider; não afirmar inbox delivery                         |
| `email_dlq`                                 | qualquer mensagem, count limitado a 10 | operador: conferir causa e job durável antes de replay; nunca resetar budget                         |
| `dashboard.projection_retry` code 2         | attempt >=6                            | core-team: conferir writer/hold/bindings/D1/alarm; `projection_health` code 0 após applied/duplicate |
| `dashboard.projection_health` code 1        | fenced/stale/conflict                  | core-team: revisar geração/recuperação; não mudar payload para obter ACK                             |
| `private_review_read` code 1 / HTTP 401/403 | perda de autoridade observada          | responsável GitHub: reconectar/verificar grants; não ampliar permissão para calar alerta             |
| `github_authority_health` code 1/2/3        | denied/reconnect/outage observado      | responsável GitHub: verificar sessão/grants/provider; code 0 após admissão atual                     |
| `dashboard.alarm_health` code 1             | falha getAlarm/setAlarm                | operador: conferir scheduler e obrigação; code 0 após agendamento válido, sem apagar tarefa          |
| falha cron                                  | exceção runtime, retry não progride    | operador: conferir scheduler e próximo wake durável; não apagar a obrigação                          |

Os eventos são instrumentação local. O operador deve configurar alertas remotos,
canal/owner nominal, janelas/retention e comprovar disparo **e recuperação** antes
de promoção; esta mudança não cria um serviço de alertas nem envia notificações.
O runbook não prova monitor ativo. Os testes usam falhas controladas e verificam
terminalidade/privacy; o gate real de alertas permanece aberto em #166.

Fontes primárias verificadas em 2026-10-09:
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
(janela depende do plano; free sete dias, paid trinta),
[rollbacks Workers](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/),
[Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/) e
[Workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).
