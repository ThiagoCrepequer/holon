---
id: PLAN-REVIEW-CORE-IMPROVEMENTS-2026-10-08
kind: planning
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Proposta de melhorias no processo de revisão

Priorizar integridade da decisão e uma avaliação confiável antes de aumentar
autonomia, contexto ou paralelismo. Depois, remover recuperação repetida e orientar
o contexto por contratos/consumidores. Scheduling e reuso entre commits exigem
provas adicionais de persistência, invalidação e concorrência.

Esta proposta usa a [auditoria](../research/2026-10-08-review-core-audit.md), a
[comparação externa](../research/2026-10-08-review-system-comparison.md) e os
[critérios de engenharia](../engineering/review-core-quality.md).
A implementação local e seus limites estão no
[relatório de entrega](../research/2026-10-08-review-core-implementation.md).
Este plano não autoriza serviços, SDKs, deploy, captura de payload ou chamadas
pagas a modelos. ADRs aceitos permanecem vigentes; decisões
novas/substitutivas são necessárias onde a proposta mudar suas garantias.

Recorte atual em 2026-10-09: a [continuação focada em código](../research/2026-10-09-review-core-code-follow-up.md)
fecha C01–C08 com regressões e validação do par de alias no Gemma. O gate global
de geração confiável permanece aberto para falsos positivos causais e schema;
a causa não foi isolada exclusivamente na capacidade do modelo. R05/R09/R10
conservam experimentos condicionais não ativados, fora do recorte de correção de
defeitos ativos. A main incorporou quotas ponderadas/empréstimo pela ADR-0055,
integrados às lanes pela ADR-0059; o gate real de R07 permanece aberto. Não
converter o resultado 2/2 em prova dos perfis maiores nem em autorização de
prefetch, skipping ou especialistas.

Continuação após o PR #184: a
[prova de cobertura](../research/2026-10-09-review-context-coverage.md) fecha
regressões de inventário/projeção, coordenadas de corpo, checks redundantes e
diagnósticos de estágio, conforme ADR-0060. A ausência da política de severidade
no prompt/schema foi corrigida sem relaxar o grader. O par real terminou 2/2 após
duas rodadas reprovadas preservadas. O orçamento acumulado agora inclui 272
requests e exposição conservadora de US$ 0,196858445. A amostra ajustada não fecha
os gates globais acima nem valida um rerun do PR #184 no ambiente implantado.

## Estado de partida

O core usa Think com investigação e verificação causal isoladas, planejamento
limitado, ledger por PR e executor restrito. O protocolo admite até nove shards,
waves de três e quotas duráveis de modelo. O limite global de tools é 96.
Há 1.299 testes locais selecionados passando, mas falhas de composição F01–F08;
a avaliação recorded tem sete casos de desenvolvimento e nenhum holdout.
Esses fatos são datados, não baseline de qualidade em PRs reais.

## Sequência e dependências

| Ordem | Entrega                                                 | Por que vem antes                                           | Condição de saída                                                                |
| ----- | ------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1     | Integridade de evidência/agregação/publicação, R01      | Corrigir decisão indevida e efeitos duplicáveis.            | Regressões red→green; contratos e consumidores coerentes.                        |
| 2     | Avaliação e provas verticais, R02                       | Evitar otimizar com métricas que escondem falhas.           | Candidato/filtro/publicação separados; corpus adjudicado; composição exercitada. |
| 3     | Medição e reuso determinístico, R03/R04                 | Localizar custo e remover repetição sem mudar raciocínio.   | Ganho reproduzível com invariantes preservadas.                                  |
| 4     | Contexto causal e verificação com proveniência, R05/R06 | Melhorar informação antes de ampliar inferência.            | Paired evaluation sem regressão nas categorias críticas.                         |
| 5     | Quotas e scheduling, R07/R08                            | Ajustar esforço à dificuldade e eliminar ociosidade medida. | Concorrência/replay/cleanup provados; decisão aplicável atualizada.              |
| 6     | Reuso entre commits e diversidade seletiva, R09/R10     | Maior complexidade e risco de conclusões obsoletas.         | Invalidação conservadora e benefício superior ao custo demonstrados.             |

Não executar todas as refatorações numa entrega. Cada recorte deve deixar o
sistema com um contrato atual, sem aliases, flags transitórias ou caminhos internos
antigos. A sequência não impede corrigir um defeito independente de baixa amplitude.

## R01 — Restabelecer integridade antes de otimizar

**Problemas:** F01/F02/F03/F05/F06/F07. **Resultado esperado:** nenhuma perda
silenciosa de evidência ou cobertura e nenhuma ausência inconclusiva que autorize
republicação.

Entregas coesas:

1. Índice canônico por path/lado/coordenada para fragmentos, com conflito explícito.
   Reusar no shard e na agregação; teste real do planner com arquivo fragmentado.
2. Comparação de excerpt sem apagar semântica e identidade de evidência compatível
   com literals/indentação. Reavaliar reuso de feedback com prova não ambígua.
3. Resultados de shards tipados e validados contra o plano; completude derivada de
   falhas/omissões/rejeições. Recuperação de narrativa remove só sua limitação.
4. Projeção com motivos/contagem de omissões e política de contexto obrigatório.
   Alinhar capacidade anunciada de tools ao suporte atual; não ampliar linguagens
   como efeito colateral da correção.
5. Reconciliação GitHub com `found`/`absent`/`inconclusive`, propagada por portas,
   adapters e consumidores. Limite de busca conserva obrigação durável; testar
   publicação aceita com resposta perdida e marcador na página 21.

**Gate:** regressão que falha pelo motivo original, variantes adversas e teste
de consequência no veredito/efeito GitHub. Rejeição por limite não pode virar
aprovação; caso inconclusivo não pode emitir novo POST. Atualizar qualidade,
arquitetura/estado e operação conforme o comportamento final; resolver a divergência
do limite de findings sem escolher um novo limite por conveniência.

## R02 — Avaliação que mede o motor e testes que atravessam as fronteiras

**Problemas:** F04/F08 e composição insuficiente. Separar quatro indicadores:
qualidade bruta dos candidatos, acerto da verificação, findings finais e sucesso
operacional da execução. Erro do subject conta como falha e não desaparece do
recall operacional. Candidato com evidência inventada é falha de integridade,
mesmo quando o host consegue impedir publicação.

Construir corpus com ground truth revisado e pares positivo/negativo:

- Contrato removido versus reexport preservado; produtor incompatível versus
  normalização válida; guarda ausente versus guarda em chamador.
- Concorrência, retries, publicação ambígua, budget e cleanup; resolução humana
  legítima versus defeito reintroduzido.
- Arquivo fragmentado, rename, cross-shard, patch textual, busca incompleta e
  instrução hostil no repositório.
- Defeito em consumidor intacto após mudança do produtor; mudança sem defeito
  com grande quantidade de sinais estruturais.

Manter desenvolvimento e holdout separados por família causal, evitando que o
mesmo caso com nomes diferentes apareça nas duas partições. Preservar provenance
e adjudicação; feedback bruto não vira case automaticamente. Não definir um
número de casos como prova suficiente: cobrir categorias, severidade e variabilidade,
e relatar incerteza quando a amostra for pequena.

Adicionar uma fatia Workerd com Think → reserva/settlement → tools reais do host
→ executor controlado no limite externo → evidência → agregação → publisher fake.
Manter geração controlada para determinismo, sem substituir políticas internas.
Complementar com replay terminal, eviction e conclusão tardia. Testar argv/outputs
do executor com fixtures verificáveis; doubles devem recusar operações inesperadas.

**Gate:** runner/grader correto em casos adversos, cobertura com inventário de
produção declarado e provas verticais que detectem a retirada das guards
responsáveis. Recordings continuam úteis, com rótulo de evidência offline.
Subject live futuro deve exercitar o `ReviewAgent` vigente, com autorização e
ambiente próprio; não restaurar o gerador removido para obter números rapidamente.

## R03 — Medir o custo completo e preparar contexto uma vez

**Hipótese:** uma parte relevante da latência/bytes vem de preparação e repetição,
não de raciocínio necessário. Antes de mudar limites, medir por run/shard/fase:

- Duração de checkout/inventário/identificação/config/docs, provider, tools,
  validação/agregação, polling/DO, publicação e cleanup.
- Tools solicitadas, executadas, recusadas e reutilizadas; gerações por fase,
  bytes cumulativos de entrada/output e motivos de limitação.
- Ociosidade dos três slots, latência até primeiro/último shard e cancelamentos.

Usar IDs opacos, contadores, timings e códigos limitados; não acrescentar conteúdo
de prompts, diffs ou exceções livres aos logs. A retenção/tracing vigente tem
autoridade própria e não é ampliada por este experimento.

Preparar o índice canônico uma vez por snapshot e reusar projeções imutáveis.
Deduplicar resolução de documentação pela referência e versão efetivas; limitar
concorrência de fetch e representar ausência/timeout/omissão. Medir bytes e tempo
antes/depois, incluindo custo de cache/serialização.

**Gate:** output e completude equivalentes para fixtures determinísticas,
autoridade preservada e ganho acima do ruído medido. Se provider dominar quase
toda a latência, não justificar uma grande reestruturação por economia marginal.

## R04 — Reuso de tools por snapshot, sem perda de autorização

**Hipótese:** leituras e buscas idênticas entre investigação/verificação podem ser
coalescidas. O cache proposto é restrito à run/snapshot, com chave de identidade
do repositório, base/head, política/escopo compilado, tool e argumentos normalizados.
Não reusar apenas por path e não compartilhar dados entre tenants.

Guardar output limitado e proveniência no mecanismo efêmero apropriado ao
runtime; definir dono, eviction, retenção e cleanup antes de escolher armazenamento.
Revalidar autoridade no hit. Coalescer requests concorrentes iguais sem permitir
que o cancelamento de um caller libere resultado a caller desautorizado.

Separar admissão de tool lógica de execução física; hits não podem permitir
loops ilimitados nem contornar os 96 calls. Cache de erro/truncamento não fornece
prova de ausência. Retry transitório tem regra própria, não repetição cega.

**Provas:** mesma consulta simultânea, scopes diferentes, SHA diferente, negação
após cache, deadline expirado, resultado truncado e cleanup. Medir taxas de hit,
processos/RPC evitados, bytes e custo de armazenamento.

**Gate:** menos execuções físicas e latência, com mesmo conjunto de evidências,
veredito e limitação nas fixtures. Se quase não houver repetição, rejeitar o cache
e melhorar seleção de contexto; não manter infraestrutura sem benefício.

## R05 — Contexto inicial guiado por contratos e obrigações

**Hipótese:** diretório e semelhança de nome são proxies fracos de relação causal.
O inventário existente pode orientar grupos produtor → schema/export → consumidor
→ teste, respeitando caps e sem adicionar serviço de embeddings/RAG.

Começar por relações determinísticas disponíveis. Priorizar trechos de consumidores
e guardas pertinentes, com coordenadas/digest de origem. Mostrar cobertura do
índice e lacunas; imports dinâmicos ou resolução incompleta não autorizam silêncio.
Em shards separados, incluir referências compactas da obrigação que atravessa a
fronteira, em vez de copiar todos os arquivos para todos os prompts.

Comparar três variantes isoladas: agrupamento atual, contexto adicional seletivo
com grupos atuais, e agrupamento por relação sob os mesmos limites. Essa ablação
separa ganho da recuperação e ganho do planner. Reservar orçamento para verificação
antes de preencher o prompt com hints.

**Gate:** recall por categoria causal melhora ou se mantém, tool rounds e bytes
não aumentam sem benefício correspondente, e nenhuma relação importante desaparece
sem limitação explícita. Não substituir a prova literal por um resumo do grafo.

## R06 — Verificação causal com proveniência e capacidade de refutar

**Hipótese:** compartilhar leituras canônicas reduz busca repetida e permite
comprovar quais premissas foram realmente inspecionadas. Propor um pacote limitado
de evidências: path, SHA, janela, origem, conteúdo/digest e estado de truncamento.
Conteúdo permanece dado não confiável, isolado das instruções do sistema.

O assessment pode referenciar IDs dessas evidências, validados pelo host. Premissa
externa ao patch requer leitura compatível, ou permanece incerta. Um patch
autossuficiente não deve exigir tool artificial apenas para cumprir uma contagem.
Preservar conversa independente, busca de contraexemplos e limites de confiança
da ADR-0050.

Agrupar candidatos com a mesma obrigação para evitar reler o mesmo contrato;
deduplicar somente quando cadeia causal e correção forem equivalentes. O pacote
não deve entregar apenas o raciocínio da investigação para aprovação pelo verificador.

**Provas:** ID fabricado, janela errada, SHA antigo, leitura truncada, guarda fora
do patch, candidato autossuficiente, assessments ausentes/duplicados e refutação
de dois candidatos que compartilham contrato. Com apenas dois turnos, medir quantas
obrigações ficam inconclusivas porque uma leitura depende do resultado de busca.

**Gate:** mais premissas verificáveis e menos recuperação duplicada, sem aumentar
falsas confirmações. Se faltar exploração sequencial, propor mudança de esforço
somente com quotas/deadlines compatíveis; não remover a verificação para economizar.

## R07 — Planejar orçamento pelo trabalho, preservando justiça

**Hipótese:** quotas iguais deixam alguns prompts impossíveis e outros com saldo
ocioso. Estimar tamanho real do envelope inicial, schemas e histórico esperado;
reservar fases obrigatórias e recuperação prevista. Mostrar inviabilidade antes
de iniciar um shard que não cabe no orçamento mínimo.

Experimentar alocação ponderada com mínimo protegido e teto de empréstimo
transacional; comparar com quotas iguais. Critérios de peso podem usar superfície
de contrato, contexto e obrigações abertas, não número de findings como incentivo.
Proteger saldo de tools de pares pode ser útil; não permitir a um shard dominante
consumir todo o espaço de investigação dos demais.

**Decisão:** qualquer mudança na independência das quotas/admissão da ADR-0053
exige nova decisão aplicável. Não implementar remanejamento em memória que
contradiga negação durável ou gere resultado diferente após replay.

**Provas/gate:** concorrência, reinício, reserva conservadora, uso incerto,
esgotamento local/global e PR misto com shard grande/pequeno/textual. Melhorar taxa
de conclusão sem aumentar teto total ou starvation; relatar também recall dos
shards menos priorizados. Ajustar esforço/modelo vem depois dessa medição.

## R08 — Reduzir espera sem quebrar Workflows e cleanup

**Hipótese:** waves fixas desperdiçam slots quando um shard lento segura os demais.
Medir essa ociosidade antes de trocar a coordenação. Avaliar scheduler com três
permissões e admissão progressiva, preservando contexto preparado, autoridade,
estado durável e joins de trabalho iniciado.

Não substituir `allSettled` por `race` e abandonar tasks perdedoras. Cancelamento
deve aguardar ou invalidar conclusões tardias e conservar cleanup. A preparação
do executor e sua lease/barrier precisam suportar a nova sequência.

Polling pode ser reduzido por conclusão/evento se a API oficial da versão usada
suportar essa integração. Provar entrega/replay antes de introduzir canal/binding.
Batching de consultas ao ledger só é válido se a operação composta conservar
autorização causal e reserva atômica; não cachear autoridade para toda a run.

**Gate:** p95 e ociosidade menores em workloads heterogêneos, com testes Workerd
de supersession, replay, falha de preparação, late completion e cleanup. Se a
complexidade durável superar o ganho, manter waves e reduzir a preparação repetida.

## R09 — Reuso entre commits com invalidação conservadora

**Hipótese futura:** pushes pequenos poderiam reusar parte da investigação anterior.
Isso muda o processo e requer decisão específica; memória de findings existente
não equivale a revisão incremental implementada.

Uma prova reutilizável precisa de dependências: base/head, conteúdo, contratos,
consumidores, configuração, versão de prompt/modelo e capacidade de recuperação.
Mudança de dependência invalida a prova mesmo se o arquivo ancorado não mudar.
Encontrar dependências incompletas deve levar à investigação novamente, não à
declaração de segurança. Revalidar head, findings ativos e feedback antes de publicar.

**Provas/gate:** rebase/base nova, rename, arquivo consumidor intacto, dependência
alterada, config/memória nova, feedback após o review e retorno a SHA anterior.
Comparar sempre com revisão completa do mesmo snapshot; ganho de custo não pode
ser obtido ignorando defeitos introduzidos indiretamente. Retenção privada e
invalidação podem tornar a alternativa mais cara; rejeitá-la se não houver benefício.

## R10 — Diversidade e especialização somente para falhas demonstradas

**Hipótese futura:** revisores especializados ou modelos distintos podem reduzir
erros correlacionados. Não há baseline local para afirmar isso hoje. Mais agentes
também multiplicam tokens, duplicatas e falhas; unanimidade não é prova causal.

Identificar categorias em que o gerador e verificador atuais erram juntos.
Comparar especialização limitada versus prompt geral, com geração/verificação
e budgets equivalentes quando possível. Encaminhar esforço adicional por obrigação
causal/riscos do contrato, sem descartar automaticamente bugs dependentes de estado.

**Gate:** melhoria adjudicada em categorias problemáticas e fronteira custo/qualidade
favorável. Não adotar se aumentar ruído, omitir categorias ou exigir capacidades
proibidas no executor. Novo provider/SDK demanda necessidade de produto e decisão.

## Protocolo de aceitação dos experimentos

Antes de executar cada variante, fixar hipótese, dados, métrica principal,
margem de não inferioridade aceitável e critérios de parada/rejeição. A margem
deve ser acordada com o risco e tamanho da amostra; não inventar percentual universal.
Todo defeito crítico perdido exige inspeção e impede declaração de equivalência.

Comparar snapshots/configs idênticos e registrar modelo/prompt/corpus/revisão de
código. Fazer execuções pareadas, repetir componentes não determinísticos e
preservar holdout. Relatar precisão/recall por categoria e severidade, rejeições,
completude, falhas, tokens/bytes, tools lógicas/físicas e p50/p95. Contar preparação,
armazenamento e cleanup no custo; não escolher só a execução mais favorável.

A primeira avaliação pode ser local com provider controlado para invariantes e
profiling de host. Ganho de precisão requer subject real e casos adjudicados;
ganho de latência de provider requer execução real autorizada. CI local, dry-run,
smoke remoto e operação em produção permanecem evidências distintas.

## Entrega e documentação por recorte

Cada implementação deve incluir regressão, código coeso, contratos/consumidores
atuais, risco/limitações e documentos pertinentes. Refatoração acompanha uma
regra ou simplificação demonstrável; não é uma rodada geral de renomeação.
Atualizar fluxo/contratos/estado/operação onde houver mudança e registrar uma
pesquisa datada dos experimentos. Preservar ADRs aceitos e pesquisas anteriores.

R01 e as correções determinísticas de R02 foram implementados localmente.
R03–R08 têm entregas de runtime e experimentos conforme a matriz do relatório;
prefetch e ponderação de modelo não foram ativados sem prova de qualidade.
R09/R10 têm infraestrutura experimental, mantendo os gates empíricos abertos.
Ganhos de precisão só podem ser apresentados após avaliação real adjudicada.

## Reconciliação empírica em 2026-10-09

O [benchmark real](../research/2026-10-08-review-core-live-benchmark.md) recuperou
positivos e validou o primeiro holdout, mas a repetição expôs falhas de schema e
a confirmação introduziu falso positivo de alcance. R05/R06 não passaram gate
de qualidade; R07–R10 não foram provados por uma bancada de um shard. Não ativar
prefetch adicional, empréstimo de quota, skipping ou especialistas com essa
evidência. Índice/cache/lanes conservam os GO locais e seus limites.

O próximo recorte deve atacar a confirmação de cenário não alcançável e a
estabilidade da saída, com contratos adjudicados e famílias novas. A campanha
com 243 requests usou US$ 0,060062421 informados, exposição conservadora de
US$ 0,177000834 e manteve todas as falhas; não há benefício em gastar o restante
de US$ 0,50 sem uma hipótese mais forte. A ADR-0057 registra o inventário
body-only e a ADR-0058 simplifica seleção de receipts sem enfraquecer validação.
