---
id: RESEARCH-REVIEW-CORE-AUDIT-2026-10-08
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
---

# Auditoria do core de revisão em 2026-10-08

O problema mais grave encontrado é a perda de findings válidos quando um arquivo
é dividido entre shards: a agregação consulta apenas o primeiro fragmento e pode
produzir `APPROVE`. Os gates locais passam mesmo com esse defeito. Também foram
reproduzidos problemas na integridade da evidência, projeção de contexto,
busca estrutural, reconciliação de publicação e métricas de avaliação.

Este relatório registra evidência sobre o commit `1941a4f`, em checkout inicialmente
limpo. Não implementa correções de produção. As regras esperadas estão no
[guia de qualidade do core](../engineering/review-core-quality.md); a sequência
proposta está no [plano de melhorias](../planning/review-core-improvement-proposal.md).

## Escopo e método

Foram examinados planejamento e particionamento, elegibilidade, identificação de
projetos, configuração, prompts, Think, tools, budgets, análise, evidência,
agregação, lifecycle, veredito, publicação, estado durável, cleanup e avaliação.
O recorte inclui `domain`, `contracts`, `application`, `model`,
`repository-analysis`, `project-identification`, `repository-config`, `github`,
`evaluation`, o executor e as áreas de review/ledger do control plane. Dashboard,
auth, UI e uma auditoria integral das clarifications estão fora do recorte.

A análise combinou leitura de código e testes, cobertura executada, arquitetura
e probes sobre funções reais. Nos probes, Sandbox/GitHub são doubles externos;
não houve GitHub App, provider, conta Cloudflare ou Docker reais. Severidades
representam prioridade de engenharia: P1 pode alterar a decisão ou repetir efeito
externo; P2 compromete integridade, qualidade ou capacidade de comprovação.
Fragilidade de interface é distinguida de um caminho atualmente alcançável.

## Defeitos e inconsistências reproduzidos

### F01 — P1: evidência de fragmentos posteriores desaparece na agregação

**Caminho real:** [planejamento](../../packages/repository-analysis/src/plan.ts)
→ verificação do shard → [agregação](../../packages/application/src/aggregate-reviews.ts)
→ [evidência](../../packages/application/src/evidence.ts). A agregação faz
`flatMap` dos arquivos; `evidence.ts` usa `find(path)` tanto para a âncora quanto
para o trecho. Paths repetidos identificam fragmentos diferentes do mesmo patch,
mas somente o primeiro participa dessa validação.

**Reprodução:** patch sintético de 800 linhas adicionadas em um arquivo gera
dois shards. Finding na linha 800 tem evidência válida no shard correspondente. Na agregação,
o finding desaparece; o resultado é `APPROVE`, `scopeStatus: complete`.
Não depende de resposta inválida do modelo nem de resultados duplicados.
O probe fornece o candidato: comprova preservação de evidência e decisão do host,
sem exercitar detecção ou confirmação causal pelo modelo.

**Correção esperada:** construir uma visão canônica de todos os fragmentos por
path, lado e coordenada, preservando hunks e detectando conteúdo conflitante.
Validar pela mesma representação em cada etapa. Rejeição inesperada na agregação
precisa bloquear aprovação limpa. Concatenar patches sem tratar coordenadas e
preâmbulos não resolve a propriedade.

**Regressões necessárias:** planner real + candidato no segundo fragmento;
permutação dos shards; múltiplos hunks; rename; linha fora do diff; fragmentos
com coordenadas conflitantes. O resultado esperado é conservar o finding válido
e marcar investigação incompleta quando sua evidência não puder ser validada.

### F02 — P2: normalização aceita evidência semanticamente diferente

[evidence.ts](../../packages/application/src/evidence.ts) colapsa todo whitespace
antes de comparar o excerpt. Um patch com `const message = 'a  b';` aceita
evidência com `const message = 'a b';`. O prompt exige evidência literal, mas o
host aceita alteração do valor de uma string. Templates, regex e indentação de
linguagens textuais também exigem tratamento próprio.

[fingerprint.ts](../../packages/domain/src/fingerprint.ts) aplica normalização
semelhante. Mesmo path e diagnóstico, com os dois literals acima, geram a mesma
identidade. A colisão foi reproduzida; reutilização incorreta de uma dispensa
humana é um risco derivado, não um incidente reproduzido nesta auditoria.

**Correção esperada:** comparar trechos canônicos contíguos sem apagar conteúdo
semântico. Se CRLF/LF puderem ser equivalentes, estabelecer essa regra limitada.
Separar identidade estável, prova de conteúdo e política de reuso de feedback.
Invariância a formatação exige parser/tokenização que preserve literals ou uma
política conservadora; não deve ser inferida por regex global.

**Regressões:** espaços dentro/fora de literal, tabs, linhas vazias, templates,
regex, indentação significativa, reancoragem após mudança de linha e reintrodução
de defeito previamente dispensado com evidência diferente.

### F03 — P2: capacidade anunciada e resultado da busca estrutural divergem

[executor.ts](../../packages/contracts/src/executor.ts) aceita linguagens como
Python, Go e Rust para `search_structure`;
[policy.ts](../../packages/repository-analysis/src/policy.ts) constrói seus globs.
Entretanto, [repository-tools.ts](../../apps/repository-executor/src/repository-tools.ts)
só conserva resultados classificados como `structural`, hoje JS/TS. Em contexto
com arquivo JS/TS, uma consulta Python aceita e com match devolvido pelo comando
termina em conteúdo vazio e `truncated: false`. O probe reproduz essa filtragem;
não prova funcionamento do binário ast-grep para Python.

**Correção esperada:** alinhar schema, política, ferramenta e capacidade vigente.
Sem decisão de ampliar suporte, recusar linguagem não suportada com motivo
explícito. Se houver ampliação futura, separar elegibilidade do patch de capacidade
do parser. Não apresentar filtragem por incapacidade como busca completa sem match.

**Regressões:** matriz das linguagens aceitas, shard textual/estrutural/misto,
path permitido/negado, linguagem indisponível, resultado filtrado e busca truncada.

### F04 — P2: qualidade do modelo e qualidade do filtro são confundidas

[runner.ts](../../packages/evaluation/src/runner.ts) descarta candidatos sem
evidência antes de executar o grader. Um caso negativo com candidato fabricado
passa com `precision: 1`, `failedCases: 0`, `rejectedFindings: 1`. Isso prova
eficácia do filtro nesse caso, mas não precisão do gerador. O contador está
disponível; não integra a aprovação do caso.

Além disso, o denominador de recall é calculado somente nos casos concluídos.
Um positivo com erro do subject, combinado com negativo bem-sucedido, produz
`recall: 1`, `expectedFindings: 0`, embora `failedCases: 1` registre a falha.
O gate de casos não mascara esse erro; a métrica isolada pode mascará-lo.

**Correção esperada:** relatar candidatos brutos, rejeitados e publicáveis
separadamente; tratar integridade da evidência como gate explícito; contabilizar
positivos de casos interrompidos no recall operacional. Recall condicional a
execuções concluídas pode existir com esse nome e denominador explícito.

**Regressões:** negativo com evidência inventada; positivo com erro/timeout;
todos os casos falhos; saída inválida; precisão sem candidatos; erro parcial em
suite mista; candidato duplicado e severidade incorreta.

### F05 — P2: omissões por quantidade escapam dos indicadores de truncamento

[review-shard-context.ts](../../apps/control-plane/src/review/review-shard-context.ts)
aplica `slice(0, 8)` aos findings anteriores. Nove findings ativos do mesmo arquivo
viram oito, com `prompt.truncated: false` e `omittedSections: []`. Em
[reviewer.ts](../../packages/model/src/reviewer.ts), sinais estruturais e superfície
também são cortados por quantidade antes da medição de bytes.

A reconciliação mantém findings sem prova de correção como não verificados;
não foi demonstrada aprovação indevida por essa omissão específica. Há perda de
transparência e risco de starvation dos últimos itens em revisões repetidas.

**Correção esperada:** projeções com conteúdo, contagem omitida e motivo; seleção
determinística por relevância; política explícita para contexto obrigatório e
auxiliar. Uma amostra de hints não precisa sempre tornar o review parcial, mas
omitir revalidação obrigatória não pode parecer cobertura completa.

**Regressões:** limites de quantidade e bytes em N−1/N/N+1, multibyte, prioridades
estáveis, preservação dos findings não vistos e ausência de starvation.

### F06 — P2: agregação confia em identidade e flags dos callers

[aggregate-reviews.ts](../../packages/application/src/aggregate-reviews.ts) conta
sucessos sem exigir correspondência única com o plano. Dois resultados do mesmo
shard, num plano de dois, produzem `shardsAnalyzed: 2`, `totalShards: 2`, `APPROVE`.
Uma limitação `summary_missing` sem `isDegraded` aparece no texto e ainda permite
aprovação. Candidatos rejeitados na validação final também não tornam o resultado
degradado. A interface de `ShardReviewResult` permite combinações opcionais
contraditórias.

**Limite da evidência:** o coordenador atual normalmente cria resultados únicos
e propaga flags. As entradas duplicadas/contraditórias são provas de fragilidade
da fronteira, não demonstração de duplicação no runtime normal. A rejeição de
F01, por outro lado, ocorre com entradas válidas.

**Correção esperada:** identidade/cardinalidade verificadas; união discriminada
de resultados; falha, omissão obrigatória e limitação como fatos dos quais o host
deriva completude. Um booleano do caller não deve apagar esses fatos.

**Regressões:** shard ausente, desconhecido, duplicado, falha com findings,
limitação sem flag e permutação dos resultados. Nenhuma combinação incompleta
pode virar aprovação limpa.

### F07 — P1 condicionado ao volume: busca limitada autoriza republicação

[publisher.ts](../../packages/github/src/publisher.ts) interrompe a busca de
marcador após 20 páginas e retorna `undefined`, igual a uma busca esgotada sem
match. Em [authorized-publication.ts](../../apps/control-plane/src/review/authorized-publication.ts),
um claim `reconcile` com esse resultado permite outro POST. Se a publicação
anterior foi aceita, sua resposta foi perdida e o marcador está além do limite,
o efeito pode repetir. O probe comprova `null` na busca com marcador na página 21;
a republicação deriva diretamente do branch de código, sem POST remoto executado.

A API de reviews documenta ordem cronológica e páginas de até 100 itens.
O cenário exige volume elevado, mas o retorno atual não comprova ausência.
Fonte conferida em 2026-10-08: [GitHub REST, reviews](https://docs.github.com/en/rest/pulls/reviews).

**Correção esperada:** resultado `found`/`absent`/`inconclusive`. Só ausência
comprovada pode autorizar recriação; limite, timeout e filtragem são inconclusivos.
Preservar cursor/obrigação durável ou buscar pelo ID conhecido. Não substituir o
limite por paginação infinita. O mesmo problema alcança busca de corpo/marcadores
de comentários; corrigir o contrato e todos os consumidores juntos.

**Regressões:** resposta aceita mas perdida, marcador após o limite, retomada do
cursor, autor diferente, página vazia, timeout durante reconciliação e replay.
O teste atual de 20 páginas em `publisher.test.ts` prova o limite de trabalho,
mas aceita `undefined` sem provar segurança da decisão de republicar.

### F08 — P2: feedback de lifecycle não é verdade de calibração

[calibration.ts](../../packages/evaluation/src/calibration.ts) conta
`thread_resolved` como falso positivo; um finding correto corrigido e resolvido
pode ser classificado como erro do revisor. Feedbacks repetidos do mesmo finding
são contados independentemente. Dois feedbacks para um finding alteram
`totalReviewedFindings` de 1 para 2. `promoteFeedbackToCalibrationCase` também
deduz o veredito do PR inteiro de um feedback sobre um finding.

Esses comportamentos foram reproduzidos, mas as funções não participam da
decisão de revisão em produção neste recorte. A ameaça é usar essas métricas ou
cases para calibrar o core e ensinar silêncio sobre defeitos reais.

**Correção esperada:** unidade de análise por PR/run/finding, adjudicação de
feedback conflitante e distinção entre correção, utilidade, duplicidade,
severidade e falsidade. Preservar denominador real e amostra sem feedback.
Um rótulo humano é evidência a revisar; um case exige snapshot e ground truth
independentes para todos os defeitos relevantes do PR.

**Regressões:** finding útil depois resolvido, múltiplos autores, rótulos
contraditórios, mais eventos que findings, finding falso com outro defeito real
no PR e amostra sem feedback.

## Cobertura executada e sua interpretação

Todos os gates de cobertura selecionados passaram: **1.299 testes**, além de
**14 testes de arquitetura**. Há boa cobertura agregada, mas ela não prova as
composições anteriores. Percentuais abaixo são os relatórios dos scripts, não
uma média reconstruída nem evidência de funcionamento remoto.

| Workspace                    | Testes |                   Linhas | Branches | Funções |
| ---------------------------- | -----: | -----------------------: | -------: | ------: |
| domain                       |    104 |                   96,38% |   91,43% |  97,22% |
| contracts                    |    137 |                   97,73% |   90,08% |  94,36% |
| application                  |    130 |                   94,63% |   88,62% |  94,11% |
| model                        |     37 |                   97,26% |   91,44% |  96,15% |
| repository-analysis          |    192 |                   95,86% |   89,32% |    100% |
| project-identification       |     63 |                   97,20% |   87,06% |  98,43% |
| repository-config            |     13 |                     100% |   94,59% |    100% |
| github                       |    114 |                   93,24% |   89,95% |  95,57% |
| evaluation                   |     45 |                   97,73% |   87,69% |  96,07% |
| repository-executor, Node    |    104 |                   94,10% |   89,31% |  96,96% |
| repository-executor, Workerd |      9 | Não coletada pelo script |        — |       — |
| control-plane, Workerd       |    351 |                   92,91% |   86,25% |  92,40% |

O executor instrumenta 12 de 16 arquivos `src`; faltam `cloudflare-sandbox.ts`,
`index.ts`, `repository-tool-task.ts` e a interface `sandbox-port.ts`. Há testes
Workerd para adapters/HTTP; eles executam sem `--coverage` no script combinado.
Isso é lacuna de medição, não ausência de todos os testes desses arquivos.
`evaluation` não inclui os dois entrypoints CLI no relatório. `application`
não inclui `dashboard-ports.ts`, que é somente tipos.

A configuração compartilhada não explicita inventário `coverage.include` e usa
limiares globais de 90% linhas/funções/statements e 85% branches. O relatório do
control plane inclui três fixtures de teste. Considerando só `src`, seus valores
são 93,01% linhas, 86,19% branches e 93,60% funções. O denominador deve ser
declarado antes de comparar pacotes. A documentação do
[Vitest coverage](https://vitest.dev/guide/coverage.html), consultada em 2026-10-08,
explica a inclusão de arquivos não importados por `coverage.include`.

| Ponto crítico                                 | Medição observada              | Prova prioritária                                                    |
| --------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `github/src/client.ts`                        | 71,27% linhas; 64,38% branches | Classificação de falhas, auth, rate limit e respostas ambíguas.      |
| `application/src/inline-publication-plan.ts`  | 70,83% branches                | Limite de comentários, lifecycle, seleção e veredito coerentes.      |
| `control-plane/src/review/review-services.ts` | 79,04% linhas; 73,58% branches | Falhas dos adapters e propagação de negação/cancelamento.            |
| `control-plane/src/review/review-workflow.ts` | 77,61% branches                | Replay integral, supersession durante efeitos e cleanup recuperável. |
| `repository-analysis/src/policy.ts`           | 79,06% linhas; 79,54% branches | Matriz de capacidade, isolamento de comandos e outputs adversos.     |
| `evaluation/src/calibration.ts`               | 73,07% branches                | Unidade de contagem e rótulos de ground truth, F08.                  |
| `domain/src/redaction.ts`                     | 30% linhas                     | Vetores independentes de redaction e conteúdo limítrofe.             |

Linhas declarativas e funções de schema não executadas não equivalem a regras
sem prova; priorizar o risco observável. Aumentar percentuais com getters ou
snapshots grandes não corrige F01–F08.

## Testes fortes, fracos e composições ausentes

Há provas relevantes de reserva concorrente de orçamento e persistência após
eviction no ledger; autoridade de head/run antes de publicação; marcadores;
invalidade de contexto; leitura com realpath; egress; recuperação de narrativa
sem criar findings; e refutação causal em conversas Think separadas. Preservá-las.

Os problemas de qualidade mais relevantes são específicos:

- Planner e agregador são testados separadamente; a composição arquivo →
  fragmentos → evidência → veredito deixa F01 passar.
- Testes de calibração confirmam a contagem de dois eventos sobre o mesmo
  finding. Esse esperado replica a implementação, sem justificar o denominador.
- O teste do limite de paginação protege recursos, mas não exercita a decisão
  posterior com resposta de publicação perdida.
- `FakeSandbox` em `executor-service.test.ts` aceita comandos por default com
  sucesso. Um comando novo ou incorreto pode ser aceito sem fixture específica.
  Tornar operações inesperadas falhas explícitas e provar argv/saída em fronteiras
  reais. A existência de `fixtures/tool-smoke.ts` não prova que o smoke foi rodado.
- `cachedSteps` em `review-workflow.test.ts` pausa terminalização/cleanup para
  conservar o artefato de replay. É válido para aquele recorte, mas não comprova
  replay integral com execução terminal e alarm de cleanup.
- Testes de protocolo Think com tools/model controlados comprovam turnos e
  validação. Substituir `getTools` não comprova autorização, consumo durável do
  budget e executor no mesmo caminho. Falta uma fatia Workerd que preserve essa
  composição e substitua apenas provider/GitHub/Sandbox externos.

**Matriz adicional:** testar cancelamento entre autorização e execução; timeout
após reserva e antes de settlement; reinício do Agent; conclusão tardia de tool;
esgotamento de um shard sem impedir seus pares; global deny durável; hunk apagado
ou movido; refutação incompleta; prova de correção de finding anterior; resolução
humana seguida de regressão; falha de cleanup em cada caminho terminal.
Os probes deste relatório devem virar regressões que falhem antes das correções,
com esperado derivado do contrato, não do output observado aqui.

## Estrutura, acoplamentos e desperdícios

| Observação de código                                                                                | Consequência                                                                                          | Direção proposta                                                                                              |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `review-analysis.ts`: 914 linhas; `reviewShards` com 13 argumentos posicionais                      | Planejamento, projeção, execução, telemetria, budgets e reconciliação difíceis de mudar isoladamente. | Separar regras puras de projeção/seleção, executor de shards e reconciliação; usar entrada nomeada coesa.     |
| `review-workflow.ts`: 921; `review-services.ts`: 556; `review-agent.ts`: 524                        | Composição e detalhes do SDK competem com regras do review.                                           | Adaptar serialização/erros do SDK na fronteira e manter decisões explícitas no módulo dono.                   |
| `ledger-object.ts`: 1.297 linhas, com stores já separados                                           | Fachada agrega muitos domínios, mas a atomicidade é indispensável.                                    | Extrair coordenação interna só quando simplificar uma invariante; manter transações e autoridade no mesmo DO. |
| Evidência validada repetidamente, com reparse e lookup por candidato                                | Trabalho repetido e divergência de representação, como F01.                                           | Índice canônico imutável reutilizado, mantendo validação em cada fronteira de confiança.                      |
| Lookup da identidade de findings depende também da identidade do objeto em trechos da reconciliação | Clonar/normalizar uma entidade pode quebrar associações implícitas.                                   | Associar resultado por ID/correlação explícita; testar transformação que recria objetos.                      |
| Tools executam tarefas separadas; não há cache de leitura/busca idêntica no snapshot                | Repetição entre investigação e verificação custa RPC/processo e contexto.                             | Memoização por snapshot/escopo/argumentos e coalescência de consultas iguais, com autorização revalidada.     |
| Documentação suplementar resolvida por shard, com fetches sequenciais                               | Mesma referência pode ser recuperada várias vezes e somar latência.                                   | Reuso por referência/versão e concorrência limitada; resultado de omissão/falha estruturado.                  |
| Waves usam `Promise.allSettled` com três shards                                                     | O quarto espera o mais lento da wave, mesmo com slots livres.                                         | Medir ociosidade; avaliar scheduler limitado que preserve barriers, replay e cleanup.                         |
| Verificador recebe candidatos/prompt, sem pacote estruturado das leituras da investigação           | Pode repetir buscas e ainda não haver vínculo verificável entre conclusão e inspeção.                 | Pacote pequeno de evidências canônicas com proveniência e refutação independente.                             |

Tamanho de arquivo é um sinal, não um limite arbitrário. A divisão deve reduzir
conhecimento necessário ao caller. Strategy só é útil se houver políticas
alternativas reais; State deve representar transições válidas, não multiplicar
classes; Adapter deve esconder SDK, não reproduzir toda sua superfície.

## Limites atuais que afetam qualidade e velocidade

O protocolo usa até quatro gerações para investigação, duas para verificação
causal e uma para recuperar resumo. Nove shards cabem no teto de 64 gerações;
há quotas duráveis por shard de chamadas/bytes/output, limite global de 96
tool calls e waves de três. O limite de tools tem contadores por shard, mas
não uma alocação protegida por shard. Um shard pode consumir o saldo de tools
necessário à investigação de outro; isso é oportunidade de justiça, não violação
da decisão vigente. Referências: ADRs [0049](../decisions/0049-use-cloudflare-think-for-pr-review.md),
[0050](../decisions/0050-verify-finding-causality-before-publication.md) e
[0053](../decisions/0053-align-review-admission-with-generation-budget.md).

O teto de quatro milhões de bytes soma entradas serializadas das gerações;
histórico e resultados repetidos custam novamente. Divisão igual por shard não
assegura que um prompt próximo de 96 KB caiba com todos os turnos e schemas.
Bytes não são tokens. Dois turnos causais limitam explorações que dependem de
buscar um chamador e só depois ler o contrato encontrado. A investigação
independente já melhora confiança, mas o mesmo modelo e contexto podem manter
erros correlacionados. Não há prova para simplesmente aumentar agentes ou turns.

Polling de status em intervalos de cinco segundos e RPCs de autoridade/budget
também acrescentam tempo; guards não devem ser removidos para reduzir latência.
Não foi feito profiling de produção nem cronometrada uma execução real. As
otimizações propostas precisam medir tempo de provider, tools, DO/RPC, espera,
preparação e cleanup separadamente.

## Avaliação existente e drift de documentação

A CLI recorded passou **7/7 casos**, todos `development`; há **zero holdout** no
corpus atual. Recordings verificam runner/grader e fixtures, não precisão ou
latência do `ReviewAgent` atual. Não há adapter live desse motor no workspace.
O workflow de CI chama `pnpm verify`; esse script não executa `evaluate:recorded`
como CLI. Testes do pacote de avaliação continuam incluídos no gate.

Foram encontradas divergências que uma implementação deve reconciliar sem
renegociar produto silenciosamente:

- O [contrato de qualidade](../product/review-quality-contract.md) descreve no
  máximo três findings por execução, escolhidos por confiança; o runtime usa
  configuração de inline até 40 e seleção com severidade/lifecycle. É necessário
  esclarecer qual limite foi decidido, quais saídas ele governa e alinhar contrato.
- O [ecossistema técnico](../architecture/technical-ecosystem.md) ainda tem um
  parágrafo sobre adapter live manual, enquanto outra seção registra sua retirada.
- O [roadmap anterior](../planning/review-core-evolution-roadmap.md) preserva o
  motor/corpus histórico. Sua próxima ação não deve ser interpretada como estado
  atual do Think. O novo plano explicita essa transição.

## Reprodução e evidência de execução

[Probes](experiments/2026-10-08-review-core/probes.mts) e
[resultados JSONL](experiments/2026-10-08-review-core/results.jsonl) usam somente
dados sintéticos. São diagnósticos do commit auditado, não testes cujo esperado
deve perpetuar os defeitos. Podem mudar depois de uma correção.

Com Node 24.19.0 e pnpm 11.24.0, na raiz:

```sh
pnpm install --frozen-lockfile
pnpm --filter @holon/domain --filter @holon/contracts --filter @holon/application --filter @holon/model --filter @holon/repository-analysis --filter @holon/project-identification --filter @holon/repository-config --filter @holon/github --filter @holon/evaluation --workspace-concurrency=2 -r test:coverage
pnpm --filter @holon/control-plane test:coverage
pnpm --filter @holon/repository-executor test:coverage
pnpm test:architecture
node --import ./packages/evaluation/node_modules/tsx/dist/loader.mjs docs/research/experiments/2026-10-08-review-core/probes.mts
EVALUATION_REPORT_PATH=/private/tmp/holon-core-recorded-evaluation.json node --import ./packages/evaluation/node_modules/tsx/dist/loader.mjs packages/evaluation/src/cli.ts recorded
```

A instalação e Workerd precisaram de execução fora do sandbox restrito por DNS
e abertura de portas locais; isso não envolveu deploy. O Node padrão do shell
era 24.4.0, abaixo do intervalo suportado; os comandos usaram o runtime 24.19.0.
O loader direto evita o IPC da CLI tsx no ambiente restrito.

O gate completo `pnpm verify`, build/Docker, smoke remoto e teste com provider
real não foram executados nesta auditoria. Formatação, links e diff da entrega
documental foram conferidos por `pnpm format:check`, `pnpm lint`,
`git diff --check` e verificação dos destinos relativos dos 12 documentos afetados.
Os probes foram executados novamente e seus 14 registros coincidiram com o JSONL
salvo. Nenhuma conclusão de qualidade em PRs
reais decorre dos percentuais locais ou dos sete recordings.

## Implementação posterior à auditoria

Esta auditoria conserva as reproduções e o baseline `1941a4f`. As correções F01–F08,
testes verticais, inventário de cobertura e experimentos R01–R10 estão no
[relatório de implementação](2026-10-08-review-core-implementation.md). A existência
das correções locais não transforma esta pesquisa em prova de qualidade remota.
