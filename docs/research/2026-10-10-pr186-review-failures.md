---
id: RESEARCH-PR186-REVIEW-FAILURES
kind: research
status: current
owners: [core-team]
last-reviewed: 2026-10-10
---

# PR #186: falhas de execução, cobertura e qualidade do modelo

## Conclusão

O [PR #186](https://github.com/ThiagoCrepequer/holon/pull/186) tem sete execuções
Holon identificadas. **Seis publicaram revisão incompleta com Check Run
`neutral`; uma terminou com falha de sistema e Check Run `failure`. Nenhuma
produziu cobertura completa.** Portanto, não foram sete crashes do modelo.

Há três problemas independentes:

- **Host e implementação:** inventário parcial e capacidade insuficiente de
  checks de contrato em todas as runs; diferença entre schema enviado ao modelo
  e validação posterior; falha da coleta de evidências que cancela todas as lanes.
- **Qualidade do modelo:** valores inválidos, evidências que não correspondem ao
  patch e um falso positivo confirmado mesmo com contraprova explícita no diff.
- **Integração e provedor:** timeout catalogado do Sandbox na última run e erro
  de `tool_choice` do NextBit dentro de streaming HTTP 200. O segundo não permite
  separar, sozinho, capacidade do modelo de implementação do provedor.

Trocar somente o modelo não elimina as omissões do planejador nem a falha do
executor. Corrigir somente o executor também não elimina o falso positivo.

## Escopo e método

Data de corte dos logs: **2026-10-10T16:15:00Z**. Janela inicial:
2026-10-09T21:50:00Z. Conta Cloudflare Holon; Gateway `holon`.

Foram consultados os 21 commits atuais do PR, todos os Check Runs Holon
encontrados nesses commits, as sete reviews publicadas, os sete Workflows pais,
os 167 Workflows filhos da janela e todos os registros retidos de erro/aviso
dos Workers `holon-*` nessa janela. Não houve nova inferência, rerun, alteração
de configuração ou deploy.

O inventário inclui **82 registros de erro/aviso: 51 erros e 31 avisos**,
incluindo três spans com erro. Registros de uma mesma falha aparecem em várias
camadas: isso não representa 82 incidentes independentes. A coleta ampla também
inspecionou 11.452 eventos/invocações, seguida por consultas específicas por run.
O [resumo sanitizado](experiments/2026-10-10-pr186-review-failures/summary.json)
preserva contagens, IDs, versões, códigos e limitações de leitura.

Uma consulta inicial de toda a janela retornou seis registros com
`statistics.abr_level=10`. Ela foi descartada como inventário completo. A coleta
final de erros/avisos usou 37 janelas de até 30 minutos, todas com
`abr_level=1`. A API distingue amostragem da consulta de amostragem na ingestão;
assim, esgotar a paginação dos registros retidos não comprova que todos os eventos
gerados foram armazenados. A retenção também limita qualquer auditoria histórica.
Fontes verificadas em 2026-10-10:
[API de telemetria](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)
e [Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/).

Os estados dos 167 filhos vieram da listagem. Os detalhes de 164 foram lidos;
três filhos listados como `complete` retornaram erro interno `10001` na API,
inclusive após três tentativas de leitura. Isso é uma limitação da auditoria,
não uma falha adicional de inferência. Não foram exportados prompts, diffs,
respostas integrais, argumentos de tools, credenciais ou mensagens arbitrárias.
As duas saídas com schema inválido foram inspecionadas em memória e revalidadas
localmente contra os fontes do tag implantado `b7dd6b4`.

## Resultado por execução

Horários UTC; partes exibidas ao usuário usam índice começando em 1.

| Head      | Início               | Workflow / Check   | Análise publicada                      | Impedimento demonstrado                                                                                                                 |
| --------- | -------------------- | ------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `6353163` | 2026-10-09T21:54:53Z | complete / neutral | 22/22; 1 degradada                     | Inventário parcial; 12 relações omitidas; evidência rejeitada na parte 9                                                                |
| `03676fd` | 2026-10-09T23:00:12Z | complete / neutral | 23/23; 0 degradadas                    | Inventário parcial; 12 relações omitidas                                                                                                |
| `3f4ff72` | 2026-10-09T23:46:18Z | complete / neutral | 21/23; 2 falhas                        | Mesmas omissões; `model_schema_invalid` nas partes 1 e 10                                                                               |
| `750c108` | 2026-10-10T00:53:52Z | complete / neutral | 23/23; 0 degradadas                    | Inventário parcial; 12 relações omitidas                                                                                                |
| `beffa84` | 2026-10-10T04:17:34Z | complete / neutral | 35/35; 0 degradadas                    | Inventário parcial; 160 relações omitidas                                                                                               |
| `e2fa50b` | 2026-10-10T14:41:02Z | complete / neutral | 35/35; 2 degradadas                    | Mesmas omissões; verificação causal falhou na parte 12; evidência rejeitada na parte 13; falso positivo publicado                       |
| `4001031` | 2026-10-10T15:06:12Z | errored / failure  | Sem agregado publicável; 35 planejadas | Três etapas de análise falharam com `HOLON_SANDBOX_TRANSIENT:timed-out`; duas investigações concluídas, uma terminada, 32 não iniciadas |

Nos filhos: 163 `complete`, três `errored` e um `terminated`. Os três erros são
duas investigações com schema inválido e uma verificação causal com erro do
provedor. Dois filhos concluídos da última run não significam duas partes
validadas/publicadas: a coleta de evidências posterior falhou.

## Host: limites de cobertura e problemas de implementação

### C1 — Planejamento insuficiente para este PR, antes da inferência

Todas as runs registraram `structural_inventory` com
`repositoryScanTruncated=true` e zero sinais omitidos no relatório serializado.
**Zero sinais omitidos não significa varredura completa:** a busca/leitura
limitada de consumidores permanece parcial.

Nas quatro primeiras runs, `contract_checks` omitiu 12 relações: dez por
`capacity`, duas por `missingWindow`. Nas três últimas, omitiu 160: 152 por
`capacity`, oito por `missingWindow`; nenhuma por `evidenceWindows`.
Essas limitações estão presentes no plano antes do modelo responder.

Os mecanismos relevantes são
[inventário limitado](../../apps/repository-executor/src/structural-repository-inventory.ts),
[planejador](../../packages/repository-analysis/src/plan.ts) e
[checks canônicos](../../packages/repository-analysis/src/contract-checks.ts).
O inventário limita candidatos a 100 arquivos, cada leitura a 64.000 bytes e o
total a 1.000.000 bytes. Os checks adicionais permanecem limitados a oito partes
pelas [ADRs 0060](../decisions/0060-separate-review-inventory-and-pack-contract-windows.md)
e [0061](../decisions/0061-pack-review-shards-with-structural-context-budget.md).

**Classificação:** limitação arquitetural/política do host, confirmada; não
capacidade do modelo. O gate parcial está correto. A evidência não identifica
qual teto ou operação específica tornou cada varredura parcial, pois os logs
agregam esse motivo. Não há prova de bug aritmético no planejador nesta auditoria.

### C2 — O contrato de geração aceita valores rejeitados depois

Na parte 10 de `3f4ff72`, o Think entregou resultado e o
`modelReviewPromptSchema` o aceitou. O parser posterior rejeitou a localização:
`line=-9007199254740991` e `path=""`. O schema de geração usa apenas
`number().int()` e `string()` nesses campos; a localização consumida pelo host
exige linha positiva e path válido.

O modelo produziu dados sem sentido para uma localização do diff. **O código
também possui uma divergência comprovada entre os contratos.** Um candidato
inválido derrubou a parte inteira em vez de ser isolado e registrado como
degradação. O tratamento resiliente existente se concentra nas evidências e
não cobre todos os campos de candidato.

Na parte 1, a observação `investigations[1].summary` violou o mínimo de 30 após
normalização; o replay também encontrou `findings[0].evidence` vazio. A rejeição
estrita é correta, mas a falha de uma observação auxiliar impede a conclusão
da parte. Não se deve preencher texto ou coordenadas para fazê-la passar.

Fontes: [contratos de saída](../../packages/contracts/src/review-output.ts),
[classificação da falha](../../apps/control-plane/src/review/review-failure.ts)
e [workflow do Think](../../apps/control-plane/src/review/review-agent.ts).
**Classificação:** mista — geração inválida demonstrada e fragilidade de
contrato/isolamento no host. Revalidação local reproduziu os paths e códigos;
nenhuma nova chamada ao modelo foi feita.

### C3 — Uma falha da coleta de evidências aborta todas as lanes

Na última run, os steps `analyze-shard-26-1`, `analyze-shard-14-1` e
`analyze-shard-2-1` receberam o mesmo código
`HOLON_SANDBOX_TRANSIENT:timed-out`, com uma tentativa cada.
O primeiro falhou às 15:08:51.191Z; o pai abortou as lanes e encerrou às
15:09:01.729Z. Os filhos das partes 26 e 14 estavam `complete`; o filho da
parte 2 foi `terminated` durante a propagação do cancelamento.

A sequência do código coleta o pack do executor após `workflow.status()` indicar
`complete`. Um span do pai identifica `getEvidencePack` às 15:08:51.158Z com
duração de 20 ms, seguido por cancelamento. O executor registrou a mesma trace
com erro de request sem resposta às 15:08:51.180Z. As etapas inteiras duraram
aproximadamente 9,8, 14,6 e 10,9 segundos.

Isso comprova falha na integração do executor/coleta, **não uma espera de
90 segundos do modelo**. O nome `timed-out` não prova duração real: o
[ToolExecution](../../apps/repository-executor/src/tool-execution.ts) também usa
esse código quando o deadline recebido excede o máximo permitido. Faltam logs
da ramificação e do saldo temporal para separar deadline inválido, erro do SDK
ou outra falha do Sandbox. Não foi identificada uma linha causadora definitiva.

Há uma fragilidade concreta de recuperação: a coleta passa pelo mesmo
`modelStep` com zero retries. Um erro transitório dessa leitura cancela peers e
impede o despacho das 32 partes restantes. A solução deve preservar a inferência
durável já concluída e recuperar somente a leitura de evidências, mantendo
lease, identidade e autorização. Repetir indiscriminadamente o step inteiro
pode repetir trabalho/inferência.

Fontes: [ThinkReviewer](../../apps/control-plane/src/review/think-reviewer.ts),
[pack do Sandbox](../../apps/repository-executor/src/cloudflare-sandbox.ts),
[política de steps](../../apps/control-plane/src/review/workflow-policy.ts) e
[lanes e cancelamento](../../apps/control-plane/src/review/review-analysis.ts).
**Classificação:** integração/host confirmada; causa interna do timeout
indeterminada; acoplamento da recuperação confirmado no código.

## Modelo e rota: protocolo e qualidade

### M1 — Duas respostas inválidas para o contrato operacional

As duas falhas de `3f4ff72` não foram erros HTTP nem falta de resposta final.
O evento de espera do Think concluiu com submission `completed`. A parte 1
trouxe uma observação curta e um candidato sem evidência; a parte 10 trouxe
candidato `critical` com localização vazia e linha negativa extrema.

**Classificação:** falha demonstrada de aderência/qualidade da saída, agravada
pelo problema C2. Não comprova incapacidade geral do Gemma, mas impede tratar
esta rota como confiável apenas porque o HTTP e o tool call concluíram.

### M2 — Trechos de evidência não correspondem ao patch

Em `6353163`, parte 9, e `e2fa50b`, parte 13, o host registrou
`model.evidence_rejected`, `stage=causal_admission`,
`reason=evidence_excerpt_mismatch`. O gate reteve o candidato rejeitado e
preservou a degradação. Não foi necessário mudar a política para esconder isso.

**Classificação:** saída do modelo incompatível com a evidência canônica,
confirmada pelo verificador determinístico. Os payloads não foram exportados;
a auditoria não separa erro de cópia, normalização ou interpretação em cada caso.

### M3 — NextBit recusou a chamada de ferramenta exigida

Na verificação causal da parte 12 de `e2fa50b`, o Workflow
`review-9700d53312cc80c511bf07d3f3012d704b981571713a2752a58464f5c895c04e`
falhou. O SDK recebeu erro de upstream do **NextBit** informando ausência de
tool call válido para o `tool_choice` solicitado. O último
`model.step_finished` registrou `finishReason=other`, nenhuma tool e 888 tokens
de saída. O host reteve os candidatos com `causal_verification_incomplete`.

O Gateway reteve **181 requisições, todas HTTP 200**, usando
`google/gemma-4-26b-a4b-it-20260403` via OpenRouter. Essa falha dentro do stream
demonstra que HTTP 200 não garante protocolo válido nem sucesso da revisão.
O NextBit é identificado neste erro específico; não há prova de que atendeu
todas as outras requisições.

A versão indicada pelo deploy configura `provider.require_parameters=true` e
`reasoning.enabled=false`; isso expressa a exigência, mas não comprova seu
cumprimento pelo destino. Fonte: [adapter](../../packages/model/src/gateway.ts).
**Classificação:** protocolo da rota modelo/provedor confirmado; atribuição
exclusiva à capacidade do Gemma ou ao NextBit permanece indeterminada. A
[API do Gateway](https://developers.cloudflare.com/api/resources/ai_gateway/subresources/logs/methods/list/)
foi consultada em 2026-10-10; a paginação retornou os 181 registros em quatro páginas.

### M4 — Falso positivo confirmado com confiança máxima

O [finding publicado](https://github.com/ThiagoCrepequer/holon/pull/186#discussion_r4237994938)
em `e2fa50b` afirma que mover `runIdSchema`, `repositoryPathSchema` e
`positiveIntegerSchema` rompe imports existentes. O próprio trecho usado como
evidência mostra os três **reexportados** por `shared.ts`. O consumidor público
continua alcançando-os por `index.ts`, que exporta `shared.js`.

A leitura do arquivo no SHA exato confirmou o reexport nas linhas 22–26.
A verificação causal da parte 13 retornou `confirmed`, `confidence=1`,
`basis=patch` e zero receipt IDs. Esse formato é permitido para premissa
autocontida no patch; zero recibos, isoladamente, não é bug de schema. Contudo,
o modelo confirmou a alegação apesar da contraprova no próprio patch e alegou
quebra de consumidores sem demonstrá-la.

**Classificação:** erro de raciocínio demonstrado no modelo. A arquitetura do
host também tem um limite: valida consistência, evidência e recibos, mas depende
do julgamento semântico do verificador. Uma segunda conversa com o mesmo modelo
não assegura refutação independente, como já reconhece a
[ADR-0050](../decisions/0050-verify-finding-causality-before-publication.md).
O contador de “achados verificados” não deve ser interpretado como precisão
comprovada. Fontes: [gate causal](../../packages/application/src/causal-verification.ts)
e [contrato causal](../../packages/contracts/src/causal-verification.ts).

## Outros erros e avisos Cloudflare

| Registros | Ocorrência                                              | Classificação e vínculo com a revisão                                                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14 erros  | Think: falha de entrega de notificação, tentativas 1–14 | O mesmo Durable Object do shard 1 de `4001031` aparece no passo do modelo e nos primeiros retries. São consequência de execução cancelada/integração SDK; não 14 novas falhas do modelo. Os retries continuaram até 16:05:56Z. O motivo interno da recusa RPC não está exposto. |
| 22 erros  | Dashboard: runtime detectou request sem resposta        | Há 22 `dashboard.projection_retry` nas mesmas traces, com `TypeError`/`Error`, entre 21:54:24Z e 22:37:04Z de 2026-10-09. Problema da projeção/RPC do produto, não da inferência. A causa exata não foi comprovada; não há evidência de que cancelou os Workflows de revisão.   |
| 2 erros   | Executor: exceção e invocação correspondente            | Representam a mesma request na trace da run fatal: runtime sem resposta e invocação `exception`. Integração/host; não duas falhas independentes.                                                                                                                                |
| 14 avisos | RPC com recursos não descartados no executor            | Ocorrem em sete pares. Gestão de capacidades/SDK precisa de revisão; esses avisos também aparecem em runs que concluem. Não provam a causa do timeout fatal.                                                                                                                    |
| 2 avisos  | `email_dlq`                                             | Fora do caminho de inferência/revisão. Não há vínculo causal demonstrado com o insucesso das runs.                                                                                                                                                                              |
| 5 avisos  | `project.identification_partial`                        | Diagnóstico auxiliar de descoberta parcial; não determina, sozinho, falha da revisão nem incapacidade do modelo.                                                                                                                                                                |

Os demais registros são as camadas dos incidentes já descritos: erro do
Workflow com schema inválido, erro/submission/stack e spans do NextBit,
`review.shard_failed`, três `review.analysis_step_failed`,
`review.analysis_failed`, `review.failed`, cinco `review.analysis_partial`,
três `review.shard_partial` e duas rejeições de evidência. O JSON classifica
individualmente os 82 registros, sem reproduzir os payloads.

Dois spans compartilham a trace do erro NextBit. O terceiro permanece sem
atribuição causal suficiente; ele não foi contado como nova falha do modelo.

A Cloudflare descreve request sem resposta como evento associado a promises
não resolvidas ou outros problemas de ciclo de vida. Isso orienta a investigação,
mas não identifica automaticamente a função culpada nestas traces. Fonte
verificada em 2026-10-10:
[erros e exceções de Workers](https://developers.cloudflare.com/workers/observability/errors/).

## O que não explica estes incidentes

Não foram encontrados eventos de recusa de orçamento global/local de modelo
ou tools nas consultas das runs. Todas selecionaram perfil `very_large`.
O pai da última run usou 4.848 ms de CPU e 168.565 ms de wall time; não há
`exceededCpu` nesse registro. Não há evidência de falta de saldo, erro HTTP
429/5xx, nem de que aumentar CPU resolveria a falha observada.

As sete runs têm `repository.cleanup_completed`. A limpeza não é o impedimento
demonstrado. CI de código e Check Run Holon são provas diferentes; o gate local
verde não comprova qualidade das análises do modelo ou estabilidade da integração.
Ausência de findings nas outras runs não mede falsos negativos: faltam oracles
independentes para classificá-los.

## Correções prioritárias propostas

| Prioridade | Frente                              | Resultado esperado / validação necessária                                                                                                                                                                 |
| ---------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1         | Recuperação da coleta de evidências | Separar leitura transitória de inferência concluída; retry durável limitado, sem duplicar geração. Reproduzir cancelamento concorrente e garantir join/cleanup.                                           |
| P1         | Contrato de saída e isolamento      | Alinhar restrições de localização do schema enviado e recebido; rejeitar candidato/observação inválida com degradação explícita. Regressões com os dois formatos observados, sem fabricar evidência.      |
| P1         | Precisão e verificação causal       | Fixture negativa de reexport preservado; exigir contraprova/consumidor para alegações externas. Medir falsos positivos e falsos negativos em repetições, incluindo independência do verificador.          |
| P2         | Cobertura do host                   | Medir a ramificação que trunca inventário e o custo de checks; revisar a política que deixa 152 relações por capacidade. Qualquer mudança dos limites exige decisão própria, sem reescrever ADRs aceitos. |
| P2         | Rota e streaming                    | Qualificar tool calling/saída estruturada no destino efetivo; preservar código seguro de erro upstream e medir recuperação/fallback em streams HTTP 200 com erro.                                         |
| P2         | Diagnóstico de executor/SDK         | Diferenciar deadline expirado, deadline acima do teto e falha do SDK; registrar somente código, etapa e saldo temporal. Investigar retries de notificação após término e posse de RPCs.                   |
| P2         | Projeção do dashboard               | Reproduzir o caminho RPC/alarms das 22 requests sem resposta; comprovar recuperação da projeção separadamente da revisão.                                                                                 |

Essas propostas não foram implementadas ou implantadas nesta auditoria. Nenhuma
troca de modelo foi testada: os dados sustentam problemas concretos da rota atual,
mas não uma estimativa de quanto outro modelo melhoraria precisão ou conclusão.

## Proveniência e limites finais

O Worker control-plane da primeira run foi
`836325d2-6293-4520-8b07-1ab8ebba6fa2`, criado em
2026-10-09T21:12:11Z, sem tag de commit. As outras seis usaram
`0837989c-47f8-405b-8451-828d7fc3b5b5`; o executor observado usou
`cd975578-ca99-447e-8c41-9f2e9b66501e`. Esses dois artefatos têm anotação
`workers/tag=b7dd6b43ba0118b1989f3b44b7d4700412170258`.
Anotação de deploy não é comparação byte a byte do bundle. A primeira versão
permanece sem vínculo exato a um commit. IDs de versão do Workflow são distintos
dos IDs de versão do Worker.

A auditoria executou consultas de leitura GitHub/Cloudflare, paginação e
revalidação local dos schemas históricos. Não executou `pnpm verify`, pois não
alterou código de produção. A formatação e consistência dos artefatos do relatório
foram verificadas localmente. As limitações de retenção/ingestão, três leituras
de detalhes indisponíveis e causas internas não instrumentadas permanecem
explícitas; não devem ser substituídas por atribuição genérica ao modelo.
