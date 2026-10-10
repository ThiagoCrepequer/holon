---
id: DASHBOARD-EMAIL-DELIVERY
kind: runbook
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Entrega recuperável de convites

Este documento descreve o código de Dashboard 4 (#150–#153), não um deploy.
Nenhum recurso, DNS, migration remota ou email real foi operado nesta entrega.
O estado implantado datado permanece no [runbook de ambientes](dashboard-environments-and-recovery.md).

## Autoridade e transporte

O convite e `invitation_delivery_intent` são criados na mesma transação D1.
`EmailDeliveryAuthority`, entrypoint privado do dashboard, expõe somente
`claim`, `start` e `record`, com contratos strict em `contracts/email-delivery`.
Somente o binding `EMAIL_AUTHORITY` do sender recebe essa capability. HTTP
retorna 404; sender não tem D1, sessão, token GitHub ou acesso a memberships.
Queue/DLQ carregam exclusivamente `{ jobId }`; esse ID nunca autoriza um envio.

O claim incrementa o orçamento global antes do efeito e reserva uma geração,
UUID de tentativa e lease de 120 segundos. `start` é de uso único: revalida
convite pendente, expiração, prazo, lease atual e ausência de aceitação conhecida,
então libera email, nome do workspace, idioma e validade. O contexto não sai em
HTTP público, Queue ou logs. Há uma janela entre essa autorização e o provider:
cancelar ou perder lease não pode desfazer uma chamada externa já autorizada.

Cada resultado pertence a `(jobId, attemptId, generation)`. Resultado antigo
fica no histórico e não altera a lease atual. Aceitação tardia de uma tentativa
iniciada pode atualizar resultado desconhecido e impede `start` futuro, mesmo
se outra tentativa já foi claimed. Se outra chamada já começou, não é cancelável.
Aceitação após cancelamento não reabre o convite nem cria participação.

## Vigília e limites

Cron a cada minuto reconcilia e publica no máximo 50 jobs. O publisher reserva
publicação no D1; chama `EMAIL_DELIVERY.wake({ operationId })`; registra publicação
somente após resposta aceita, que significa inserção da referência na Queue.
Falha ou crash antes/depois desse registro preserva `next_action_at`.
Referência perdida, sem consumer ou além da retenção é recriada pela vigília
sem request de usuário, com o mesmo convite, prazo e orçamento.

| Regra                               | Valor e efeito                                                |
| ----------------------------------- | ------------------------------------------------------------- |
| Prazo                               | Até 7 dias, limitado também à validade do convite             |
| Orçamento                           | 5 claims persistidos por job; crash após claim também consome |
| Publicação incerta                  | Nova elegibilidade em até 60 segundos                         |
| Publicado sem progresso             | Nova referência em até 5 minutos                              |
| Lease                               | 120 segundos; não cancela o provider                          |
| Timeout do provider                 | 15 segundos; resultado desconhecido                           |
| Backoff após falha/crash            | 1, 5, 15 e 60 minutos, truncados pelo prazo                   |
| Persistência do resultado conhecido | Até 3 chamadas do mesmo resultado, sem novo envio             |
| Queue principal                     | Batch 10, 3 retries nativos, atraso de 60 segundos, DLQ       |
| DLQ                                 | Mesmo consumer e autoridade; retenção não decide validade     |

Erro codificado de validação/remetente/supressão/rejeição é permanente. Quota,
rate limit e erro interno documentados são transitórios. Código desconhecido,
timeout, acknowledgement inválido ou crash após provider são desconhecidos.
Q37 permite duplicata limitada da **mesma mensagem de convite**, nunca novo
convite ou membership. Na retomada de crash, a lease expirada vira histórico
desconhecido e aplica o mesmo backoff. O último claim termina no vencimento da
lease se seu resultado não foi persistido; prazo pode terminar antes.

Ack é individual após registro durável. Payload inválido não libera contexto e
é descartado. Claim/start negado pode ser acked porque a autoridade preserva a
próxima ação ou terminalidade. D1/RPC indisponível solicita retry; se a mensagem
sumir depois, D1 continua dono da recuperação. Quando o resultado conhecido não
pode ser registrado, seu efeito continua contabilizado; recuperação segue Q37.

## Templates e experiência

HTML com tabelas e estilos inline e texto simples em `pt-BR`/`en`; sem imagem
remota, tracking, CSS/browser do dashboard ou headers customizados. O único attachment é a
Semente oficial como PNG inline CID, sem fetch remoto; alt e assinatura textual
preservam identidade com imagens bloqueadas. Cores/asset são gerados da fonte
canônica por `pnpm brand:generate`, conferidos por `pnpm brand:check`.
Cor, papel e tinta seguem os tokens Holon, com fallback claro e regra de dark mode; fontes usam fallback local de email.
Nome de workspace é escapado em HTML, destinatário/remetente validados; assunto
é fixo. Links usam exclusivamente `APP_ORIGIN` HTTPS sem path/credenciais e o
ID validado. Idioma é escolhido explicitamente no convite pelo locale ativo do
owner: não se infere país/domínio nem preferência desconhecida do destinatário.

O owner vê intenção agendada, aceitação pelo provider, resultado desconhecido,
falha ou interrupção de futuras tentativas. Aceitação não confirma inbox. Texto
do template e da UI explica duplicação limitada e chamadas em trânsito.
Os previews sintéticos servem para revisão do PR; não são entrega em clientes
de email reais nem aprovação editorial humana presumida.

## Ativação autorizada

Os manifests mantêm `EMAIL_SEND_ENABLED=false` e remetente sintético restrito.
O worker não reserva claims nesse estado. Antes de habilitar, o operador da
`core-team` precisa de autorização separada e deve:

1. Confirmar ambiente, SHA, disponibilidade do Email Sending beta, plano/quota,
   domínio em Cloudflare DNS, SPF/DKIM/DMARC e remetente aprovado.
2. Criar as Queues principal/DLQ do ambiente e aplicar somente a nova migration
   `0012_email_delivery_attempts.sql`, preservando `0010` e obrigações existentes.
3. Substituir `EMAIL_FROM` e `allowed_sender_addresses` juntos, conferir origem e
   os bindings recíprocos privados, consumers e cron; publicar artefatos aprovados.
4. Habilitar `EMAIL_SEND_ENABLED=true` somente após essas condições. Provar com
   destinatário de teste autorizado fora da lista verificada, anotando aceitação
   e observação de inbox separadamente. Nenhum desses efeitos faz parte de CI.

Fontes atuais consultadas em 2026-10-09:
[Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
oferece builder estruturado e `messageId`;
[send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
descreve restrições de remetente e também destino verificado. A página atual de
[limites](https://developers.cloudflare.com/email-service/platform/limits/) esclarece
que, após onboarding de domínio de envio, qualquer destinatário é permitido.
A descrição de bindings omite essa condição; a disponibilidade/configuração da
conta real e o smoke autorizado continuam gates de ativação.
[Local sending](https://developers.cloudflare.com/email-service/local-development/sending/)
avisa que simulação nativa escreve conteúdo em console/arquivos; os testes Holon
usam provider controlado e dados sintéticos. Não usar simulação nativa com PII.
[DLQ](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
é mecanismo de transporte; o vencimento do negócio permanece no D1.

## Diagnóstico e recuperação manual

Responsável: `core-team`. O cron emite apenas `email_backlog` com contagem
pending/due e menor vencimento. Consumer de DLQ emite `email_dlq` com contagem
limitada a 10. Não há email, link, workspace, token, payload nem exceção livre
nesses logs. Alarmar ausência do cron, crescimento/idade de due e DLQ repetida;
50 jobs por minuto é capacidade limitada, não promessa de latency sob carga.

Com acesso restrito e autorização operacional, consultar agregados de
`invitation_delivery_intent` por estado, due e idade. Investigar IDs causais em
`email_delivery_attempt` sem exportar destinatários. Conferir cron, D1, bindings,
quotas, provider e consumers antes de qualquer replay. Restaurar esses serviços
retoma a vigília automaticamente. Confirmar a próxima execução do cron
configurado e acompanhar a redução de due, sem editar contadores nem reiniciar
deadline. O [teste manual de scheduled](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
documentado em 2026-10-09 é uma ferramenta da bancada local.

Replay de DLQ usa só o mesmo ID e passa por claim/start. Terminais e orçamento
esgotado não são reabertos. Falha permanente/prazo esgotado exige um novo convite
explicitamente solicitado pelo owner, com novo ID; não reviver o antigo. Ao
pausar envio, desabilitar o sender preserva o banco; obrigações podem expirar.
Restore deve preservar convite, intents e histórico juntos; a recuperação de
backup que perde tentativas externas requer reconciliação operacional antes de
habilitar efeitos, conforme o runbook de ambientes.

## Evidência local

`packages/db/test/email-delivery.test.ts` testa D1/migrations/concurrency,
budget, backoff, interrupção, publicação perdida, terminalidade e resultado
tardio. `apps/email-delivery/test/delivery.test.ts` compõe autoridade construída
separadamente, RPC Workerd, D1 real local, batch/ack oficiais e provider controlado.
`apps/dashboard/test/email-publisher.worker.ts` testa vigília e outage; browser
verifica estados e copy. O relatório do milestone registra comandos/resultados.
Nada disso demonstra envio real, DNS, retenção cronológica no provedor ou inbox.
