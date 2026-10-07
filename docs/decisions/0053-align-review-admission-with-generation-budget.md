---
id: ADR-0053
kind: decision
status: accepted
date: 2026-10-07
owners: [core-team]
related:
  - 0049-use-cloudflare-think-for-pr-review.md
  - 0050-verify-finding-causality-before-publication.md
---

# Alinhar admissão de shards ao orçamento de geração

## Problema

O PR #171 produziu 50 shards com apenas 64 inferências disponíveis. Na execução
que concluiu em 2026-10-07, a investigação relatada consumiu 58 chamadas e
3.989.338 dos 4.000.000 bytes de entrada antes de a parada impedir os 32 shards
restantes. Esse saldo não comportava o trabalho planejado. A entrada contabiliza
cada inferência, incluindo histórico e schemas, e não apenas o diff. Shards
iniciais podiam consumir o saldo de trabalho ainda não iniciado.

## Decisão

Esta decisão complementa as ADRs 0049 e 0050. Preserva Think, os tetos agregados
de 64 chamadas, 4.000.000 bytes de entrada e 120.000 tokens de saída, e a
concorrência três. Define a admissão e a distribuição do trabalho dentro desses
tetos:

1. Cada shard pode usar quatro inferências de investigação, duas de verificação
   causal e uma de recuperação narrativa. São sete chamadas por ciclo máximo.
   As quatro chamadas permitem leitura/busca e finalização; a verificação dispõe
   de uma oportunidade de ferramenta e uma finalização. O Think continua
   responsável por forçar a ferramenta final no último passo de cada turno.
2. Antes do despacho, o control plane admite no máximo `floor(64 / 7) = 9`
   shards da ordem prioritária existente. O plano estrutural pode conter até
   64; o plano efetivo registra `model_budget`, a quantidade original e a
   admitida, preserva os totais elegíveis e outras omissões e fixa `totalShards`
   antes de calcular o digest. Não declara cobertura do trabalho omitido.
3. O ledger protege uma parcela igual de chamadas, bytes cumulativos de entrada
   e tokens de saída para cada shard admitido: `floor(teto / totalShards)`.
   Reservas de investigação, verificação e recuperação da mesma parte somam
   nessa parcela. Settlement libera somente a saída daquele shard; entrada e
   chamadas não são renovadas. Reservas históricas continuam nos totais globais.
4. A saída máxima por inferência normal é o menor entre 12.000 e
   `floor((parcela de saída - 1.024) / 6)`. A recuperação mantém 1.024 tokens.
   Assim, até resultados de uso incerto cabem no orçamento de saída reservado
   para as seis chamadas normais e a recuperação.
5. Recusas `shard_calls`, `shard_input_bytes` e `shard_output_tokens` encerram
   o trabalho daquela parte; não persistem uma parada global. Os outros shards
   conservam sua oportunidade. Uma recusa de teto agregado continua durável e
   bloqueia novas ondas conforme a política anterior. Se o agregado ainda tem
   capacidade, um pedido acima da parcela é recusado localmente primeiro, mesmo
   se esse pedido também ultrapassaria o teto global. Um shard não pode usar um
   pedido inadmissível para bloquear os pares. Tetos já esgotados ou um pedido
   localmente válido que ultrapasse o saldo agregado continuam globais.
6. O Agent persiste apenas uma causa allowlisted de falha. O filho registra
   ausência de resposta final, schema inválido, timeout e orçamento; o adapter
   lê essa causa por RPC quando o Workflow falha. Não depende da mensagem de
   erro do status, que pode ser substituída por `WorkflowFatalError`, nem emite
   mensagens arbitrárias de provider nos diagnósticos. O hook `onStart` migra
   uma única vez o estado já persistido sem o campo de causa, adicionando `null`
   e preservando recuperação e demais dados antes da retomada do Think.

## Consequências e limites

PRs grandes produzem parcialidade explícita já no planejamento. Para 50 shards,
41 são omitidos pela admissão; isso não é promessa de revisar o PR inteiro.
Quotas não garantem sucesso do modelo: histórico crescente pode ultrapassar os
bytes da própria parte, e saída longa pode terminar incompleta. Não há aumento
automático de limites, empréstimo de saldo de pares ou aprovação de cobertura
parcial. Uma alteração futura desses parâmetros exige evidência de qualidade,
custo e capacidade, em vez de apenas aumentar o teto após um incidente.

O teto independente de 32.000 entradas de linhas alteradas no executor permanece
explícito como `executor_budget`. Limitar chamadas não recupera contexto que o
executor omitiu. A ordem priorizada e a partição de patches permanecem as mesmas.

A rota real precisa aceitar ferramentas forçadas em streaming. A ausência de
`think_final_answer` identifica a falha de protocolo, mas não prova qual nó,
modelo ou comportamento a causou. Testes locais com modelo simulado e probes
sintéticas não demonstram qualidade ou confiabilidade de uma revisão real.

Fontes oficiais consultadas em 2026-10-07:
[Think Workflows](https://developers.cloudflare.com/agents/harnesses/think/workflows/)
e [uso de rotas dinâmicas](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/).

A migração de estado usa as APIs públicas `onStart`, `state` e `setState` do
Agents 0.26.0, verificadas em 2026-10-07 no pacote instalado e na documentação
[Store and sync state](https://developers.cloudflare.com/agents/runtime/lifecycle/state/).
`initialState` vale somente para novos objetos; não redefine estado persistido.
