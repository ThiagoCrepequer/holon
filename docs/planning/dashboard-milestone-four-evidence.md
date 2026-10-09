---
id: DASHBOARD-M4-EVIDENCE
kind: evidence
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Dashboard 4 · Email recuperável

Milestone GitHub **#5**, issues **#150–#153**, sobre `main` após merge de #181.
Esta matriz distingue implementação/prova local e ativação operacional. O
[runbook](../operations/dashboard-email-delivery.md) é dono das regras de entrega.

| Issue/critério                              | Implementação e oráculo                                                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #150 Interface limitada, sem acesso público | Entrypoint privado claim/start/record, contracts strict, HTTP 404, sender só importa contracts e não possui D1; RPC do bundle independente é exercitado em Workerd                                   |
| #150 Estado auditável e budget              | Migration aditiva 0012, tentativas com UUID/geração/lease, contador anterior ao efeito; queries D1 independentes verificam concorrência, replay e crash                                              |
| #150 Resultado tardio                       | Histórico aceita sucesso de tentativa iniciada antiga; geração/lease nova permanecem iguais e `start` novo retorna null                                                                              |
| #151 Vencimento de todo não terminal        | `next_action_at` persistido desde criação até terminalidade; publisher e reconciliação bounded por cron; teste elimina referência/registro e recupera sem request                                    |
| #151 Outage longa/retenção                  | D1 não depende de retenção Queue/DLQ; a referência é recriada preservando job/deadline/attempts. Teste simula perda completa e vencimento, não espera retenção cronológica real                      |
| #151 Operação                               | Apenas contagens/idade e sinal de DLQ, limites e recuperação manual no runbook                                                                                                                       |
| #152 Consumer e templates                   | Batch/ack oficiais, RPC+D1 real local, provider controlado; HTML/texto en/pt-BR, escaping, header injection negada e origem fixa                                                                     |
| #152 UI/privacidade                         | Copy explica intenção, provider, inbox não confirmado, desconhecido, falha, interrupção e duplicata; browser com build real, identidade sintética e autoridade privada                               |
| #152 Provedor configurável                  | Binding nativo send_email, builder estruturado suportado pelos tipos atuais, remetente restrito, efeitos disabled por default. Domínio/conta/email real continuam dependentes de operação autorizada |
| #153 Budget/backoff/deadline                | Cinco claims globais, prazo do convite, backoff durável e distinção permanente/transitório/desconhecido; transporte não reinicia contadores                                                          |
| #153 DLQ/replay                             | Mesmo consumer consulta autoridade atual; terminal/budget esgotado não revive; crash pós-provider pode duplicar mensagem do mesmo convite, sem novo convite/membership                               |
| #153 Cancelamento/resultado perdido         | Cancelamento antes de start impede efeito; depois da autorização não cancela provider. D1 indisponível deixa tentativa contabilizada e obrigação durável; retry de persistência não repete provider  |

## Execuções

A primeira execução do novo teste de claim, em 2026-10-09, falhou na importação
do módulo ainda ausente; não foi uma regressão observável do código antigo. Após
implementar o protocolo, os cenários de D1 passaram. As provas de composição
controlam somente o provider e falhas de fronteira; não replicam o algoritmo D1.

- `pnpm --filter @holon/db test:coverage`: passou com limites 90/85 preservados.
- `pnpm --filter @holon/email-delivery test:coverage`: passou, incluindo timeout
  e aceitação tardia, com limites preservados.
- `pnpm --filter @holon/dashboard test:workers`: passou, incluindo publisher.
- Regressão adicional: referência duplicada após lease expirada reservava geração 2 antes da reconciliação; o teste falhou pelo claim indevido. A correção exige lease reconciliada (zero) e retry_at vencido.
- Gate completo e revisão final serão registrados neste arquivo após conclusão.

## Limites e revisão

Previews gerados com destinatários/origem sintéticos: [pt-BR HTML](email-previews/invitation-pt-BR.html), [pt-BR texto](email-previews/invitation-pt-BR.txt), [en HTML](email-previews/invitation-en.html), [en texto](email-previews/invitation-en.txt). Inspeção em Chromium a 320 px e 640 px não apresentou overflow.

Templates usam texto e tokens da identidade atual, sem tracking; previews
sintéticos podem ser inspecionados no PR. Revisão local não presume aprovação
editorial humana nem renderização em Gmail/Outlook/dispositivos reais.
Queue/DLQ/cron reais, email a destinatário novo, DNS, quota e inbox não foram
validados. Nenhuma migration aplicada foi editada, nenhum threshold reduzido,
nenhuma biblioteca contornada e nenhuma autoridade alternativa adicionada.

O encerramento por merge cobre o milestone de implementação. A ativação remota
continua desabilitada e exige as condições explícitas do runbook; não se infere
deploy ou sucesso de email a partir de CI verde.
