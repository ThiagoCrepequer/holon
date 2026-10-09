---
id: RESEARCH-REVIEW-CORE-LIVE-2026-10-08
kind: research
status: current
owners: [core-team]
last-reviewed: 2026-10-09
---

# Benchmark local do Think com o modelo real

Os gates de qualidade **continuam abertos**: a continuação abaixo recuperou
positivos, mas expôs instabilidade de schema e um falso positivo causal repetido.
O orçamento acumulado ficou abaixo de US$ 0,50. A conclusão original a seguir
descreve a rodada inicial de 2026-10-08.

A [continuação de código de 2026-10-09](2026-10-09-review-core-code-follow-up.md)
encontrou erros de tipos em dois controles negativos antigos. Portanto, findings
nesses controles não são automaticamente falsos positivos. A rodada nova de
alias passou 2/2 após compilação estrita, conservando o histórico e o gate global
aberto. Os totais atuais estão no relatório da continuação e no arquivo da campanha.

Os gates de qualidade **não passaram nessa rodada inicial**. As quatro variantes da ablação perderam
todos os positivos; reconstruir o contexto e habilitar raciocínio também não
recuperou os defeitos. Menor número de chamadas sem encontrar os bugs não é
melhoria aceitável. Prefetch adicional, quotas ponderadas, skipping incremental
e especialistas continuam sem autorização técnica de ativação.

A execução foi autorizada pelo usuário em 2026-10-08, com consumo limitado e
credencial de um `.env.cloudflare` local. Foram 67 requests reais, excluindo a
duplicação da tentativa parcial retomada. O provider informou **US$ 0,016498327**;
três respostas sem usage/custo tornam esse valor um subtotal, não uma fatura
completa. Essas respostas conservaram a reserva integral. Não houve alteração
de secrets, rota, recursos Cloudflare, deploy ou publicação no GitHub.

## Composição e dados

O subject inicia o `ReviewAgent` vigente e `ReviewShardWorkflow` no plugin
Vitest oficial para Workers, usando Think, schemas, tools, reservas e settlement
reais. Só os transportes externos são controlados: o Gateway é encaminhado por
um relay Node autenticado; o executor RPC usa ferramentas reais na imagem Docker
local do Sandbox, com rede desabilitada e arquivos montados somente para leitura.
Não há resposta de modelo simulada nem substituição de `getModel`/`getTools`.

Rota: `dynamic/pr-review`, Gateway `holon`. Deployment observado:
`e335278a-96b4-4a32-87d5-219ca80dd052`. Respostas identificadas pelo provider:
`google/gemma-4-26b-a4b-it`. Versões: Node 24.19.0, pnpm 11.24.0,
Think 0.20.0, Agents 0.26.0 e AI SDK 7.0.84. Os planos preservam hashes das
fontes e o ID imutável da imagem. A janela foi 2026-10-09T01:20–01:55 UTC
(2026-10-08, horário de São Paulo).

São quatro snapshots sintéticos em duas famílias:

- `null-consumer`: produtor passa a retornar `null`. Positivo possui consumidor
  intacto acessando `value.id`; negativo possui guarda explícita.
- `literal-contract`: separador passa de um para dois espaços e viola o formato
  exigido pelo consumidor intacto. Controle negativo troca espaço por `\x20`,
  preservando o valor. Há quatro arquivos irrelevantes para o prefetch completo.

Antes de pagar inferência, Node executou consumidor e produtor em base/head:
todas as bases passam, os dois heads positivos falham e os negativos passam.
Isso estabelece a verdade funcional dos exemplos, sem depender do próprio LLM.
Os SHAs da fixture são hashes de conteúdo; não são commits Git nem checkout real.

Cada review executa **um shard sob a quota protegida de uma run com nove shards**,
incluindo máximo de 2.051 tokens por geração e fases no mesmo saldo. Não é uma
review real de nove shards concorrentes. O harness não executa checkout GitHub,
planejamento completo, lifecycle remoto do Sandbox ou publicação.

O acerto exige finding final íntegro no produtor/linha 2 no positivo, ou ausência
de finding no negativo, sem falha, degradação ou rejeição de evidência. É um grader
restrito de localização/detecção; não adjudica semanticamente diagnóstico e
severidade. Não houve adjudicação humana nem holdout independente nesta rodada.
Como nenhum positivo passou, não há evidência de precisão publicada nem de
recall generalizável. Precisão com zero findings é indefinida, não 100%.

## Ablação pré-declarada

`repeated` omite o repasse de receipts à verificação; `receipts` usa o repasse
atual. `full` lê os seis arquivos antes da investigação; `selective` lê somente
o consumidor. Prefetch consome tools lógicas do ledger e integra bytes, preparação
e duração. A ordem foi rotacionada por caso. A comparação completo/seletivo ficou
limitada à família `null-consumer` para conter gasto.

| Variante    | Reviews | Positivos encontrados | Negativos corretos | Falhas operacionais | Gerações | Tools reservadas | Bytes enviados | Mediana por review |
| ----------- | ------: | --------------------: | -----------------: | ------------------: | -------: | ---------------: | -------------: | -----------------: |
| `repeated`  |       4 |                   0/2 |                1/2 |                   3 |       13 |                7 |        179.198 |             8,86 s |
| `receipts`  |       4 |                   0/2 |                2/2 |                   1 |       13 |                8 |        185.524 |             9,97 s |
| `full`      |       2 |                   0/1 |                1/1 |                   0 |        6 |               16 |        117.975 |            15,89 s |
| `selective` |       2 |                   0/1 |                1/1 |                   1 |        6 |                6 |         84.510 |            10,30 s |

A ablação consumiu 38 requests e US$ 0,0095293 informados. As 12 reviews
tiveram cinco falhas operacionais e um candidato rejeitado por evidência fora
do patch. Zero positivos passaram e cinco dos seis negativos passaram.
Nenhuma revisão alcançou verificação causal: as diferenças entre `repeated`
e `receipts` ocorreram **antes** da aplicação do pacote. Logo, não podem ser
atribuídas causalmente ao repasse de receipts. O gate R06 permanece inconclusivo.

Tools observadas não tiveram hits no cache: foram 36 execuções físicas e 37
reservas lógicas, incluindo uma operação não executada. A redução de 96 para
12 processos do benchmark determinístico continua válida para sua carga repetida,
mas esta rodada não demonstrou essa economia com o modelo real.

Os metadados mostraram chamadas finais com apenas `think_final_answer` disponível
e `tool_choice` forçado. Ainda assim houve `model_output_missing`; os erros do
Think indicaram tentativa de outra tool. Também ocorreu saída inválida de schema.
No positivo textual, o modelo descreveu a violação de `WIRE_FORMAT` no resumo/
observações, mas deixou `findings` vazio. Não promovemos texto livre automaticamente
a finding nem relaxamos o filtro de evidência para fazer a métrica passar.

## Experimentos rejeitados

| Experimento                                            | Positivos | Negativos corretos | Gerações |   Bytes | Mediana | Resultado          |
| ------------------------------------------------------ | --------: | -----------------: | -------: | ------: | ------: | ------------------ |
| Histórico reconstruído de patch + resultados de tools  |       0/2 |                2/2 |       11 | 155.086 | 17,73 s | NO-GO; removido    |
| Histórico nativo + raciocínio habilitado no transporte |       0/2 |                1/2 |       14 | 224.139 | 34,88 s | NO-GO; não ativado |

O primeiro prototype retirava a sequência assistant/tool e reapresentava os
outputs completos. Apesar de duas gerações a menos que `receipts`, perdeu ambos
os defeitos; em um caso alegou não encontrar consumidores depois de ler só o
produtor. O módulo experimental foi removido. Seu relatório preserva hashes,
mas a fonte retirada não foi arquivada integralmente: esse ensaio é diagnóstico,
não um benchmark de implementação reproduzível nem gate de aceitação.

No segundo, o relay alterou apenas `reasoning.enabled` para `true`, mantendo
modelo, tools, teto e histórico nativo. Usage informou 2.256 reasoning tokens;
três reviews falharam com stream sem finish reason e três requests sem usage.
Isso demonstra que a opção chegou ao provider, mas não explica isoladamente
a origem da interrupção. A fábrica de provider mantém o comportamento vigente.

A documentação do Google recomenda thinking para function calling e preservação
dos pensamentos entre chamadas. São fundamentos para testar a hipótese, não
prova de compatibilidade da rota do Holon. Fontes conferidas em 2026-10-08:
[function calling do Gemma 4](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4)
e [formato do prompt](https://ai.google.dev/gemma/docs/core/prompt-formatting-gemma4).

O lembrete adicional de finalização por turno também não passou gate de benefício
e foi retirado. Ficou a explicação estática da regra existente: evidência do
consumidor intacto fundamenta impacto, enquanto a âncora publicável pertence à
mudança no produtor. Isso não é apresentado como ganho empírico de recall.

## Reconciliação dos gates

| Gate                                                           | Estado após a rodada                          | Evidência ou trabalho necessário                                                               |
| -------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| R01/F01–F08, contratos e consequências determinísticas         | GO local preservado                           | Regressões e gate local; não representa qualidade do provider                                  |
| R02, subject Think com modelo real e falhas preservadas        | Harness entregue; qualidade NO-GO             | Oracles executáveis, transporte real, reservas, artefatos e falhas no denominador              |
| R03/R04, menos parsing/processos sem alterar outputs           | GO determinístico; ganho live não demonstrado | Zero hits nesta amostra; medir PRs com repetição antes de extrapolar                           |
| R05, prefetch sem perda de qualidade                           | NO-GO nesta ablação                           | Todos os positivos perdidos; sem ativação no runtime                                           |
| R06, receipts reduzem recuperação causal sem falsa confirmação | Aberto                                        | Zero verificações causais; medir confirmado/refutado/inconclusivo após corrigir geração        |
| R07, ponderação/borrow de quota                                | Aberto                                        | Não houve teste de nove shards concorrentes ou pressão heterogênea; quotas iguais preservadas  |
| R08, lanes reduzem espera real                                 | GO local; latência live comparativa aberta    | Timer workload e testes de estado não medem scheduling de reviews reais                        |
| R09, reuso de prova entre commits                              | Aberto                                        | Closure independente e invalidação; runtime continua revisando tudo                            |
| R10, especialização/diversidade                                | Aberto                                        | Nenhuma variante especializada foi executada; não adicionar agentes pelo fracasso de um modelo |
| Compatibilidade Think/rota/modelo                              | NO-GO nesta amostra                           | Final answer, schema e streaming precisam passar antes de nova comparação de otimizações       |

Fechar estes gates como GO seria incompatível com os resultados. NO-GO é a
conclusão do experimento, não a conclusão de que o problema foi corrigido. O
próximo recorte prioritário é reproduzir o encerramento/schema no protocolo
real e resolver a omissão de findings confirmados, antes de medir economias
na fase causal. Não alterar budgets, trocar modelo/rota ou reintroduzir motor
próprio sem a decisão e a prova aplicáveis.

## Artefatos e limites de reprodução

Os [planos, resultados e análise](experiments/2026-10-08-live-review/README.md)
preservam todas as tentativas. A tentativa parcial está incluída na ablação,
sem repetir seu caso falho nem dobrar o custo. O probe inicial consumiu quatro
requests e encontrou âncora inválida, mas terminou com erro de terminalização
do harness; foi corrigido e permanece excluído das métricas comparativas.

Snapshots de fontes que coincidem com os hashes originais foram arquivados com
extensão `.source`. Arquivos faltantes são explicitamente limitados ao hash;
não reconstruímos uma fonte e a apresentamos como original. Os planos do primeiro
probe não tinham digests. Novas execuções capturam fontes e plano antes das chamadas.
O CLI atual recusa retomar com perfil, caps, casos, fontes, imagem ou deployment
diferentes; falhas anteriores permanecem concluídas e não são tentadas de novo.

O Vitest terminou tecnicamente com zero nas suítes completas, apesar dos cases
falharem. Isso foi corrigido no CLI: `0` exige todos os pares esperados únicos e
aprovados, `2` indica gate de qualidade falho/incompleto, erro do harness preserva
seu código. Regressões locais comprovam essa distinção; não houve nova chamada
paga apenas para demonstrar o código de saída.

Payload capture foi limitado a fixtures sintéticas fixas e respostas finais nos
artefatos locais. Trace de Agent ficou desabilitado, Gateway usou
`cf-aig-collect-log-payload:false` e cache bypass. Headers, tokens, prompts de
request, raciocínio textual e arquivos de repositórios privados não foram gravados
nos relatórios. O relay encerra e remove só seu diretório temporário; a credencial
não entra no Workerd. Reprodução paga exige autorização própria, conforme o
[runbook](../operations/evaluations.md).

## Continuação em 2026-10-09: correções, repetições e orçamento

O usuário autorizou novas chamadas com teto de US$ 0,50. A campanha inclui as
chamadas anteriores, as falhas e dois probes de protocolo de 16 tokens; reiniciar
uma suíte não renova dinheiro. O arquivo persistido de spending tem lock exclusivo
e checkpoint atômico antes do transporte. Ao faltar o arquivo local, a retomada
parte do snapshot versionado da campanha, nunca de zero. Preços públicos dos
endpoints são conferidos antes de cada suíte; alterações impedem a execução.

A reserva usa bytes de entrada como limite conservador de tokens, margem de
2.048 tokens para template, saída máxima, duas tentativas possíveis na rota e
margem de 25%. Custo conhecido é liquidado com a mesma margem; custo desconhecido
conserva a reserva. Isso é um controle operacional conservador, não uma garantia
de fatura: o usage do provider não revela todos os attempts internos do fallback.
Não foram trocados modelo, deployment ou recursos remotos. As tentativas de
acrescentar parâmetros de preço no transporte retornaram oito HTTP 422 e foram
retiradas. Dois probes menores retornaram HTTP 200, insuficientes para comprovar
compatibilidade com o protocolo completo. As oito reservas continuam contabilizadas.

O fechamento desta campanha registra **243 requests**, incluindo esses dois
probes. O provider informou **US$ 0,060062421**; onze requests não informaram
custo (oito HTTP 422 e três streams da rodada com reasoning). A exposição
conservadora foi **US$ 0,177000834**, abaixo dos **US$ 0,50**. Usage disponível
registra 718.740 tokens de entrada e 28.627 de saída nas conversas Think; são
subtotais das respostas com usage. Os 494.323 tokens de saída reservados incluem
os máximos dos probes e não são consumo efetivo. O
[analisador](experiments/2026-10-08-live-review/analyze.mjs) reconcilia cada request
com sua reserva, sem contar novamente `initial-partial`.

### Defeito estrutural e fronteiras corrigidas

Duas regressões locais demonstraram que edits apenas no corpo, com assinatura
fora do hunk, omitiam o símbolo e seus consumidores. A
[ADR-0056](../decisions/0056-trace-edited-declarations-in-verified-head.md) registra
a correção: ler os arquivos alterados no HEAD verificado, extrair declarações
contendo as linhas editadas com o parser já instalado e só então buscar downstream.
Metadados, symlinks e orçamento compartilhado continuam validados antes de ler.

Nos ensaios com `--structural-context`, as fixtures possuem commits Git reais e
o contexto vem de `collectStructuralRepositoryInventory` e `buildReviewArtifacts`,
com execução de comandos fixos na imagem local. Isso substitui os hashes de
conteúdo da bancada inicial, sem representar checkout de GitHub ou Sandbox remoto.
A preparação do inventário é medida separadamente; a mediana de review mais
inventário é uma projeção contábil, pois a preparação foi feita uma vez por caso.

O prompt passou a oferecer linhas produtoras exatas derivadas do índice canônico,
sem o prefixo `+` e preservando espaços. Isso não amplia a evidência publicável.
A conversa causal recebe uma projeção factual do snapshot, idioma e limitações,
sem repetir as instruções de investigação aberta. Depois de erros recorrentes
de IDs e intervalos, a [ADR-0057](../decisions/0057-select-host-evidence-receipts-in-causal-assessments.md)
simplificou a resposta para seleção de `evidenceReceiptIds`: o host resolve toda
a janela inspecionada. IDs desconhecidos, metadados inválidos e truncamento
continuam impedindo publicação. Prompts não substituem esse gate.

### Resultados completos da continuação

As famílias de desenvolvimento permaneceram `null-consumer` e `literal-contract`.
O primeiro holdout usou famílias novas (`cycle-index` e `caller-mutation`),
definidas antes das chamadas. A confirmação introduziu `payload-field` e
`inclusive-boundary`; depois do primeiro resultado essas famílias passaram a
ser desenvolvimento para os ajustes seguintes. Não são novos holdouts a cada
repetição. Não agrupar todas as rodadas como amostra independente de qualidade.

| Experimento                          | Positivos | Negativos corretos | Requests | Resultado observável                                                        |
| ------------------------------------ | --------: | -----------------: | -------: | --------------------------------------------------------------------------- |
| Baseline nativo adicional            |       0/2 |                1/2 |       16 | Omissões e saída ausente                                                    |
| Clareza inicial do schema            |       0/2 |                1/2 |       10 | Não recuperou recall                                                        |
| Contexto estrutural                  |       0/2 |                2/2 |       11 | Consumidor encontrado; âncora/schema inválidos                              |
| Linhas canônicas copiáveis           |       0/2 |                2/2 |       11 | Candidatos íntegros; fase causal inválida                                   |
| Referências causais copiáveis        |       2/2 |                2/2 |       10 | Primeira rodada 4/4                                                         |
| Primeiro holdout                     |       2/2 |                2/2 |       11 | 4/4 nas duas famílias novas                                                 |
| Repetição da ablação                 |       3/6 |                6/6 |       27 | Três falhas de schema; benefício instável                                   |
| Contexto causal factual separado     |       2/2 |                2/2 |       10 | 4/4 no desenvolvimento                                                      |
| Primeira confirmação                 |       2/2 |                1/2 |       12 | Falso positivo causal                                                       |
| Instruções explícitas de alcance     |       0/2 |                1/2 |       10 | Dois erros de schema e mesmo falso positivo                                 |
| `temperature: 0`                     |       2/2 |                0/2 |       13 | Erro de schema e mesmo falso positivo; não ativado                          |
| Seleção somente de IDs               |       0/2 |                0/2 |        8 | Quatro falhas na investigação; não chegou à fase causal                     |
| Orientação de tipos + seleção de IDs |       2/2 |                0/2 |       11 | Sete respostas finais válidas; um negativo degradado e mesmo falso positivo |

Os três probes positivos, os dois ensaios HTTP 422 e os probes de preço também
estão preservados em `summary.json`; participam do custo, sem virar prova de
qualidade. A última rodada orienta `suggestion` como string/null e explica que
`investigations` é uma lista obrigatória, vazia quando ausente. Todas as sete
respostas finais passaram schema; os três assessments causais passaram a validação
do host de basis e seleção de receipts. Essa prova estreita de protocolo não demonstra estabilidade nem
aisola o efeito de cada orientação. O negativo `payload-field` teve candidatos
retidos pela validação de evidência, conservando degradação e reprovação do grader.

No negativo de limite inclusivo, o caller usa a constante **9**, com máximo **10**.
Base e HEAD passam no oracle. O modelo descreveu uma falha se outro caller
passasse 10, reconheceu que o caller atual passa e ainda confirmou o candidato
na conversa causal. O caso falhou quatro vezes (confirmação, alcance, temperatura
e orientação de tipos). A alteração da condição pode ser uma mudança de contrato
quando esse contrato estiver apoiado por evidência; aqui o modelo inventou essa
premissa a partir do comportamento anterior. Preservamos a fixture, todas as falhas e o diagnóstico original, mantendo esse
cenário hipotético marcado como falso positivo na avaliação.

A repetição da ablação também impede atribuir economia ao repasse de receipts:

| Variante    | Positivos | Negativos | Requests |   Bytes | Tools físicas/lógicas | Hits | Mediana review + inventário |
| ----------- | --------: | --------: | -------: | ------: | --------------------: | ---: | --------------------------: |
| `repeated`  |       2/2 |       2/2 |       12 | 166.848 |                   4/6 |    2 |                     13,14 s |
| `receipts`  |       0/2 |       2/2 |        9 | 134.060 |                   4/4 |    0 |                     10,40 s |
| `full`      |       1/1 |       1/1 |        3 |  63.324 |                 12/12 |    0 |                     17,42 s |
| `selective` |       0/1 |       1/1 |        3 |  43.682 |                   2/2 |    0 |                     12,56 s |

Dois hits reais evitaram duas execuções físicas na variante `repeated`, enquanto
a admissão lógica foi preservada. Isso confirma o mecanismo em uma carga real
pequena, sem demonstrar economia sistemática por PR. O menor custo/latência de
`receipts` e `selective` veio acompanhado de perda dos positivos; é NO-GO para
ativação dessas hipóteses de otimização. Os ensaios não são comparação pareada
com repetições suficientes para estimar percentis ou significância.

### Gates após a continuação

| Gate                                           | Estado                                  | Fundamentação                                                                                    |
| ---------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Correção body-only e limites do inventário     | GO local                                | Regressões antes/depois, parser e inventário reais na bancada                                    |
| R02, benchmark real limitado                   | Entregue                                | Subject Think, oracles, limites, retomada e arquivo de todas as falhas                           |
| R03/R04, cache e índice                        | GO local; economia live limitada        | Dois hits reais; 148 tools físicas na campanha; não extrapolar                                   |
| R05, prefetch seletivo/completo                | Aberto/NO-GO para ativação              | Repetição perdeu positivos na variante seletiva; completo tem amostra mínima                     |
| R06, receipts e causalidade                    | Proveniência GO local; qualidade aberta | Refutação/integridade locais; protocolo real válido na última rodada, falso positivo persistente |
| Compatibilidade Think/rota/modelo              | Aberto                                  | Sete respostas finais válidas na última rodada não apagam falhas anteriores                      |
| R07/R08, quota ponderada e ganho real de lanes | Abertos                                 | Uma review com um shard sob quota de nove não prova concorrência entre nove shards               |
| R09/R10, reuso incremental e especialização    | Abertos                                 | Não ativados nem provados por essa campanha                                                      |

Encerramos novas chamadas nesta campanha porque repetir orientações sem uma
hipótese mais forte não resolve o falso positivo demonstrado. O saldo não gasto
não é obrigação de consumo. Próximos ensaios exigem adjudicação independente de
contrato/alcance e diagnóstico/severidade, repetição com casos novos e uma hipótese
capaz de atacar a confirmação indevida. O gate local completo é relatado no
[adendo de implementação](2026-10-08-review-core-implementation.md), separadamente
da qualidade do modelo. Não houve deploy, push, criação de PR ou publicação.

### Inspeção adicional em 2026-10-09

A resposta causal do negativo `inclusive-boundary` na rodada `schema-typing`
declarou `basis: "patch"` e `evidenceReceiptIds: []`, embora a justificativa
falasse do consumidor e presumisse um contrato inclusivo. Portanto, nessa rodada
não houve seleção não vazia de receipts em todos os três assessments. O schema
e o host aceitaram a forma atual, mas não demonstraram que a premissa fosse
autossuficiente. Isso especifica uma lacuna a investigar: a origem e o alcance
das premissas continuam declarados pelo modelo. Seleção de IDs comprova leitura
quando usada; não comprova contrato ou causalidade, nem detecta uma classificação
indevida como `patch`.

A próxima hipótese deve distinguir falha de uma invocação concreta de violação
de contrato explicitamente documentado, ligar as premissas às fontes e tratar
contraevidência observada. Um assessment mais estruturado permanece hipótese,
não prova automática de verdade. Acrescentar um controle com o mesmo caller
seguro e contrato inclusivo explícito evita resolver o falso positivo suprimindo
quebras reais de contrato.
