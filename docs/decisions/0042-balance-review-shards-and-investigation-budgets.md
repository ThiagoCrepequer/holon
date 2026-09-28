---
id: ADR-0042
kind: decision
status: accepted
date: 2026-09-28
owners: [core-team]
supersedes:
  - 0039-partition-large-reviews-and-bound-concurrency.md
---

# Equilibrar tamanho dos shards e orçamento da investigação

## Contexto

A execução do PR do Sandbox com 32 arquivos e 1.368 linhas adicionadas gerou
15 partes. Houve encerramento por rodadas, ferramentas e tamanho de geração.
Os logs do Gateway consultados em 2026-09-28 mostraram respostas HTTP 200, com
72.214 dos 99.647 tokens de saída contabilizados como reasoning. Três chamadas
atingiram exatamente o teto de 4.000 tokens. Isso sustenta a falta de espaço de
saída; não prova que todos os casos incompletos tenham a mesma causa.

## Decisão

Esta decisão substitui os valores de particionamento e investigação da ADR-0039.
Preserva sua admissão global, os 64 shards, a concorrência de cinco, os checkpoints,
o Sandbox por run e a interrupção de publicação por falhas de infraestrutura.
O usuário autorizou a mudança e um PR independente do trabalho do Sandbox.
O número 0041 está reservado ao ADR daquele PR ainda separado.

| Limite                                          | Novo valor                                      |
| ----------------------------------------------- | ----------------------------------------------- |
| Arquivos distintos por shard                    | 8                                               |
| Linhas adicionadas por shard                    | 384                                             |
| Patch canônico por shard                        | 48.000 bytes UTF-8                              |
| Janelas de evidência por shard                  | 48                                              |
| Rodadas de investigação, incluindo encerramento | 10                                              |
| Chamadas de ferramentas sem cache por shard     | 24                                              |
| Saída por rodada de investigação                | 12.000 tokens, incluindo reasoning              |
| Investigação                                    | 9 minutos                                       |
| Deadline por onda                               | 17 minutos, fixado em checkpoint                |
| Step de modelo                                  | 19 minutos, incluindo preparação e persistência |

O planner aproxima localidade por nomes e árvores espelhadas `src`/`test`/`tests`/
`__tests__`, dentro do mesmo projeto. Mantém pares de implementação e testes
`.test`/`.spec` juntos quando o grupo cabe em um shard vazio. Grupos maiores
continuam sujeitos à partição canônica por hunk/linhas. A seleção entre modos
estrutural/textual opera sobre grupos. Ordenação é determinística, independente
da ordem de entrada. Isso não é um grafo completo de dependências: nomes diferentes,
contratos e consumidores entre pacotes ainda exigem investigação contextual.

Linhas removidas e contexto consomem bytes, mas não o limite de linhas adicionadas.
A contagem de bytes e evidência durante a partição é incremental, evitando
reexaminar todo o prefixo a cada linha. Código e coordenadas permanecem canônicos.
Bytes são uma aproximação conservadora de capacidade, não um tokenizer universal.
O preflight inicial reserva o novo teto de saída e 8 KiB de protocolo/ferramentas
dentro da hipótese de contexto de 128 Ki tokens; não garante capacidade de qualquer
modelo escolhido no Gateway nem limita sozinho o histórico posterior de ferramentas.

O gerador informa a cada rodada as chamadas, rodadas e tempo restantes. Ele deve
concluir assim que terminar as verificações necessárias. As quatro rodadas extras
permitem continuar trabalho pendente dentro do mesmo deadline, sem outra camada
de retry ou renovação de reservas. A décima rodada fecha ferramentas; esse fechamento
forçado continua incompleto, mesmo que a finalização produza JSON válido sem achados.
As 24 reservas são duráveis, transacionais e compartilhadas entre tentativas.

O teto de chamada permanece em três minutos; finalização e recuperação conservam
três minutos cada, e consolidação/persistência conservam dois minutos. O catálogo
da finalização admite até 64 janelas e 48.000 bytes de entidades JSON, priorizando
locais citados. Janelas que não cabem não são cortadas nem inventadas. A validação
literal da evidência e o veto a aprovação incompleta permanecem obrigatórios.

Logs de uso incluem shard; metadados do Gateway incluem shard e fase de geração.
Não são registrados prompts, código, resultados de ferramentas ou exceções arbitrárias.

## Alternativas e consequências

Aumentar somente o timeout mantém a fragmentação e não resolve o limite de tokens.
Eliminar shards concentra contexto demais; definir uma quantidade fixa pelo número
de linhas ignora bytes e dispersão da evidência. Não adotamos nenhuma dessas opções.

Menos partes reduz repetição de contexto e finalizações, mas não garante redução
de custo: os tetos por investigação aumentam. A qualidade também precisa de smoke
remoto com defeitos conhecidos e relações entre arquivos. Não há garantia de que
um modelo com contexto menor, disponibilidade limitada ou geração longa concluirá.

## Confirmação e rollout

Testes cobrem pares entre árvores, isolamento entre projetos, grupos grandes,
ordenação estável, coordenadas, UTF-8, janelas esparsas, limite de dez rodadas,
encerramento incompleto, deadline fixo e reservas concorrentes/reutilizadas.

O diff local entre `68eddf8` e `7299188` passou a oito shards, conservando os
32 arquivos e 1.368 coordenadas adicionadas. Esse ensaio não chama provider nem
comprova recall de defeitos, custo ou latência em produção.

Após merge e deploy autorizado de executor/control-plane compatíveis, iniciar
uma nova run no PR do Sandbox. Não retomar um plano antigo com limites novos:
o digest protege o replay e deve continuar detectando alterações. Comparar partes,
omissões, achados inline esperados, motivo de parada, tokens totais/reasoning,
chamadas de ferramentas e duração. Aprovação só é aceitável com cobertura completa.
Este PR não executa deploy nem altera modelos/fallbacks.

## Fontes verificadas em 2026-09-28

- [OpenRouter: reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens): reasoning consome orçamento de saída.
- [Workers: boas práticas](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/): estado por execução e trabalho assíncrono controlado.
