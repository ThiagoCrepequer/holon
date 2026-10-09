---
id: RESEARCH-REVIEW-CORE-CODE-FOLLOW-UP-2026-10-09
kind: research
status: current
owners: [core-team]
last-reviewed: 2026-10-09
---

# Continuação: defeitos de código e limites do Gemma

Esta investigação separa defeitos reproduzidos do host e da avaliação das
hipóteses sobre o modelo. Complementa a
[entrega F01–F08/R01–R10](2026-10-08-review-core-implementation.md) e o
[benchmark anterior](2026-10-08-review-core-live-benchmark.md). As alterações são
locais; não houve push, publicação, deploy nem troca de modelo ou rota.

Continuação após o PR #184 em 2026-10-09: o
[ajuste de cobertura](2026-10-09-review-context-coverage.md) amplia C03 e separa
omissões globais de perdas da projeção local, compartilha janelas de contrato e
fornece a política de severidade ao modelo. A tabela abaixo preserva o recorte
anterior, seus tetos e suas provas; a política vigente está na ADR-0060 e o novo
relatório conserva as três rodadas pagas, inclusive as reprovadas.

## Defeitos reproduzidos e corrigidos

| Achado                                         | Causa e consequência                                                                                                                                                                                    | Correção e regressão                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 — Telemetria interrompia revisão           | Um sink que lançava erro em planejamento, preparação de entrada ou `model.output_limits` alterava o resultado funcional.                                                                                | A entrada da análise protege o sink; diagnósticos têm emissão segura e identidade por shard. Testes fazem o sink falhar em quatro eventos e preservam finding, cobertura e veredito parcial.                                                          |
| C02 — Alias público ausente do inventário      | Uma mudança no corpo de `produce`, exportado como `payload`, procurava somente o nome local. O caller intacto podia ficar fora do contexto.                                                             | A AST do HEAD associa declaração local aos seus nomes públicos; o inventário procura ambos. Regressões de extração e relatório incluem import e chamada pelo alias.                                                                                   |
| C03 — Sinais omitidos antes da projeção        | Os tetos de 100 símbolos/referências e 50 contratos/superfícies descartavam sinais antes que a projeção pudesse contabilizá-los.                                                                        | `omittedSignals` registra perdas por categoria antes do corte. Projeção soma perdas posteriores, marca contexto limitado e apresentação informa o total. Regressão usa 101 símbolos e contagem acumulada na projeção.                                 |
| C04 — Identidade de Agent inconsistente        | A configuração aceitava índice fora da cardinalidade ou `prKey` divergente do `runId`, antes de iniciar o Workflow.                                                                                     | Schema valida ambas as relações na entrada. Testes Workerd provam rejeição antes do efeito e mantêm configuração válida.                                                                                                                              |
| C05 — Grader aprovava diagnóstico alheio       | Um finding na linha esperada bastava, mesmo acusando credencial exposta ou usando severidade incompatível com o caso.                                                                                   | Grader exige completude, localização, confiança, severidade pré-declarada e rubrica lexical por família; conserva os motivos de reprovação. Não atua como filtro de produção.                                                                         |
| C06 — Controles negativos tinham erro de tipos | O HEAD de `null-consumer.negative` estreitava o valor para `never`; `payload-field.negative` acessava campo ausente do tipo inferido. Execução sem falha não comprovava ausência de defeito TypeScript. | Tipos explícitos representam o contrato nullable/opcional. Positivos usam a asserção necessária para isolar a regressão de runtime. Todos os snapshots compilam estritamente e executam seus labels antes de inferência.                              |
| C07 — Harness apagava degradação independente  | Ao selecionar candidatos canônicos para confirmação causal, a avaliação removia candidatos inválidos sem preservar `evidence_rejected` e `isDegraded`. Produção já conservava essa informação.          | `prepareCausalCandidates` centraliza seleção e completude em `application`, usada pelo runtime e pelo harness. Teste mantém candidato válido e limitações anteriores quando outro é rejeitado.                                                        |
| C08 — Limites lexicais divergentes             | `\b` perde nomes com `$`, o JavaScript também perde letras Unicode, e a busca aceita fragmentos de identificadores maiores. Isso omite consumers ou gasta inventário com pistas alheias.                | `symbolReferencePattern` compartilha entre tracer e `rg` a fronteira de continuação de identificadores, incluindo `$` e join controls. Nove regressões red→green e cinco snapshots Docker com `rg` real preservam consumers e excluem nomes parciais. |

Cada correção comportamental foi precedida por regressão que falhou pelo motivo
relatado. A reprodução inicial de C02 tinha uma fixture incompleta; ela foi
corrigida antes de medir a falha real de descoberta do alias. Nenhum threshold,
fonte produtiva ou teste foi retirado para obter resultado verde.

## Organização e garantias verificadas

`review-analysis.ts` conserva preparação, planejamento, coordenação e agregação.
`review-shard-execution.ts` concentra a execução de uma parte, com um shard e sua
cardinalidade como entrada, projeção de configuração/memória, interpretação de
falhas e validação canônica. `review-diagnostics.ts` possui a emissão consultiva.
A separação reduz o módulo coordenador de 984 para 711 linhas e limita os serviços
exigidos pela execução, sem adicionar pacote, porta pública, SDK ou binding.
Quantidade de linhas é descrição do recorte, não prova de ganho de desempenho.

O ledger real foi exercitado com nove peers: sete gerações reservadas por shard
(quatro de investigação, duas causais e uma recuperação), reservas conservadas
após eviction, recusa da oitava chamada e proteção dos 96 tools globais contra
um shard que tenta consumir a parte dos demais. Isso prova admissão local,
persistência e isolamento de quotas; não mede nove inferências concorrentes no
provider nem latência remota de scheduling.

Casos Workerd com `invalid_suggestion`, `missing_investigations` e resposta final
ausente provam rejeição, terminalização, motivo persistido após eviction e
contabilidade da geração. O teste não reinterpreta saída inválida como válida.
A documentação oficial de Think, verificada em 2026-10-09, descreve erro quando
a resposta final não valida:
[Think em Workflows](https://developers.cloudflare.com/agents/harnesses/think/workflows/).
A frequência de outputs válidos continua uma questão empírica do modelo e do
protocolo; rejeitá-los corretamente não demonstra estabilidade semântica.

A correção C08 utiliza propriedades Unicode e classes negadas, sem lookaround,
para que o mesmo padrão funcione no JavaScript e no `rg` do container. A gramática
de identificadores e o suporte do engine foram conferidos em 2026-10-09 nas fontes
primárias [ECMAScript](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-names-and-keywords)
e [regex Rust](https://docs.rs/regex/latest/regex/#unicode). A compatibilidade do
padrão concreto foi comprovada com Git/`rg` reais na imagem registrada em
[results.json](experiments/2026-10-09-identifier-boundaries/results.json), usando
`$load`, `load$`, `área`, `用户` e `load`. Nos cinco casos, somente produtor e
consumer entraram no inventário, sem truncamento; arquivos com nomes maiores
incluindo `$`/join controls ficaram fora. A pista continua lexical, sem resolução
de strings com escapes ou grafo completo de imports. Não houve inferência paga
nessa prova nem medição comparativa de performance.

## Avaliação real deste recorte

O perfil manual `--quality-check --structural-context --code-regression` usa um
par novo `aliased-consumer`, com labels e rubricas fixados antes da inferência,
compilação estrita e oracles executáveis de base/head. O inventário é preparado
pelas ferramentas reais na imagem Docker imutável, sem rede. Think e as quotas
do Agent são reais; somente transportes externos são adaptados para o ambiente
local. O perfil mantém Gemma na rota autorizada e o teto financeiro acumulado
de US$ 0,50, sem renovar o orçamento.

Na rodada de 2026-10-09T13:51 UTC, os dois casos passaram: o positivo produziu
um finding `high`, confiança 1, localizado no produtor e com confirmação causal
apoiada no receipt do consumidor; o negativo leu a guarda e terminou sem finding.
Não houve falha de execução, schema inválido ou candidato rejeitado nesta rodada.
O inventário incluiu o consumidor nos dois casos, sem truncamento. Os artefatos
[do recorte](experiments/2026-10-08-live-review/README.md#arquivo-de-evidências)
preservam as respostas sintéticas e 31 hashes de fontes verificados pelo
[analisador offline](experiments/2026-10-08-live-review/analyze.mjs).

| Métrica do recorte                         |               Resultado |
| ------------------------------------------ | ----------------------: |
| Casos aprovados                            |                     2/2 |
| Chamadas reais / input / output informados | 5 / 15.938 / 694 tokens |
| Tools lógicas / físicas / hits             |               2 / 2 / 0 |
| Revisão positiva / negativa                |      18,318 s / 5,427 s |
| Inventário positivo / negativo             |       3,477 s / 2,531 s |
| Custo informado pelo provider              |         US$ 0,001088970 |

Respostas identificaram `google/gemma-4-26b-a4b-it`, com um attempt reportado
como `:free`; são endpoints da mesma família configurada, sem mudança de rota.
A campanha, incluindo a repetição abaixo, passou a 253 requests,
US$ 0,062482311 informados e exposição conservadora US$ 0,180025698, com onze
custos ainda desconhecidos. Restam US$ 0,319974302 do teto conservador. O subtotal informado não é fatura completa
de todos os attempts internos do provider.

C02 fecha como correção de descoberta determinística, com regressão local
red→green e composição real exercitada. O par não compara dois braços de
inventário com o modelo nem demonstra ganho geral de recall, custo ou latência.
A única repetição posterior verifica o estado após C08 e foi preservada
integralmente. A
justificativa causal ainda usa a descrição imprecisa de que a asserção `!`
falha em runtime; o efeito observado é o acesso `.id` em `null`, pois TypeScript
apaga a asserção. O grader lexical não detecta essa nuance, outro limite da
interpretação do modelo e da adjudicação automatizada.

Na [repetição de 2026-10-09T14:14 UTC](experiments/2026-10-08-live-review/README.md#arquivo-de-evidências),
o par passou novamente 2/2: cinco chamadas, 15.414 tokens de entrada e 741 de
saída, duas tools lógicas/físicas, US$ 0,001330920 informados. Revisões positiva
e negativa duraram 22,093 s e 7,276 s; não houve falha/rejeição de evidência.
Os 32 hashes capturados foram verificados. As duas rodadas deste recorte somam
dez chamadas e US$ 0,002419890 informados. São repetições da mesma família,
sem tuning do prompt e sem independência estatística; não demonstram ganho de
velocidade nem superam o falso positivo de outra família.

## Verificação local

Passaram 98 regressões focadas Workerd (análise, Agent, geração, Think, integração
causal, fatia vertical e grader), 162 testes de `application`, 208 de
`repository-analysis`, 14 testes de arquitetura e o typecheck de control plane.
Os 18 testes Node incluem lock financeiro, os quatorze pares de snapshots com
compilação/execução e rejeição explícita de erro estático. Não consomem modelo.

O `pnpm verify` final passou após C08, com Node 24.19.0 e pnpm 11.24.0:
marca/configuração, formatação, lint, 21 tarefas de typecheck, arquitetura,
32 tarefas de cobertura e 17 de build/dry-run, incluindo a imagem Docker.
O recorte dos onze workspaces de core soma 1.441 testes Vitest mais 18 Node
(1.459); o gate também passou os demais workspaces e suas provas de browser.
Não houve alteração de thresholds ou exclusão de produção. A conferência final
de formatação, links locais, `git diff --check` e reconciliação financeira também
passou. Os metadados estão em
[verification.json](experiments/2026-10-09-review-core-code-follow-up/verification.json).

| Workspace             | Testes Vitest | Statements | Branches | Functions |  Lines |
| --------------------- | ------------: | ---------: | -------: | --------: | -----: |
| `contracts`           |           145 |     96,51% |   90,24% |    94,87% | 97,83% |
| `application`         |           162 |     96,04% |   89,75% |    98,05% | 97,23% |
| `repository-analysis` |           208 |     97,04% |   90,30% |      100% | 97,33% |
| `model`               |            46 |     97,32% |   92,57% |    98,27% | 98,08% |
| `repository-executor` |           130 |     92,47% |   87,10% |    93,22% | 92,83% |
| `control-plane`       |           384 |     92,00% |   86,37% |    93,94% | 93,29% |

Avisos de sourcemaps e request pendurado do Workerd ocorreram nos testes
controlados e no harness real, apesar de ambos terminarem com exit code zero.
Não foi demonstrada ausência desses avisos em produção.

## O que permanece aberto

O falso positivo causal de `inclusive-boundary.negative` já observado tem
snapshot TypeScript válido e caller abaixo do limite. O modelo reconheceu o
caller seguro, mas sustentou um contrato inclusivo/input hipotético sem prova
independente. Não há defeito determinístico do host comprovado que autorize
suprimir esse finding por palavras do diagnóstico. A hipótese de limitação de
raciocínio continua aberta até comparação controlada com modelo mais capaz.

A instabilidade de schema observada nas rodadas anteriores permanece como
qualidade de geração/protocolo a medir. A proteção do host foi comprovada; a
causa não foi isolada exclusivamente na capacidade do Gemma. Nenhum ensaio com
outro modelo foi realizado. O gate global de precisão/estabilidade continua
aberto, mesmo se este par novo passar.

O histórico de controles C06 é preservado, mas seus erros de compilação impedem
interpretar todo finding antigo como falso positivo do modelo. As fixtures novas
não são o mesmo baseline; comparações precisam repetir os dois braços com as
mesmas fontes. Rubricas lexicais eliminam diagnósticos obviamente alheios, mas
não provam equivalência semântica nem adjudicação humana independente.

Prefetch adicional, ponderação de geração, skipping incremental e especialistas
continuam propostas condicionais R05/R07/R09/R10, sem ativação. Não são falhas
ativas de código a corrigir por meio de recursos novos. CI, GitHub App privada,
produção e integração Cloudflare remota não são demonstradas por este recorte.

## Integração para o PR — 2026-10-09

A preparação do PR incorporou a `main` em
`6dcb7e5279a0b413985d401cc90290a62a1f39a9`, incluindo os perfis de orçamento
da ADR-0055 e as entregas do dashboard. Os ADRs locais foram renumerados para
0056–0058, preservando conteúdo e referências; a
[ADR-0059](../decisions/0059-compose-stable-review-lanes-with-budget-profiles.md)
substitui explicitamente as regras concorrentes de admissão/quota, sem reescrever
decisões aceitas nem zerar dívida. Lanes e liberação de saldo conservam a ordem
resultado persistido → conclusão idempotente → próxima parte.

O gate completo passou novamente nessa composição, com 21 tarefas de typecheck,
32 de cobertura e 17 de build/dry-run. Os onze workspaces de core somam 1.493
testes Vitest e o harness mantém 18 testes Node (1.511 no recorte). A retirada
dos quatro testes de `review-admission` vem da substituição dessa política na
main, com testes dos perfis atuais preservados; não foi redução de cobertura
para aprovar o gate. Os thresholds permanecem iguais. Os 412 links locais
conferidos estavam válidos. Metadados e cobertura atuais estão em
[pr-integration-verification.json](experiments/2026-10-09-review-core-code-follow-up/pr-integration-verification.json).

Nenhuma chamada paga foi feita nessa preparação. A reconciliação offline
reconfirmou 253 requests históricos, US$ 0,062482311 informados e exposição
conservadora de US$ 0,180025698 no teto de US$ 0,50. Snapshots `.source`, planos
e resultados permaneceram intactos. A ponderação de geração antes condicional
foi incorporada pela ADR-0055 da main; o benchmark antigo não comprova sua
qualidade real. Precisão/estabilidade do Gemma e avaliação dos perfis maiores
continuam abertas; as provas locais desta composição não equivalem a CI ou
produção.
