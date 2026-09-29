---
id: RESEARCH-REVIEW-99-INCIDENT
kind: research
status: current
date: 2026-09-28
owners: [core-team]
---

# Incidente do PR #99: interrupção do Sandbox e amplificação da falha

## Conclusão

O gatilho registrado foi a substituição do container por rollout. O problema do
Holon é como responde à interrupção: ferramentas deixam de funcionar, mas o
modelo continua consumindo inferência, retentativas e finalização antes de a
falha de infraestrutura ser propagada. O runtime terminou após aproximadamente
10 minutos, sem iniciar a segunda onda. Aumentar limites não corrige esse caminho.

O incidente não demonstra defeito na chave GitHub, omissão do diff, excesso de
payload ou HTTP 404 do provider. Não há evidência de que o idle de 30 segundos
tenha causado esta interrupção. Também não é uma amostra válida para concluir
se o novo checkpoint melhora a qualidade em um executor saudável.

## Evidência remota

Consultas somente leitura em Workers Observability, API de Workflows, deployments,
metadados do AI Gateway e GitHub. Código analisado: main `f2b8c5e`, cujo conteúdo
é igual ao branch da correção #98 (`9630cdd`) nessa comparação.

- PR: https://github.com/ThiagoCrepequer/holon/pull/99
- Head: `7299188ca10cd4f20c5c63a05a96f993ee12c216`.
- Base: `f2b8c5e6e67afc5273ebbd52e1ff9427d5016602`.
- Workflow: `review-f50a6c20324a261be2aad2ac8d0b22145476749f3f221ecc61afe46d13f5aee1`.
- Worker control-plane: `56f04066-e12b-460c-8778-1d707af92ad1`.
- Worker executor: `5ae4f35f-2acf-4161-8cfe-a31231d3b3fb`.
- Foram recuperados 444 registros correlacionados pelo PR e 497 registros do
  executor na janela; estes conjuntos se sobrepõem, não devem ser somados.

Horários em UTC de 2026-09-28; Brasília é UTC−03:00:

| Horário      | Evidência                                                                        |
| ------------ | -------------------------------------------------------------------------------- |
| 22:53:40     | Publicação da versão do executor                                                 |
| 22:53:47     | Publicação da versão do control-plane                                            |
| 22:55:28     | Início do Workflow                                                               |
| 22:55:45     | Repositório preparado: 32 arquivos, 1.368 linhas alteradas, sem truncamento      |
| 22:56:03     | Primeira onda: cinco de oito shards                                              |
| 22:56:58.883 | Primeiras ferramentas falham                                                     |
| 22:56:58.884 | Runtime cancela RPCs com diagnóstico de requisição sem possibilidade de resposta |
| 22:56:58.985 | SDK: “Runtime signalled the container to exit due to a new version rollout: 0”   |
| 23:01:31     | Primeiro shard termina com `RepositoryToolError`                                 |
| 23:05:34     | Último shard da onda termina; revisão marcada como falha                         |
| 23:05:34.936 | `sandbox.destroy` registra sucesso                                               |
| 23:05:39     | Workflow encerrado e aviso de falha publicado                                    |

A API do Workflow informa erro terminal `RepositoryToolError: Repository
infrastructure failed`, não falha primária de parse. O evento `review.failed`
registrou 608.558 ms. Não houve `analyze-shard-6`, `7` ou `8`.

| Parte | Ferramentas concluídas | Ferramentas falhas | Última cobertura registrada          |
| ----- | ---------------------: | -----------------: | ------------------------------------ |
| 1     |                      4 |                 10 | 8 pendentes                          |
| 2     |                      4 |                  7 | 6 pendentes                          |
| 3     |                      4 |                  7 | 1 pendente                           |
| 4     |                      2 |                  5 | 1 bloqueada                          |
| 5     |                      0 |                  6 | 1 pendente                           |
| Total |                     14 |                 35 | Nenhum arquivo marcado como revisado |

Os contadores de cache permaneceram em zero. Portanto, esta execução não
sustenta a hipótese de que chamadas idênticas fossem a principal fonte do gasto.
Há 18 exceções de runtime com o diagnóstico de RPC sem resposta. As operações
falhas posteriores passam pela verificação da concessão e param na leitura,
sem executar comandos do repositório: concessão persistida não prova que o
filesystem efêmero continua disponível. A perda exata de arquivos e o estado
interno do SDK após cada erro não foram diretamente inspecionados.

O Gateway retornou 35 chamadas com HTTP 200 para `deepseek/deepseek-v4.1-flash`,
549.899 tokens de entrada e 50.472 de saída. São metadados observados, não uma
medição completa de faturamento ou de chamadas canceladas. O Worker registrou
523.698/46.882 tokens, evidenciando que os contadores locais não cobrem todos os
casos de interrupção. HTTP 200 não comprova saída semântica válida.

A parte 5 esgotou 8.192 tokens tanto na finalização quanto na recuperação.
Essa falha secundária consumiu mais recursos, mas o serviço já havia registrado
falha de infraestrutura e descartaria qualquer resultado final. Não há dados
suficientes para atribuir todo esse limite a tokens de raciocínio.

## Problemas confirmados no código

### P1 — A falha fatal só é propagada depois da análise

Em `apps/control-plane/src/review-services.ts`, o catch da ferramenta guarda
`infrastructureFailure`, mas não interrompe o generator nem impede a próxima
chamada. A verificação ocorre depois de `await delegateModel.review(...)`.
O SDK pode entregar um erro de ferramenta ao modelo e continuar normalmente.
Neste incidente, transcorreram cerca de 8min35s da primeira falha até a marcação
terminal, incluindo novas ferramentas, retomadas e finalizações sem utilidade.

Critério de correção: depois de falha fatal reconhecida, nenhuma nova inferência,
ferramenta ou finalização deve iniciar naquele trabalho. As operações em voo
precisam receber cancelamento e ser reunidas antes de recuperar ou limpar.

### P1 — Não existe recuperação coordenada do contexto durante a onda

A preparação acontece antes da análise. `startTool` confere a concessão e
`executeRepositoryTool` lê a política no filesystem. Não há uma transição que
reconstrua o contexto após perda do runtime. Os steps de análise não têm retry.
Remover a preparação oculta de cada ferramenta evitou reconstruções concorrentes,
mas deixou de existir um caminho substituto para a perda do container.

Critério de correção: classificar perda de contexto, interromper a onda, recuperar
uma única vez por incidente e de forma serializada, mantendo SHA, configuração,
política e digest do plano. Retomar somente trabalho pendente e preservar contadores
e prazo originais. Esgotada a recuperação, encerrar com causa específica. Não
recriar checkout independentemente em cada ferramenta.

### P1 — Erro de consulta e falha de infraestrutura são confundidos

`executeRepositoryTool` pode lançar por caminho não resolvido ou busca estrutural
indisponível. O catch do control-plane transforma qualquer erro não relacionado
a orçamento/cancelamento em `RepositoryToolError`. Uma consulta inválida pode
inutilizar toda a revisão mesmo que o modelo se corrija depois.

Critério de correção: resultados tipados para consulta inválida, caminho ausente,
escopo negado, truncamento, contexto perdido, timeout, transporte e invariantes.
Recusas de escopo continuam recusas; não liberar acesso para recuperar. Erros
corrigíveis da consulta retornam informação segura ao modelo; falhas do ambiente
acionam o mecanismo de interrupção/recuperação; invariantes desconhecidas falham
sem serem convertidas em aprovação.

### P1 — Ondas compartilham o container, mas não cancelamento de falha fatal

`review-analysis.ts` usa `Promise.allSettled` e só depois propaga rejeições.
Esperar todas antes de cleanup é correto. A ausência de cancelamento coordenado
faz essa espera significar continuar computando mesmo quando o recurso comum
já está indisponível. Os shards da onda falharam em horários separados por minutos.

Critério de correção: coordenador da onda propaga interrupção fatal; espera a
confirmação de término das operações; então decide recuperar ou terminar.
Trocar apenas por `Promise.all` deixaria trabalho órfão e não resolve o problema.

### P2 — O encerramento ainda depende de uma chamada cara ao mesmo modelo

A reserva de tempo muda ferramentas e prompt, mas não cria uma conclusão
independente da disponibilidade/latência do provider. Nesta execução, só uma
parte conseguiu checkpoint, marcado bloqueado. Retentativas após timeout e as
finalizações continuaram mesmo com o executor já comprometido.

Critério de correção: estado de infraestrutura precede qualquer decisão de retry;
encerramento local preserva checkpoints já concluídos sem solicitar inferência
inútil. Em execução saudável, validar por fase o contrato de tool calling, JSON
estruturado e orçamento de raciocínio. Não assumir que uma rota dinâmica tem o
mesmo comportamento em todas as fases. Não simplesmente aumentar tokens novamente.

### P2 — Os logs ainda eliminam a distinção necessária

`mapSandboxSdkError` colapsa várias causas em `unavailable`; o control-plane
reduz outras a `repository_tool_failed`; `ToolExecution.wait` registra `settled`
tanto em sucesso quanto em rejeição. `review.failed` recebeu apenas `Error` após
a fronteira de Workflow. Foi necessário encontrar o evento nativo do SDK para
identificar o rollout. Uma mensagem genérica adicional não resolveria.

Critério de correção: catálogo fechado de códigos seguros e eventos por transição,
com run, shard, operação, etapa, causa tipada, possibilidade de retry, identidade
do runtime e resultado `success/failure/cancelled`. Preservar a primeira causa,
sem registrar prompts, argumentos, arquivos, tokens ou exceções arbitrárias.

## Por que os testes passaram

Foram executados dois testes diagnósticos temporários no runtime Workers local:

1. Depois de erro de infraestrutura, o modelo simulado continua e uma segunda
   ferramenta é executada antes da rejeição final.
2. Um erro de caminho não resolvido produz a mesma rejeição fatal, mesmo após
   outra consulta bem-sucedida.

Ambos passaram porque demonstram o comportamento defeituoso atual. O arquivo
original foi restaurado. O roteiro e a saída ficaram em `/tmp/holon-incident99-probe.py`
e `/tmp/holon-incident99-probe.log`. Não houve alteração de código de produção.

O teste existente de timeout verifica que uma falha não vira aprovação, mas não
verifica interrupção imediata, custo posterior ou recuperação. Os testes da
concessão usam hooks simulados; não exercitam troca real da imagem durante
investigação. Os testes SDK do checkpoint simulam respostas obedientes do modelo.
São úteis, mas não comprovam adesão do provider real nem sobrevivência a rollout.

## Avaliação das últimas mudanças

Os gates conservadores de evidência, autoridade e incompletude devem permanecer.
KeepAlive reduz suspensão por inatividade, mas não oferece durabilidade. O cache
por intervalo é limitado e seguro, porém não ajuda chamadas que falham nem consultas
diferentes. O checkpoint explícito pode evitar narrativa extra, mas adiciona uma
obrigação ao modelo cuja confiabilidade remota ainda não foi demonstrada.

Aumentar limites e acrescentar controle sem fechar o ciclo de interrupção e
recuperação tornou as falhas mais caras. A direção deve mudar de ampliar orçamento
para limitar trabalho sem possibilidade de êxito e provar o comportamento composto.
O gate local foi usado como evidência de correção local; faltou uma barreira de
aceitação remota para promover as mudanças como solução do incidente.

## Ordem proposta de implementação e aceitação

1. **Conter o gasto e preservar a causa:** classificar falhas, impedir novas chamadas,
   cancelar inferência/ferramentas e juntar a onda. Testar que o contador de chamadas
   fica estável depois da falha reconhecida, sem finalização/recovery adicional.
2. **Recuperar o ambiente explicitamente:** reconstrução coordenada limitada,
   identidade imutável e orçamento preservado. Testar perda antes e durante ferramenta,
   cancelamento concorrente, replay e falha da própria recuperação.
3. **Controlar admissão durante deploy:** drenar/suspender admissões, verificar a
   conclusão do rollout e testar uma execução antes de reabrir. Uma margem de rollout
   pode ajudar, mas não substitui recuperação de falhas do host.
4. **Validar protocolo do modelo:** smoke pequeno positivo e negativo, JSON truncado,
   chamada inválida, checkpoint omitido, provider indisponível e deadlines. Avaliar
   rota/parametrização por fase usando o tráfego real, sem reduzir os critérios de
   qualidade para obter uma aprovação.
5. **Provar a composição:** smoke com interrupção controlada do container, duas
   ondas e PR grande. Medir cobertura, chamadas/tokens, latência e cleanup; não
   ampliar limites antes de estabelecer uma linha de base saudável.

Publicação parcial só cabe a falhas de análise classificadas. Falhas de estado,
política, contexto ou persistência continuam impedindo publicação normal. A
recuperação não pode gastar novamente um orçamento inteiro nem duplicar achados.

## Fontes e limites

Documentação oficial consultada em 2026-09-28:

- [Rollouts de Containers](https://developers.cloudflare.com/containers/configuration/rollouts/):
  o término do deploy não garante o fim da substituição das instâncias; o disco é
  efêmero e a substituição não altera o storage do Durable Object.
- [Deploy de Containers](https://developers.cloudflare.com/containers/guides/deploy/).
- [Lifecycle do Sandbox preview](https://developers.cloudflare.com/sandbox/1-0-preview/lifecycle/):
  relevante ao pacote e imagem `0.13.0-next.751.1` fixados no projeto.

Não foi provocado novo rollout, reiniciado Workflow, alterado secret, coletado
prompt no Gateway ou feito deploy. Não atribuímos os incidentes anteriores ao
mesmo gatilho sem examinar seus logs. Não foi medido faturamento completo. Este
relatório é diagnóstico e proposta, não implementação nem ADR aceito.

## Correção implementada após a auditoria

O patch associado introduz cancelamento da onda até o SDK, classificação fechada
no RPC, preservação da primeira causa, preparação compartilhada e resultados
operacionais distintos nos logs. A reconstrução continua antes da investigação.
A proposta de retomada automática durante geração permanece pendente: sem
continuação e consumo persistidos, reexecutar o modelo perderia estado e renovaria
custos. A [arquitetura](../architecture/review-runtime-flow.md#falha-de-ambiente-durante-uma-onda)
e o [runbook](../operations/deployment.md#admissão-e-rollout-do-sandbox-após-o-incidente-do-pr-99)
definem a fronteira implementada e a aceitação remota necessária. Os dados do
incidente acima descrevem o código anterior à correção.
