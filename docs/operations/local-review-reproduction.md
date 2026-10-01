---
id: OPS-LOCAL-REVIEW-REPRODUCTION
kind: operation
status: current
owners: [core-team]
last-reviewed: 2026-10-01
---

# Reproduzir o PR #106 sem publicar uma revisão

O runner está em `apps/control-plane/local-review/`. Usa código atual contra o
snapshot imutável do incidente, em vez de alterar o checkout ou depender do head
atual do PR:

- Base: `b34acd285eaf0f59cfca6e9b7ffa53d5f5f80c5b`.
- Head: `7299188ca10cd4f20c5c63a05a96f993ee12c216`.
- Expectativa: 32 arquivos elegíveis, 1.368 linhas alteradas, oito shards.
- Configuração lida do objeto Git da base pelo leitor de produção.

## Execução offline

Use Node 24, pnpm 11.24.0, Docker e os dois objetos Git disponíveis localmente.
A imagem `holon-repository-executor-holonsandbox:worker` é construída pelo
`pnpm build` do projeto. O runner falha se imagem ou commits estiverem ausentes;
não faz fetch, instala dependências ou busca credenciais automaticamente.

```sh
pnpm --filter @holon/control-plane test:local-review
```

O Docker monta objetos Git somente para leitura, sem rede, com filesystem de imagem
somente leitura, CPU/memória limitadas e workspace temporário. Cada cenário cria seu
container e o compartilha entre os shards. O ledger solicita cleanup pelo binding
local, que destrói esse container; um `finally` cobre falhas do runner. Nenhum teste
executa scripts do repositório ou publica no GitHub. O servidor local usa porta
aleatória, loopback e capacidade aleatória; limita o tamanho de requests.

São reais: planejamento, composição do reviewer, AI SDK e parsing, reservas SQLite,
preparação de contexto/inventário, ferramentas do executor, verificação de evidência,
reconciliação, serialização da publicação e alarm do ledger. São adaptados:
transporte do Sandbox, steps imediatos do Workflow, sessão GitHub e resposta HTTP
do provider. A sessão coleta os efeitos que seriam enviados ao GitHub.

Cenários:

1. Conclusão completa sem achados: `APPROVE`.
2. Dois checkpoints inválidos seguidos de reparo por parte: `APPROVE`, com rejeições registradas.
3. Defeito proposital adicionado apenas ao snapshot temporário: `REQUEST_CHANGES` e comentário na linha 3.
4. Falha permanente de provider numa parte: comentário informativo, sem aprovação.
5. Checkpoints persistentemente inválidos: incompletude, sem aprovação e encerramento limitado.

O terceiro caso testa transporte, evidência e publicação de um achado conhecido;
o provider simulado recebe uma resposta programada. Não demonstra detecção pelo modelo.
A suíte normal pula esse runner quando não há bridge; o comando explícito acima
é obrigatório para validar essa composição com Docker. `pnpm verify` continua
validando os testes unitários/Workers e os limites de cobertura existentes.

## Avaliação local com modelo real

Esta modalidade envia contexto privado para um serviço externo e consome tokens.
Exige autorização explícita e credencial com acesso ao gateway pretendido. Não
confundir com teste offline. A credencial fica somente no processo, nunca na fixture.

```sh
AI_GATEWAY_ACCOUNT_ID='<conta autorizada>' \
AI_GATEWAY_ID='<gateway autorizado>' \
HOLON_CREDENTIAL_FILE='<arquivo local com CLOUDFLARE_API_TOKEN>' \
pnpm --filter @holon/control-plane test:local-review --live
```

Também aceita `CLOUDFLARE_API_TOKEN` no ambiente. A rota é `dynamic/pr-review`.
O modo live envia apenas o shard de índice 3; os outros sete mantêm respostas
simuladas. Limites independentes: quatro requests externos, 300.000 bytes cumulativos
de request, até 180 segundos por chamada (o mesmo teto do core), resposta de até 1 MB.
O cancelamento do caller é propagado ao relay e à conexão externa. Os máximos de saída do
ledger continuam aplicados. Limites excedidos fazem o teste falhar, sem ampliar
automaticamente o orçamento. O Gateway recebe instrução de não coletar payload de
log e de ignorar cache. Metadados identificam `local-evaluation`/`pr106-shard3`.

O relatório registra contagens, status e veredito, sem prompts, código, respostas
ou credenciais. Um teste live verde dessa parte não comprova a revisão real das oito
partes, a estabilidade estatística do provider, custos de produção ou a operação
remota de Workflows/GitHub/Sandbox. Antes de ampliar uma avaliação, inspecione a
primeira execução e defina um orçamento explícito; não repita automaticamente.

Depois de autorização específica para expor todos os shards ao mesmo destino, use
`--live-all` no lugar de `--live`. O runner então envia os oito shards ao provider,
com teto próprio de 64 requests e 4.800.000 bytes de requests, além dos limites
duráveis do ledger. O teste exige revisão completa; mesmo quando ela termina
incompleta, registra primeiro o veredito coletado e confirma o cleanup antes de
falhar. Os dois modos continuam sem publicar no GitHub.

Para diagnóstico local de um modelo alternativo, acrescente `--live-deepseek` a
qualquer modo live. O relay seleciona diretamente
`openrouter/deepseek/deepseek-v4.1-flash`, mantendo a restrição de provider
configurada na conta OpenRouter; não altera a rota remota `dynamic/pr-review`.
Nesse modo, o relay espaça o início das chamadas por 15 segundos. No shard único,
os tetos locais são oito requests e 600.000 bytes. Resultados desse modo medem
o modelo alternativo, não validam a rota de produção.

## Evidência local em 2026-09-29

Os cinco cenários offline passaram. Com o provider programado, o cenário normal
fez 25 requests de modelo simulados e oito consultas reais ao executor; o cenário
de reparo fez 41 requests simulados e registrou 16 rejeições. A fixture com defeito
produziu uma publicação `REQUEST_CHANGES` e um comentário inline. Todos os cenários
confirmaram cleanup concluído no ledger e destruição do container. `pnpm verify`
passou sem alteração dos limites de cobertura. Esses números não estimam custo
ou qualidade de um modelo real. O modo live não foi executado nesta evidência.

## Primeira avaliação com modelo real: 2026-09-29

Com autorização explícita, o comando `test:local-review --live` foi executado
sobre `c7717a2`. Falhou em 191,9 segundos: registrou dois `provider_transient` e
dois `model_budget_exhausted`. O assert impediu considerar o resultado aprovado.
Não houve publicação no GitHub. O `finally` encerrou o container; nenhuma outra
inferência foi disparada após a falha.

O Gateway retornou dois registros concluídos de `deepseek/deepseek-v4.1-flash`,
ambos HTTP 200, com durações de 14.666 e 51.761 ms. Somam 19.371 tokens de entrada,
1.958 de saída e US$ 0,0081609 de custo registrado. Isso não é uma fatura completa
nem contabiliza eventuais requests cancelados sem registro concluído.

O runner daquele commit tinha um timeout próprio de 60 segundos, inferior aos
180 segundos do core, e convertia exceções do relay em HTTP 500 sem causa segura.
Também omitia fase/dimensão do orçamento no relatório. A sequência e a duração
são compatíveis com timeout local, retenção conservadora da reserva e recusa
posterior, mas os dados disponíveis não confirmam a causa original. Não é prova
de indisponibilidade do modelo nem reprodução fiel do timeout de produção.

Após essa execução, o runner passou a usar o teto do core, propagar cancelamento
e registrar duração/categoria segura do transporte, fase e dimensão do orçamento.
Os watchdogs do processo e do teste também respeitam a janela do core, com margem
para encerramento. Essa mudança foi validada offline; não houve uma segunda rodada
paga. A conclusão real do shard e das oito partes permanece sem validação.

## Segunda avaliação com modelo real: 2026-09-29

A segunda rodada foi explicitamente autorizada e executada sobre `ca7edd0`, com o
mesmo snapshot e teto de quatro requests/300.000 bytes. Falhou em 411,2 segundos.
Apenas o shard de índice 3 usou inferência real; os demais permaneceram simulados.

Sequência observada:

1. Duas respostas HTTP 200; o relay mediu 13.906 e 32.982 ms.
2. A investigação fez quatro consultas de repositório. A terceira rodada atingiu
   `generation_step_timeout`; o relay registrou `transport_timeout` em 180.012 ms.
3. A tentativa seguinte foi recusada antes da inferência: `output_tokens`, limite
   6.808, consumido/reservado 6.808, solicitado 8.192.
4. A finalização também expirou: `phase_budget_exhausted`, com `transport_timeout`
   no relay em 180.007 ms.
5. A recuperação foi recusada antes da inferência: `output_tokens`, limite 15.000,
   consumido/reservado 15.000, solicitado 8.192.

O esgotamento da parcela foi consequência das reservas mantidas após chamadas
sem usage confirmado. Não é evidência de 15.000 tokens efetivamente gerados ou
cobrados. A reserva de conclusão permitiu tentar a finalização, mas não garantiu
que o serviço externo a concluísse. As quatro consultas não indicam, neste caso,
exploração excessiva do repositório.

Os dois registros concluídos no Gateway identificam `deepseek/deepseek-v4.1-flash`,
com 19.384 tokens de entrada, 1.540 de saída e US$ 0,0076632 de custo registrado.
Não há valor confirmado para eventuais chamadas canceladas sem registro concluído.
O container foi destruído e não houve publicação, deploy ou terceira rodada.

A validação real continua reprovada. Pelo código e pela contagem de consultas,
a terceira rodada exigia `review_checkpoint`; a finalização exige saída
estruturada. Essa associação orienta o próximo diagnóstico, mas não demonstra
incompatibilidade do modelo: os registros ainda não distinguem problema de rota,
provider, contrato da requisição ou demora durante a resposta. Antes de outro teste
com o PR inteiro, isolar esses dois formatos em casos mínimos e rastreáveis, sob
novo orçamento explicitamente autorizado. Não aumentar os tetos para tratar a
recusa secundária como se fosse a falha inicial.

## Terceira avaliação com modelo real: 2026-09-30

Após alteração da rota pelo operador para tentar `openai/gpt-oss-20b:free` e,
depois, `openai/gpt-oss-20b`, uma nova rodada do mesmo comando live foi
explicitamente solicitada. A rota ativa ainda continha quatro fallbacks DeepSeek,
e todos os nós registravam `timeout: 0`. O operador informou ter restringido o
provider ao CoreWeave no OpenRouter; o log do Gateway identifica apenas o
provider intermediário `openrouter`, então não confirma o endpoint final.

O replay reprovou em 16,56 segundos. O shard de índice 3 fez dois requests reais,
ambos HTTP 200, com 7.809 e 1.705 ms medidos pelo relay. Os logs concluídos do
Gateway mostram `openai/gpt-oss-20b`, 13.240 tokens de entrada, 170 de saída e
US$ 0,0003368 de custo registrado. Os demais sete shards usaram respostas
simuladas. O shard real encerrou a investigação na primeira rodada com zero
consultas ao repositório, motivo `checks_unresolved` e limite
`investigation_incomplete`. O assert do cenário recusou considerar esse resultado
aprovado. Não houve timeout nesta rodada, publicação no GitHub ou container
remanescente.

Duas sondas adicionais, com prompts sintéticos sem conteúdo do repositório,
usaram a mesma rota: `tool_choice` para `review_checkpoint` retornou uma chamada
da função exigida; `response_format` com JSON Schema retornou o objeto válido.
Ambas tiveram HTTP 200 no `openai/gpt-oss-20b`, somando US$ 0,000012856 nos logs
concluídos. Isso comprova esses contratos mínimos, não a execução correta do
review completo. O modelo não escolheu ferramentas na primeira rodada do replay,
que usa `toolChoice: auto`; as verificações permaneceram abertas. Os registros
não mostram se a variante gratuita foi tentada nem por que a rota selecionou a
variante paga. Não repetir o PR inteiro antes de isolar a decisão de ferramentas
em `auto` e revisar o critério de progresso da investigação.

## Quarta avaliação e correção local: 2026-09-30

O usuário autorizou investigação, ajustes e novas inferências locais até corrigir
o problema, sem solicitar confirmação a cada rodada. A primeira mudança exigiu
`tool_choice: required` quando havia verificações rastreadas. O teste de regressão
falhou antes dessa mudança e passou depois, junto dos 107 testes do package de
modelo. Duas execuções live ainda reprovaram na primeira rodada: o relay confirmou
que enviou `required`, mas recebeu HTTP 200 com `finish_reason: stop` e zero
chamadas de ferramenta. Isso distingue uma preferência correta do host de um
comportamento não cumprido pela rota/provider. O log do Gateway continuou
identificando `openai/gpt-oss-20b` via `openrouter`, sem identificar o endpoint
interno.

O host agora faz uma única continuação com a função `review_checkpoint`
selecionada explicitamente quando a primeira rodada rastreada termina apenas em
texto, sem ferramentas e com verificações abertas. Reutiliza mensagens, prazos,
orçamento de ferramentas e reservas de tokens; caso a função também não seja
chamada, permanece `investigation_incomplete`. O teste focado foi escrito para
falhar pelo motivo observado antes da correção e cobre também a recusa da função
forçada. Os 107 testes do modelo e os cinco cenários offline do replay passaram.
O gate local completo (`pnpm verify`) também passou após a correção, incluindo
formatação, lint, typecheck, cobertura e build/dry-runs com Docker.

No replay live limitado após a correção, o shard 3 passou: a primeira chamada
retornou texto sem ferramenta, a segunda chamou `review_checkpoint` quando
selecionado e a terceira finalizou. Foram três HTTP 200 no
`openai/gpt-oss-20b`, 19.686 tokens de entrada, 247 de saída e US$ 0,000500128
de custo registrado no Gateway. O teste terminou com `APPROVE`, sem limitações
de investigação nem rejeições de checkpoint. Sete shards permaneceram simulados;
nenhuma publicação foi enviada ao GitHub e o container local foi destruído.
Isso comprova o protocolo e a composição neste shard, não a qualidade dos
findings nem a conclusão real de todos os oito shards.

## Quinta avaliação: oito shards e comparação de modelo, 2026-09-30

Com autorização explícita, o replay privado `--live-all` foi executado no
snapshot imutável do PR #106, sem publicação. A primeira tentativa parou por uma
falha do adaptador local: ele convertia uma recusa de consulta `path_denied` em
HTTP 500. O adaptador passou a devolver o mesmo erro estruturado de consulta
que o executor de produção. O typecheck passou depois desse ajuste.

Na segunda tentativa, os oito shards receberam respostas reais da rota
`dynamic/pr-review`, que selecionou `openai/gpt-oss-20b` no Gateway. O replay
terminou sem revisão completa: seis shards registraram
`investigation_incomplete`, dois alcançaram o limite de seis chamadas de modelo
na investigação e um recebeu falha de provider classificada permanente, apesar
do status HTTP 200. Houve recusas `path_denied` tratadas como erros de consulta.
O teste reprovou antes de aceitar a revisão como completa; nessa tentativa o
veredito coletado não chegou a ser inspecionado. Os dois replays de
oito shards somaram 38 registros HTTP 200, 381.956 tokens de entrada, 7.448 de
saída e US$ 0,01000112 de custo conhecido no Gateway; essa soma inclui a
tentativa interrompida e não representa a fatura completa.

Consultas sintéticas, sem contexto do repositório, mostraram diferenças de
protocolo: `openai/gpt-oss-120b` na CoreWeave chamou ferramenta com
`tool_choice: auto`, mas retornou `finish_reason: error` quando se exigiu
`required`. `deepseek/deepseek-v4.1-flash` na CoreWeave chamou ferramenta com
`required` e com função específica. Uma avaliação do shard 3 com DeepSeek sem
espaçamento recebeu HTTP 429. Com 15 segundos entre inícios de requests, as
sete chamadas retornaram HTTP 200, mas o shard encerrou por falta de progresso
de cobertura após oito consultas ao repositório: veredito coletado `COMMENT`,
sem aprovação. O Gateway registrou 89.853 tokens de entrada, 2.833 de saída e
US$ 0,02809758 para essa última avaliação. Nenhuma rota ou recurso remoto foi
modificado. Os metadados do Gateway e o [catálogo de endpoints do OpenRouter](https://openrouter.ai/docs/api/api-reference/endpoints/list-endpoints)
não provam estabilidade de ferramenta em uma execução real completa.
Após os ajustes do runner, os cinco cenários offline e `pnpm verify` passaram.

## Sexta avaliação: checkpoint restrito e Nemotron, 2026-09-30

O runner local passou a permitir `--live-nemotron` com seleção explícita do
`nvidia/nemotron-3.5-lightning-20260807` na CoreWeave. Uma consulta sintética
confirmou chamadas de função com `required` e com seleção de função específica.
Na primeira tentativa de um shard, o modelo enviou um identificador de check
que não existia naquele shard. O contrato publicado da ferramenta aceitava
qualquer string curta, embora o host rejeitasse IDs desconhecidos. O schema
anunciado de `review_checkpoint` agora enumera os IDs reais do shard; um teste
de regressão cobre esse contrato. O runner registrou apenas a categoria da
falha de forma, sem valores de checklist ou argumentos do modelo.

Com esse ajuste, o replay limitado do shard 3 passou em três HTTP 200, com
checkpoint válido, `APPROVE` e sem limitação. Em seguida, o replay privado dos
oito shards teve 42 chamadas HTTP 200 e 21 consultas ao repositório, mas
terminou com `COMMENT` e reprovou o assert de completude: quatro shards
registraram `model.output_limits`. Os shards 0 e 1 esgotaram os 372.000 bytes
de entrada permitidos à investigação de cada um; o shard 5 esgotou as seis
chamadas da fase; os shards 4 e 7 conservaram checks não resolvidos. A
recuperação do shard 7 esgotou sua parcela de tokens de saída. Houve uma
rejeição de checkpoint misturado com consulta. Respostas de finalização
atingiram o teto de 8.192 tokens. A limpeza do checkout local terminou.

Assim, restringir IDs elimina um erro de contrato reproduzido, mas não resolve
o PR inteiro. Os limites de gasto e a exigência de cobertura continuam
aplicados; aumentar tetos ou aceitar uma revisão incompleta exigiria uma nova
decisão. A rota dinâmica remota e os recursos de produção não foram alterados.

Duas sondagens adicionais de um shard, selecionando diretamente
`qwen/qwen3-30b-a3b-instruct-2507` e `moonshotai/kimi-k2.6`, receberam HTTP
404 antes de qualquer saída do modelo. A lista pública de provedores do
OpenRouter não demonstrou disponibilidade desses endpoints na configuração
restrita a CoreWeave deste Gateway. Nenhum replay completo foi iniciado para
esses modelos; os seletores experimentais foram removidos do runner.

## Sétima avaliação: DeepSeek como primeiro nó, 2026-10-01

Antes da rodada, a versão implantada da rota `pr-review` era
`5b966976-5fa3-45d1-8afc-b32e0bbc965e`, criada em
`2026-10-01 12:06:58` conforme a API do Gateway. O primeiro nó era
`deepseek/deepseek-v4.1-flash` via OpenRouter, com fallback para
`openai/gpt-oss-20b`. A mesma versão foi confirmada depois da execução.

O relay local passou a registrar, por chamada, shard, fase, ordinal, status,
modelo/provider retornados, duração, espera de pacing, bytes de request e
resposta, tokens de entrada/saída/raciocínio, motivo de término, tipos de
ferramenta e categoria de validade de checkpoint. O observer do host registra
progresso de cobertura, consultas/cache, limites e fases para cada shard. Esses
logs não contêm prompts, diffs, conteúdo de arquivos, argumentos ou respostas
do modelo. O modo `--pace-live` mantém 15 segundos entre inícios de requests
sem selecionar outro modelo; foi usado com `--live-all` para testar a rota
implantada e evitar o HTTP 429 observado anteriormente sem pacing.
`durationMs` inclui a espera na fila local; não mede isoladamente a latência do
provider.
Nesta execução, o logger antigo classificou `tool_choice` ausente na
finalização como `specific_function`; isso era uma classificação incorreta do
logger, corrigida após a rodada. Não altera o request enviado nem o resultado.

Os cinco cenários offline passaram antes do envio privado. O replay real levou
744,5 segundos, fez 49 chamadas HTTP 200 (47 DeepSeek e duas
`gpt-oss-20b`, ambas via CoreWeave), 53 consultas efetivas ao repositório e
terminou com `COMMENT`. Foram enviados 2.956.824 bytes de requests. As
respostas reportaram 769.118 tokens de entrada e 61.759 de saída; 52.954 dos
tokens de saída eram de raciocínio. Esses são dados de usage das respostas,
não uma fatura. Não houve HTTP 429, erro de transporte nem falha estruturada
de consulta. A rota de fallback respondeu com `gpt-oss-20b` em duas chamadas
HTTP 200; o relay não vê a causa da seleção dentro do Gateway.

O assert de completude reprovou: sete shards registraram
`model.output_limits`, e o oitavo terminou a recuperação com orçamento de
saída esgotado. Por shard:

| Shard | Cobertura no último progresso | Encerramento da investigação | Falha relevante                                                                  |
| ----- | ----------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| 0     | 0 revisados, 8 pendentes      | `model_budget_exhausted`     | bytes de entrada; finalização e recuperação terminaram em `length`               |
| 1     | 0 revisados, 6 pendentes      | `model_budget_exhausted`     | bytes de entrada                                                                 |
| 2     | 0 revisados, 1 pendente       | `model_budget_exhausted`     | bytes de entrada; finalização respondeu via fallback `gpt-oss-20b`               |
| 3     | 0 revisados, 1 pendente       | `checks_unresolved`          | uma rodada respondeu via fallback `gpt-oss-20b` sem ferramenta exigida           |
| 4     | 0 revisados, 1 pendente       | `checks_unresolved`          | um checkpoint fora do schema e uma investigação em `length`                      |
| 5     | 3 revisados, 2 pendentes      | `model_budget_exhausted`     | seis chamadas de investigação consumidas                                         |
| 6     | 0 revisados, 3 pendentes      | `model_budget_exhausted`     | bytes de entrada                                                                 |
| 7     | 0 revisados, 7 pendentes      | `checks_unresolved`          | investigação e finalização em `length`; recuperação recusada por tokens de saída |

Houve dez chamadas de `review_checkpoint`: nove passaram pela validação de
forma do relay e uma falhou; o host registrou uma rejeição. Cinco respostas
terminaram em `length` (investigação nos shards 4 e 7, finalização nos shards
0 e 7, recuperação no shard 0). Em cada uma, todos os tokens de saída
reportados eram de raciocínio, sem conclusão útil daquela chamada. A
finalização do shard 0 consumiu 8.192 tokens assim; a recuperação, mais 4.416.
O relatório foi coletado, o cleanup local concluiu e nenhuma revisão foi
publicada no GitHub. A execução demonstra incompatibilidade prática desta
rota/configuração com a conclusão do PR #106 sob os limites atuais; não
identifica sozinha se mudar modelo, parâmetros de raciocínio, contexto ou
política de orçamento é a correção apropriada.
