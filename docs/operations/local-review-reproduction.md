---
id: OPS-LOCAL-REVIEW-REPRODUCTION
kind: operation
status: current
owners: [core-team]
last-reviewed: 2026-09-30
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
