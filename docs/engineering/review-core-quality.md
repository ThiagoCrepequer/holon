---
id: ENGINEERING-REVIEW-CORE-QUALITY
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Qualidade e organização do core de revisão

Este guia define como preservar confiança, organizar regras e demonstrar o
funcionamento de mudanças no core. Parte das lacunas da
[auditoria de 2026-10-08](../research/2026-10-08-review-core-audit.md).
Os requisitos abaixo são critérios de engenharia esperados; a auditoria registra
onde o código não os satisfazia na revisão inicial. O
[relatório de implementação](../research/2026-10-08-review-core-implementation.md)
registra as correções e as provas atuais.

ADRs aceitos e o [contrato de qualidade](../product/review-quality-contract.md)
continuam prevalecendo. Cache efêmero, receipts e lanes seguem a
[ADR-0056](../decisions/0056-preserve-review-evidence-and-schedule-stable-lanes.md),
composta com os perfis da ADR-0055 pela
[ADR-0059](../decisions/0059-compose-stable-review-lanes-with-budget-profiles.md).
Revisão incremental e diversidade conservam os gates do
[plano](../planning/review-core-improvement-proposal.md). Se uma correção mudar decisão,
persistência, capacidade ou escopo, atualizar os contratos e propor o ADR necessário.

## A unidade de correção é o comportamento completo

Uma regra deve ter dono e resultado observável. Para review, o caminho é
snapshot → plano → contexto → investigação → validação → reconciliação →
veredito → efeito GitHub. Uma função correta isoladamente não basta quando
outro módulo transforma seus dados. F01 demonstra o planner e o verificador de
shard corretos, seguidos por agregação incorreta.

Antes de implementar, registrar:

1. A invariante: por exemplo, toda evidência validada aponta para conteúdo do
   snapshot exato e continua identificável após particionamento.
2. Quem produz, transforma, valida, persiste e consome cada dado.
3. A identidade que atravessa essas etapas e os fatos que podem invalidá-la.
4. O teste que observa a consequência final e as falhas que ele precisa distinguir.

Não criar pacote, base class ou registry para substituir esse raciocínio.
Preferir módulos internos com uma entrada pequena, regras completas e saída
que permita ao caller decidir sem conhecer seus detalhes.

## Evidência canônica e identidade

### Evidência é conteúdo e coordenada, não narrativa

- Canonicalizar paths e resolver a origem no snapshot autorizado. Path, lado,
  SHA, coordenadas e conteúdo devem concordar. Política de acesso continua
  aplicada mesmo para dados já recuperados.
- Vários fragmentos do mesmo path representam partes de um arquivo, não
  arquivos intercambiáveis. Nunca escolher o primeiro fragmento por `find(path)`.
- Preservar limites de hunks, continuidade das linhas e diferenças entre base
  e head. Rejeitar fragmentos conflitantes; não escolher silenciosamente um deles.
- Comparar excerpt com conteúdo canônico sem colapsar literals, regex,
  templates ou indentação significativa. Normalização permitida precisa ter
  definição limitada e testes independentes.
- Separar validação da âncora inline e da evidência causal. Uma linha elegível
  no diff não comprova o efeito relatado; uma evidência fora do diff pode explicar
  o efeito, mas não substituir a âncora autorizada.
- Reusar representação canônica imutável para evitar reparsing e divergência.
  Reusar a representação não elimina revalidação em fronteiras não confiáveis.

Uma interface de índice deve responder perguntas do domínio — trecho presente,
linha adicionada, conteúdo conflitante — sem expor mapas mutáveis ou exigir que
cada caller implemente novamente a regra. Sua construção e complexidade devem
ser limitadas pelo contexto admitido.

### Identidade estável não prova equivalência semântica

ID de run, shard, finding, publicação, fingerprint de evidência e revisão causal
têm responsabilidades distintas. Nomear essa responsabilidade e conservar suas
regras. Um hash de texto normalizado não é prova de que dois programas se comportam
igual. Feedback anterior só pode ser reaplicado com associação não ambígua e
evidência compatível com a decisão humana.

Usar ID explícito para associar validação, rejeição, lifecycle e publicação.
Não depender da identidade de objeto JavaScript, da ordem de chegada ou da posição
num array depois de dedupe/ranking. Se índices forem necessários dentro de uma
conversa, validá-los contra o conjunto original antes de associar conclusões.

## Completude, omissão e resultados impossíveis

Completude deve ser derivada dos fatos: shards previstos e concluídos, escopo
admitido, contexto obrigatório disponível, evidência aceita e limitações abertas.
Um flag opcional não pode apagar timeout, ausência de shard ou rejeição de conteúdo.

- Validar unicidade e pertença dos IDs ao plano. Contar shards distintos;
  duplicação não pode compensar um shard ausente.
- Modelar sucesso/falha/cancelamento como variantes com campos próprios.
  Falha não deve carregar findings publicáveis; sucesso não deve precisar de
  combinações de opcionais para explicar o que foi executado.
- Projetar contexto com conteúdo, omissões e motivos. Limites de quantidade
  também são limites de contexto; cortar antes de medir bytes não apaga a omissão.
  Contabilizar perdas na etapa que aplica o teto e propagá-las às projeções,
  completude e apresentação. Omissão de sinais e varredura incompleta são fatos
  distintos; não usar um flag de scan para representar ambos.
- Separar completude do inventário global de omissões de uma projeção local.
  Preservar a primeira no plano/agregação; não atribuir o mesmo corte global a
  cada parte. Compartilhar janelas canônicas antes de gastar outra parte ou
  inferência. Preservar coordenadas da declaração e do edit no corpo.
- Registrar estágio e motivo seguro de rejeições anteriores à publicação. Um
  contador posterior zero não invalida uma rejeição anterior. Declarar quando
  a normalização não preserva a contagem original.
- Classificar contexto obrigatório e auxiliar. A ausência de uma obrigação de
  revalidação afeta completude; seleção de hints auxiliares precisa de contagem
  e política explícita, sem inflar artificialmente a cobertura prometida.
- Tratar recuperação de resumo como remoção daquela limitação, preservando
  degradação independente. Nenhuma narrativa recuperada cria finding ou evidência.
- Após dedupe/filtro/reconciliação, conservar motivos suficientes para explicar
  o resultado. Rejeitar um candidato não significa que a mudança ficou segura.

Resultado final e texto devem ser derivados da mesma política. Se há limitação
que bloqueia aprovação, cabeçalho, Check Run e evento GitHub devem concordar.
Não corrigir apresentação enquanto o evento externo continua aprovando.

## Ferramentas que permitem decisões justificadas

Pistas de símbolos alterados devem incluir mudanças no corpo, inclusive quando
a declaração não aparece no hunk. Identificar a declaração no snapshot completo
verificado, preservando a distinção entre adição, modificação e remoção. Não usar
a linha textual mais próxima como substituto da estrutura. Testar a descoberta
do consumidor pelo inventário, além da função de extração. Em leitura por lotes,
o orçamento total pertence à operação inteira; iniciar outro lote não renova
bytes nem autoriza symlinks. Essas regras seguem a ADR-0057.

Associar exports locais aos nomes públicos obtidos da AST; procurar apenas o
nome da implementação perde callers que importam um alias. Distinguir essa pista
de resolução completa de imports/reexports: a busca lexical não prova um grafo
de dependências nem resolve nomes arbitrários de imports default.

Definir fronteiras lexicais pela linguagem anunciada, e compartilhar a regra
entre descoberta e rastreamento. `\b` não representa um identificador JavaScript
com `$`, letras Unicode ou join controls. Testar tanto nomes válidos quanto
fragmentos de nomes maiores, e comprovar o padrão no engine real do executor;
um mock que aceita qualquer comando não demonstra compatibilidade da regex.

Uma tool deve ter propósito preciso, argumentos restritos, capacidade real e
resultado que distingue sucesso completo, sucesso limitado e falha.

- Schema, command builder, parser, filtro de escopo e prompt devem oferecer a
  mesma matriz de capacidade. Linguagem aceita sem executor competente deve
  resultar em recusa explícita, não em busca vazia.
- Busca sem match só prova ausência no espaço efetivamente percorrido. Limite
  de resultados, bytes, timeout, paths negados e incapacidade devem ser visíveis.
- Reduzir contexto por linhas/janelas semanticamente úteis; devolver proveniência
  suficiente para o host recuperar e validar conteúdo. Não produzir respostas
  extensas com metadados repetidos e pouco sinal.
- Não adicionar shell arbitrário, instalação, escrita, lifecycle scripts ou
  egress amplo para compensar uma interface ruim.
- Batching futuro deve limitar quantidade, bytes agregados, concorrência e prazo;
  resultados parciais precisam manter a identidade de cada item. Uma chamada
  batched não pode servir para contornar orçamento lógico.
- Cache deve ser identificado por snapshot e política completos;
  revalidar autoridade e escopo no hit. Resultado limitado não vira prova completa
  por estar em cache. Retenção e isolamento precisam ser definidos antes de persistir.

A redução de tool calls é útil quando remove trabalho redundante ou recupera
evidência relevante mais diretamente. Reduzir chamadas deixando uma premissa
causal sem inspeção é regressão de qualidade.

## Verificação causal e seleção de findings

Investigar e verificar são responsabilidades distintas. A verificação procura
contraexemplos: guardas anteriores, contrato efetivo, consumidor, exports e
normalização que refutem o defeito. Preservar a conversa isolada da ADR-0050;
não validar uma hipótese somente perguntando novamente se ela parece correta.

Um candidato precisa identificar mudança, condição de ocorrência, cadeia causal,
efeito e evidência. Forneça ao modelo a mesma política de severidade usada pelo
produto e pelo grader: `reviewSeverityGuidance` integra as instruções e a descrição
do schema. Uma exceção isolada não comprova indisponibilidade generalizada; use
o menor nível demonstrado pelo caminho causal. Severidade representa impacto;
confiança representa suporte da conclusão. Nenhuma das duas pode substituir a outra.

O host conserva controle de IDs, evidência, budget, threshold, lifecycle e efeito
GitHub. Output do modelo é entrada não confiável. A validade do schema prova
forma, não causalidade. Associações de assessments a candidatos precisam ser
completas, únicas e válidas. Refutação e incerteza devem ter efeitos explícitos.

Um pacote de evidência para o verificador deve conter dados recuperados
pelo host com origem verificável. Ele não deve transformar justificativas livres
da investigação em fatos. O verificador ainda precisa poder buscar a evidência
que falta ou declarar que não conseguiu concluir.

Filtragem barata deve ser compatível com a política final. Por exemplo, dispensar
verificação de um candidato abaixo do threshold só é seguro se a fase posterior
nunca puder elevá-lo para publicação. Provar essa propriedade e eliminar sua
alegação da narrativa, sem declarar o PR correto por ausência de candidato.

## Estado durável, budgets e efeitos externos

As operações repetíveis precisam de identidade determinística, transições
condicionais e reconciliação. Manter autoridade da run/head, reserva, execução,
settlement e cleanup explícitos. Um novo helper não deve diluir qual etapa possui
cada obrigação.

| Situação                         | Regra esperada                                                        | Prova                                                                        |
| -------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Resposta externa perdida         | Resultado desconhecido conserva obrigação de reconciliar.             | Serviço aceita operação, cliente recebe timeout, retry não repete sem prova. |
| Busca de marcador interrompida   | Distinguir ausência de busca inconclusiva.                            | Marcador depois do limite e continuação após retry/eviction.                 |
| Reserva de orçamento concorrente | Admitir e contabilizar atomicamente, sem exceder teto.                | Concorrência no DO real; negação durável após reinício.                      |
| Falha após reserva               | Settlement segue semântica vigente de sucesso/falha/uso incerto.      | Falha antes/depois do provider, settlement repetido e replay.                |
| Supersession/cancelamento        | Impedir novo efeito sem perder cleanup obrigatório.                   | Nova run entre etapas; tool tardia não ressuscita autorização.               |
| Prazo esgotado                   | Propagar deadline e cancelar trabalho; resultado tardio é descartado. | Request travada, término tardio e ausência de mutação posterior.             |
| Cleanup falha                    | Obrigação durável sobrevive e pode ser retomada.                      | Cada estado terminal, alarm, eviction e retry.                               |

Não usar “exactly once” para uma API sem chave idempotente apenas porque existe
um marcador. Explicar a garantia obtida e a condição de incerteza restante.
Limitar reconciliação é legítimo; concluir ausência ao atingir o limite não é.

Budget de tokens, bytes, gerações, tools e tempo mede recursos diferentes.
Histórico reenviado também consome entrada. Reservar espaço para schema, tools,
output e recuperação prevista; não inferir tokens de bytes por constante universal.
Otimizações não podem remover guards de autoridade nem transferir para outro
shard uma dívida escondida. Mudanças de quotas/scheduling devem respeitar a ADR-0053
ou propor sua substituição quando necessário.

## Organização por regras e fronteiras

Separar política pura, coordenação e adapter quando cada fronteira esconde uma
complexidade real. Um possível recorte interno do review é:

- Planejamento/projeção: decide cobertura e contexto com entradas imutáveis;
  não faz fetch nem publica.
- Execução de shards: coordena budget, deadline e resultado tipado; não inventa
  veredito nem aplica feedback humano.
- Evidência/reconciliação: valida conteúdo e lifecycle com identidades explícitas;
  não conhece peculiaridades de Workflows/Think.
- Publicação: resolve claim, autoridade e resultado externo; não interpreta
  texto do modelo como autorização.
- Composição de runtime: traduz bindings/SDK para as portas, sem duplicar políticas.

Esses são critérios de separação, não exigência de cinco classes ou novos pacotes.
O ledger pode manter stores especializados e uma transação comum. Uma entrada
nomeada deve agrupar fatos da operação; não criar um “context” global com todo o app.
Evitar parâmetros posicionais numerosos, booleanos de modo e callbacks genéricos
que forçam o caller a conhecer a sequência interna.

| Padrão                                 | Quando serve                                                       | Quando rejeitar                                                      |
| -------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Adapter/porta                          | Isolar protocolo/erro/serialização externa de uma regra Holon.     | Wrapper que apenas renomeia todo o SDK.                              |
| União discriminada/transição de estado | Representar combinações válidas e obrigações de uma operação.      | Classe por estado sem transição ou persistência definida.            |
| Strategy                               | Comparar políticas reais de admissão/seleção sob o mesmo contrato. | Registry para uma única implementação sem variação necessária.       |
| Índice imutável                        | Centralizar representação canônica consultada repetidamente.       | Map exposto que deixa callers inventarem a invariante.               |
| Memoização/single-flight               | Coalescer leituras iguais de snapshot imutável.                    | Cache sem chave de autoridade, retenção ou semântica de truncamento. |
| Função/módulo puro                     | Uma regra coesa, sem estado externo.                               | Framework de pipelines para encadear funções estáveis.               |

Tamanho e complexidade ajudam a localizar pressão, mas não são o veredito de
qualidade. Avaliar quantos detalhes o caller precisa saber, quantas vezes a regra
está duplicada e quantos arquivos uma mudança funcional exige tocar. Remover
abstrações que aumentam esse custo. Evitar refatoração cosmética que troca
condicionais por classes mantendo o mesmo acoplamento.

## Testes que demonstram o contrato

O [guia de testes](testing-and-evidence.md) define a fronteira; o core exige também:

1. Regressão que falha pelo comportamento defeituoso antes da correção. Para F01,
   planner real e agregação real; não fabricar um plano que elimina fragmentação.
2. Fixtures com expected independente. Um double deve falhar em operação
   inesperada; sucesso default para todo comando oculta mudanças indevidas.
3. Propriedades de transformação: permutação de resultados não altera decisão;
   duplicação não aumenta cobertura; fragmentação não apaga evidência; nova
   limitação nunca converte revisão incompleta em completa.
4. Boundary cases de quantidade/bytes/tempo, entradas adversas e ausência de match
   limitada. Cobrir N−1/N/N+1 com conteúdo multibyte quando bytes forem relevantes.
5. Uma fatia vertical Workerd para protocolo/budget/tool/validação/reconciliação,
   substituindo somente integrações externas. Helpers que pulam terminalização
   não comprovam replay integral; manter teste separado do caminho completo.
6. Cobertura com inventário de produção declarado, runtimes separados e lacunas
   por módulo crítico. Não diminuir threshold, excluir arquivo arriscado nem
   cobrir só getters para elevar o percentual.

Contagem de testes não representa quantidade de comportamentos provados.
Snapshots extensos são úteis para contratos de apresentação delimitados, mas
não substituem asserts sobre autoridade, efeito externo, completude e causalidade.
Mutation testing pode avaliar se uma regressão falha ao remover a guarda
responsável; é experimento focado, não ferramenta obrigatória nova no runtime.

## Avaliação e comprovação de otimizações

Separar três resultados: geração bruta de candidatos, filtros/verificação do host
e publicação final. Relatar rejeição de evidência e falhas do subject; não removê-las
do denominador sem nomear a métrica condicional. Um caso negativo com candidato
inventado não demonstra precisão perfeita do modelo.

Corpus precisa de positivos e controles negativos correspondentes, ground truth
revisado, categorias causais e partição holdout preservada. Não adaptar o prompt
ao holdout. Recordings provam replay/grader; um subject que apenas devolve o
expected não mede o motor. Feedback humano precisa de dedupe e adjudicação;
resolução de thread não prova falso positivo nem define o veredito inteiro do PR.

Comparar variantes com o mesmo snapshot, config, modelo e corpus. Registrar
precisão/recall por categoria e severidade, completude, rejeições, custo, tools
lógicas/executadas, bytes, latência p50/p95, falhas e incerteza estatística. Repetir
execuções não determinísticas e inspecionar regressões, em vez de escolher o
melhor exemplo. Não declarar “sem perder qualidade” com média agregada enquanto
defeitos críticos ou categorias pequenas pioram.

Instrumentação de desempenho deve usar contadores, durações e códigos limitados.
Não adicionar prompts/diffs/excerpts/exceções livres aos logs como conveniência.
Falha do sink consultivo não pode interromper revisão, mudar retry ou apagar
evidência. Testar essa propriedade desde a preparação até a saída do shard.
Captura de payload só segue investigação autorizada e retenção documentada.
Teste local, dry-run, avaliação live autorizada e produção têm provas diferentes.

## Revisão de uma entrega do core

O reviewer deve conseguir responder, pelo diff e pela evidência:

- Qual regra mudou, quem a possui e quais consumidores foram atualizados?
- Que combinações inválidas o tipo/schema impede e quais o runtime rejeita?
- Que limite ou falha pode interromper a operação, e como isso aparece no resultado?
- Como retry, concorrência, cancelamento e eviction conservam autoridade e cleanup?
- Qual teste falhava antes e qual composição relevante continua real no teste?
- Qual evidência sustenta ganho de qualidade/custo/tempo, com quais limitações?
- Que documentação descreve fatos implementados e que parte permanece proposta?

Se essas respostas dependem de conhecimento oral ou de flags implícitas, a
interface e a prova ainda precisam ser melhoradas antes de encerrar a mudança.

## Contratos de inferência e evidência real

Não peça ao modelo para reconstruir metadados que o host já conhece. Selecione
IDs de receipts imutáveis e resolva path, intervalo e conteúdo no host. Rejeite
IDs desconhecidos, schema inválido e leituras truncadas; mantenha a validação
de identidade/conteúdo no snapshot antes de aplicar o resultado. Não complete
referências inventadas nem transforme busca limitada em prova de ausência.

Separe instruções por responsabilidade. A verificação causal recebe fatos do
snapshot e candidatos, sem as instruções para produzir uma segunda revisão
aberta. Conserve idioma, limites e omissões nessa projeção. As linhas produtoras
canônicas fornecidas ao modelo devem vir do mesmo índice usado na validação do
host, preservando conteúdo exato, inclusive espaços.

Uma resposta estruturada válida não basta para confirmar o defeito. Exija cenário
alcançável com os argumentos e guards presentes, ou contrato público apoiado por
evidência independente. Um input imaginado que faria o código falhar não demonstra
regressão no caller observado. Não use filtros de palavras do diagnóstico para
fabricar precisão: mantenha negativos executáveis, falhas e repetições no corpus.

Um benchmark real deve persistir orçamento financeiro antes de transmitir cada
request, conservar reservas de custo desconhecido e recusar retomadas com fontes,
rota ou casos diferentes. Não renove tetos ao reiniciar um processo. Contabilize
preparação, tools físicas/lógicas e inferência separadamente; documente quando o
modelo e o fallback não permitem confirmar o custo total por attempt.

Antes de inferência paga, compilar fixtures TypeScript em base/head com o
compilador fixado pelo workspace e executar os oracles correspondentes. Um
controle negativo deve ser válido também nas fronteiras estáticas pertinentes;
um oracle de runtime sozinho não prova ausência de erro de tipos. Isolar a
regressão desejada no positivo e declarar o contrato explicitamente quando a
inferência de tipos do snapshot cria outro defeito.

Grader deve recusar diagnóstico alheio na localização correta, severidade
incompatível e revisão incompleta. Declarar a rubrica antes do modelo responder,
conservar motivos de reprovação e separar rubrica lexical de verdade semântica.
Não transformar a rubrica em filtro de findings de produção. Após mudar uma
fixture ou grader, conservar o histórico e repetir os dois braços para uma nova
comparação; não reclassificar o resultado antigo como execução das fontes novas.

Uma política do host usada em avaliação deve ter o mesmo dono do runtime.
Centralizar seleção canônica de candidatos e propagação de degradação; uma
segunda implementação pode medir um comportamento mais permissivo que o produto.
