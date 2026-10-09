---
id: RESEARCH-REVIEW-CORE-IMPLEMENTATION-2026-10-08
kind: research
status: current
owners: [core-team]
last-reviewed: 2026-10-09
---

# Implementação e evidência das melhorias do core

Este relatório liga a [auditoria F01–F08](2026-10-08-review-core-audit.md) ao
[plano R01–R10](../planning/review-core-improvement-proposal.md). O baseline é
`1941a4f`; código, testes e documentação foram alterados localmente. A
[ADR-0056](../decisions/0056-preserve-review-evidence-and-schedule-stable-lanes.md)
registra a arquitetura resultante. Não houve push, deploy nem avaliação com
provider remoto.

## Correções dos achados

| Achado | Correção                                                                                                                           | Prova principal                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| F01    | Índice une fragmentos por coordenada e rejeita sobreposições conflitantes; agregação preserva o segundo fragmento                  | `application/test/evidence-diagnostics` e `aggregate-reviews`, com planner e arquivo de 800 linhas |
| F02    | Excerpts/fingerprints preservam espaços, regex, literals e indentação; normalizam somente CRLF                                     | Regressões de evidência/fingerprint; identidade antiga não reaplica feedback por fallback          |
| F03    | `search_structure` oferece somente JS/JSX/TS/TSX, também no executor e prompts                                                     | Contratos, política de execução e testes do executor                                               |
| F04    | Evidência inventada falha integridade bruta; execução falha continua no denominador operacional                                    | Runner/grader: candidato rejeitado, subject inválido/falho e suites positivas incompletas          |
| F05    | Projeções de quantidade/bytes mantêm entradas JSON completas e contagem de omissões; baseline não é cortado em oito antes de medir | Prompt/projeção: 21 hints, UTF-8, entrada grande seguida de pequena e categorias estruturais       |
| F06    | União discriminada sucesso/falha, oito findings, resumo obrigatório para completude e IDs/índices únicos do plano                  | Agregação: duplicação, unknown ID, índice errado, ausência, rejeição e limitação sem flag          |
| F07    | Lookup inconclusivo não autoriza POST e conserva claim pendente                                                                    | Publicação aceita com resposta perdida e marcador na página 21; apenas um request externo          |
| F08    | Feedback deduplicado e conflitos separados; resolução de thread não é falso positivo; nenhuma inferência de veredito de PR         | Calibração: duplicatas, conflitos, denominador inválido, resolução e ausência de feedback          |

Os testes antigos que esperavam equivalência por espaços, 96 chamadas de um
shard com peers desprotegidos ou erros removidos do recall foram atualizados para
as novas regras, mantendo as provas de teto, persistência e consequência. Doubles
do executor recusam comandos desconhecidos; sucessos genéricos foram removidos.

A revisão final também provou uma âncora multilinha que atravessa fragmentos
adjacentes: todas as coordenadas precisam existir e concordar; lacuna continua
inválida. As políticas de publicação agora exercitam prioridade, limite zero/40,
identidade ambígua, recuperação de comentário ausente e os três idiomas. Uma
regressão adicional em Workerd demonstrou que erro de telemetria podia invalidar
read autorizado; o log foi isolado do resultado e o teste passou após a correção.
Os timings de fases também passaram a usar a identidade estável do step; uma
regressão reproduziu cinco medições com um único ID e confirmou IDs distintos
após a correção, preservando a utilidade das medidas por etapa.

## Implementação do plano e gates

| Entrega | Implementado e exercitado localmente                                                                                                                                     | Limite/condição restante                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| R01     | Todas as correções determinísticas F01/F02/F03/F05/F06/F07, contratos e consumidores                                                                                     | Reconciliação limitada pode exigir operador; não foi adicionado cursor durável                                 |
| R02     | Métricas brutas/finais/operacionais, calibração F04/F08, corpus pareado, holdout por família, doubles estritos, fatia vertical Think→ledger→tools→evidência→publicação   | Corpus sintético revisado por agente, sem adjudicação humana independente; não mede qualidade live             |
| R03     | Índice por snapshot reutilizado na validação e agregação, docs deduplicadas por referência/versão/hash com concorrência dois, timings de checkpoints/fases/tools/cleanup | Dados locais não demonstram qual etapa domina latência real de provider                                        |
| R04     | Cache por run/política/query, coalescência, quotas lógicas, reautorização e cleanup; testes de hit negado e cancelamento independente                                    | Efêmero, perdido em eviction; vazio/truncamento/erro não são reutilizados                                      |
| R05     | Agrupamento por relações determinísticas, referências em produtor e consumidor, limites/omissões mantidos                                                                | Co-localização estática não prova ganho de recall; prefetch adicional não foi ativado sem ablação de qualidade |
| R06     | Receipts e pacote limitado de reads reais, host valida snapshot/digest/janela/IDs, conversa cética independente                                                          | Não comprova todas as premissas livres do modelo; leituras fora do pacote resultam em incerteza                |
| R07     | Proteção transacional de tools dos peers, cardinalidade fixa, histórico preservado; experimento de envelopes iguais/ponderados                                           | Modelo conserva quotas iguais; ponderação/empréstimo de geração não passou gate de qualidade e não foi ativado |
| R08     | Três lanes estáveis, admissão por shard, deadlines persistidos, barreira/digest e join integral                                                                          | Ainda pode haver desequilíbrio entre lanes; não há conclusão por canal/evento novo                             |
| R09     | Política experimental de invalidação por instalação/repositório/base/config/memória/feedback/prompt/modelo/capacidade e closure de conteúdo                              | Não pula revisão entre commits: grafo completo e benefício ainda precisam ser demonstrados                     |
| R10     | Harness de comparação pareada com regressões, melhorias e falhas preservadas                                                                                             | Nenhum ganho adjudicado de especialização/diversidade foi medido; nenhum provider novo foi introduzido         |

R09/R10 foram tratados como hipóteses condicionais, conforme o próprio plano.
Ativar skipping, mais agentes ou quotas ponderadas sem satisfazer seus gates
contradiria a exigência de não perder qualidade. A infraestrutura experimental
está pronta, mas esses gates empíricos permanecem abertos.

## Provas verticais e limites de cobertura

`review-core-vertical.test.ts` inicia investigação e verificação com Think e
`ReviewShardWorkflow`, conserva o wrapper real de reserva/settlement, usa a tool
real do host com executor controlado no RPC externo e publica pelo ledger real.
Confirma quatro reservas de geração, duas admissões lógicas, refutação com receipt,
zero finding final e uma publicação. Eviction dos Agents não perde reservas.

O teste do adapter em Workerd usa Durable Object/storage e as políticas reais de
lease/cache/escopo; o lifecycle externo do container/SDK é controlado. Cancelar um
caller não mata o read do peer. Isso não equivale a construir ou executar um
container Cloudflare remoto.

O inventário explícito inclui `src/**/*.{ts,tsx}` nos pacotes de core e control
plane. O executor unifica Node e Workerd em `vitest.coverage.config.ts`, com
Istanbul e thresholds originais de 90% statements/functions/lines e 85% branches.
Não foram excluídas fontes para recuperar um gate verde. A primeira medição
conjunta expôs 80,28% statements e 68,75% funções no executor; testes do adapter
elevaram a cobertura acima dos thresholds. Cobertura agregada não elimina as
lacunas individuais nem comprova integrações privadas.

## Resultados de desempenho

Na [bancada reproduzível](experiments/2026-10-08-review-core-implementation/README.md),
o índice compartilhado produziu os mesmos resultados com aproximadamente 6,6 vezes
menos tempo mediano para 100 batches. Cache reduziu 96 execuções físicas para 12
(87,5%), preservando 96 solicitações lógicas e outputs. Lanes reduziram o p95
aproximadamente 60% na carga controlada heterogênea. O JSON guarda todas as
amostras; uma nova execução pode produzir tempos diferentes.

Esses números medem operações locais e timers. Não são promessa de economia por
PR, menor latência do modelo nem aumento de precisão. Planejamento por relação
melhorou co-localização no caso estático; quotas ponderadas acomodaram os mínimos
do exemplo dentro do mesmo teto, sem comprovar sua eficácia em PRs reais.

## Validação da entrega

O gate final `pnpm verify` terminou com exit code zero, usando Node 24.19.0 e
pnpm 11.24.0. Incluiu marca/schema/configuração, formatação, lint, typecheck
(21 tarefas), arquitetura, cobertura (32 tarefas) e build (17 tarefas). O build
construiu a imagem local do Sandbox e executou os dry-runs do Wrangler. Há 1.377
testes nos onze workspaces do recorte abaixo; o gate também exercitou os outros
workspaces, provas de auth/UI/browser e ferramentas de deploy.

| Workspace                | Testes | Statements | Branches | Functions |  Lines |
| ------------------------ | -----: | ---------: | -------: | --------: | -----: |
| `domain`                 |    108 |     95,96% |   91,43% |    97,14% | 96,36% |
| `contracts`              |    138 |     96,51% |   89,83% |    94,87% | 97,83% |
| `application`            |    158 |     96,21% |   89,83% |    98,65% | 97,31% |
| `repository-analysis`    |    193 |     97,13% |   90,56% |      100% | 97,08% |
| `github`                 |    114 |     92,96% |   90,15% |    95,49% | 93,10% |
| `model`                  |     41 |     96,34% |   91,82% |    96,36% | 97,54% |
| `repository-config`      |     13 |       100% |   94,59% |      100% |   100% |
| `project-identification` |     63 |     95,19% |   87,06% |    98,43% | 97,20% |
| `repository-executor`    |    123 |     92,43% |   87,05% |    93,18% | 92,79% |
| `control-plane`          |    358 |     92,00% |   86,40% |    93,94% | 93,29% |
| `evaluation`             |     68 |     96,07% |   90,90% |    95,83% | 96,14% |

Além do gate, foram executadas regressões por pacote, medições de cobertura
isoladas, benchmark local e conferência de links relativos da documentação.
Os probes da auditoria e os testes das âncoras entre fragmentos, falha de log e
colisão de IDs registram o resultado anterior e a regressão após correção.

Duas tentativas completas tiveram timeout de 15 s na primeira revogação de
instalação em `webhook-handler.test.ts`. A suite isolada passou; limitar o Turbo
a três pacotes produziu execuções verdes, mas ainda uma nova ocorrência. O
runner de cobertura passou a executar um workspace por vez, mantendo a
concorrência interna das suites, todos os testes, deadlines e thresholds. No
gate final, o mesmo teste passou em 5,3 s. Não foi alterado o comportamento de
revogação; a observação é consistente com contenção/cold start do harness, mas
não identifica sozinha a causa interna do timeout nem prova latência remota.

O harness também emite avisos de sourcemaps e cancelamento do Workerd nos cenários
controlados de Workflow/Agent. O resultado acima se refere ao status do gate e
às assertions; não constitui comprovação de que o runtime remoto esteja livre
de falhas. As mudanças permanecem locais, sem commit/push/deploy.

Não interpretar recordings, timer workload, dry-run ou fixture de provider como
qualidade real do modelo. Não houve chamada paga, mudança de secret, GitHub App,
banco remoto, merge ou publicação de artefato externo.

## Adendo de 2026-10-09: bancada real autorizada

Após o fechamento local acima, o usuário autorizou avaliação com o modelo do
AI Gateway e teto acumulado de US$ 0,50. Portanto, a ausência de chamadas pagas
relatada acima descreve a entrega inicial. O
[relatório real](2026-10-08-review-core-live-benchmark.md) registra os 243 requests,
US$ 0,060062421 informados, exposição conservadora de US$ 0,177000834, falhas e
gates que permanecem abertos. As rodadas de 4/4 não sobreviveram à repetição;
a confirmação posterior demonstrou falso positivo causal.

A investigação motivou correção do inventário body-only (ADR-0057), pistas
canônicas exatas, contexto factual separado para a conversa causal e seleção
de receipts por ID (ADR-0058). Regressões locais preservam export local, body
fora do hunk, orçamento compartilhado, symlink, IDs desconhecidos, metadados
inválidos, truncamento e integração Think de refutação após read. O controle
financeiro persiste reserva antes do transporte, não renova caps e registra
metadados de schema sem valores privados. Essas entregas não são prova de
precisão, economia sistemática ou latência remota.

### Verificação final da continuação

`pnpm verify` passou no estado final de código em 2026-10-09: marca, schema e
configuração, formatação, lint, 21 tarefas de typecheck, arquitetura, ferramentas
de deploy, 32 tarefas de cobertura e 17 tarefas de build/dry-run. A identidade
gerada do compilador foi regenerada pelo comando oficial após acrescentar `tsx`
ao importer do harness no lockfile; o schema de configuração não foi relaxado.

Os onze workspaces de core/executor/control plane somam 1.411 testes Vitest,
mais três testes Node de lock/checkpoint financeiro (1.414 nesse recorte). O
gate também passou os demais workspaces, incluindo as provas locais de browser.
Os workspaces modificados pela continuação ficaram assim:

| Workspace             | Testes Vitest | Statements | Branches | Functions |  Lines |
| --------------------- | ------------: | ---------: | -------: | --------: | -----: |
| `contracts`           |           145 |     96,51% |   90,24% |    94,87% | 97,83% |
| `application`         |           160 |     96,26% |   89,86% |    98,67% | 97,34% |
| `repository-analysis` |           200 |     97,23% |   90,52% |      100% | 97,28% |
| `model`               |            45 |     96,86% |   91,22% |    98,24% | 98,07% |
| `repository-executor` |           126 |     92,48% |   87,10% |    93,25% | 92,84% |
| `control-plane`       |           369 |     92,01% |   86,40% |    93,94% | 93,29% |

Também passaram `test:benchmark-host`, regressões focadas de contrato/aplicação/
modelo/Workerd, `git diff --check`, conferência de links locais e o analisador
offline que reconcilia as 243 reservas. Os thresholds e o inventário de fontes
produtivas permanecem mantidos. Testes Node de filesystem rodam em Node; a suíte
Workers seleciona `test/**/*.test.ts`. Nenhum teste financeiro chama o provider.

Avisos de sourcemaps e cancelamento por request pendurado do Workerd persistem
nos cenários controlados de Agents/Workflow; assertions e comandos terminaram
com sucesso. Isso não demonstra ausência desses problemas no runtime remoto.
O benchmark real permanece NO-GO para precisão/estabilidade, independentemente
do gate local verde. Alterações continuam locais e não houve push ou deploy.

### Continuação focada em defeitos de código — 2026-10-09

A [continuação C01–C08](2026-10-09-review-core-code-follow-up.md) corrige falhas de
telemetria, descoberta de aliases, contagem de sinais omitidos, identidade do
Agent, grader, fixtures TypeScript e propagação de degradação no harness.
Registra também a extração da execução de shard e testes do ledger com nove
peers e limites lexicais de identificadores na descoberta/tracer. O par real
novo de alias passou 2/2 com cinco chamadas Gemma, sem fechar
o gate global de precisão/estabilidade. A constatação de erros de tipos em dois
controles negativos antigos limita sua interpretação como falsos positivos;
o histórico acima permanece datado e não foi reexecutado retroativamente.
