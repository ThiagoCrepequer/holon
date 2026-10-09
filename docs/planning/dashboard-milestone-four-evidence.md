---
id: DASHBOARD-M4-EVIDENCE
kind: evidence
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Dashboard 4 · Email recuperável

Milestone GitHub **#5**, issues **#150–#153**, sobre `main` após merge de #181
(base `6dcb7e5279a0b413985d401cc90290a62a1f39a9`). Implementação em `168b600`,
complemento dos oráculos de composição em `68a5deb`; ajustes finais acompanham
este relatório no mesmo PR.
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

- `pnpm --filter @holon/db test:coverage`: 160 testes passaram; cobertura
  95,06% statements, 87,17% branches, 100% funções e 95,98% linhas.
- `pnpm --filter @holon/email-delivery test:coverage`: 21 testes passaram,
  incluindo timeout e aceitação tardia; cobertura 97,72% statements, 96,61%
  branches, 91,66% funções e 98,76% linhas.
- `pnpm --filter @holon/dashboard test:workers`: 92 testes passaram, incluindo
  publisher; o gate completo também executou seus 144 testes Node, cobertura de
  ambas as suites e 12 cenários de fundação + 39 de auth/tenancy/convites/email
  em Chromium, Firefox e WebKit. A bancada browser M0 passou seus 60 cenários.
- `pnpm verify`: passou em 2026-10-09 com Node 24.11.0 e pnpm 11.24.0;
  inclui marca, schemas/config, formatação, lint, tipos, arquitetura, cobertura,
  browsers, builds/dry-runs e imagem Docker. Os thresholds existentes foram
  preservados; Turbo reutilizou resultados locais válidos conforme seus hashes.
- `CLOUDFLARE_ENV=production pnpm --filter @holon/dashboard build` e
  `pnpm --filter @holon/email-delivery exec wrangler deploy --env production --dry-run --outdir dist`:
  passaram, incluindo bindings privados e configuração de envio desabilitada.
- Regressão adicional: referência duplicada após lease expirada reservava geração 2 antes da reconciliação; o teste falhou pelo claim indevido. A correção exige lease reconciliada (zero) e retry_at vencido.
- O gate também expôs uma guarda antiga de bundle que exigia zero services;
  agora exige exatamente o binding privado do ambiente. Traces de browser
  mostraram cliques após OAuth sobre HTML SSR antes de scripts carregados;
  helpers passaram a aguardar o carregamento da navegação. IDs sintéticos e
  seletores pt-BR foram corrigidos. Asserts, timeouts e zero retries permanecem.

## Revisão de encerramento

Revisões independentes de padrões e de aderência às issues, incluindo o diff
final, terminaram sem achados sustentados pendentes. A revisão de aderência
identificou inicialmente duas lacunas de evidência, corrigidas em `68a5deb`:
batch misto com ack/retry individuais e cancelamento durante provider em voo
com falha do registro D1. Os testes compõem RPC e persistência reais locais,
observam estado por queries independentes e contam efeitos do provider.

Os critérios de implementação de #150–#153 estão rastreados nesta matriz. A
aprovação editorial dos previews e os gates operacionais de promoção continuam
explícitos abaixo, sem inferir resultados remotos.

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
