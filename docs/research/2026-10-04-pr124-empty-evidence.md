---
id: RESEARCH-REVIEW-124-EMPTY-EVIDENCE
kind: research
status: current
date: 2026-10-04
owners: [core-team]
---

# PR #124: candidatos sem evidência interromperam o shard

## Evidência confirmada

A investigação somente leitura da Cloudflare correlacionou a revisão do
[PR #124](https://github.com/ThiagoCrepequer/holon/pull/124), head
`f94888b356cc2dca2115acbc1205cb583a3abd6d`, base
`d23115c6d698e3449c258ae46b48034217899f84`, com a instância
`review-3e4022bd0708b3481e5f7d42cdba74e845d4b9df4330d60422f4a6c65041b56d`
da fase `investigation`, índice 1. Ela começou em
`2026-10-04T17:32:17.711Z` e terminou em `2026-10-04T17:32:34.634Z`.

Os steps `review-shard:submit-1` e `review-shard:wait-1` concluíram. O payload
informava conclusão da submissão, mas a validação seguinte falhou com `ZodError`:
`too_small`, mínimo 1, em `findings[0].evidence` e `findings[1].evidence`.
O evento de erro de `2026-10-04T17:32:34.556Z` foi correlacionado pela mesma
instância. Os dois candidatos tinham arrays de evidência vazios e não passaram
por verificação canônica ou causal. Não constituem achados verificados.

O Worker observado tinha versão `be9e318f-d77b-4a37-b258-4d1fa17785c9`, publicada
em `2026-10-04T16:30:39.999232Z`, e não tinha o binding `REPOSITORY_MEMORIES`.
Não se atribui esse erro à implantação da memória persistente proposta no PR.
O schema de prompt permitia evidência vazia; o parser de transporte exigia ao
menos uma evidência e rejeitava o shard inteiro.

A [API de step do Cloudflare Workflows](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/step/)
e a [API de telemetria](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)
foram consultadas em 2026-10-04. Payloads privados e credenciais permaneceram
em memória; este documento conserva apenas coordenadas e falhas de schema.

## Correção e limites

O host agora descarta individualmente findings e resoluções sem evidências
válidas, preserva candidatos válidos e limitações anteriores e marca a saída
como degradada com `evidence_rejected`. A narrativa original é substituída por
aviso de análise incompleta. Não são fabricadas evidências, e nenhum candidato
retido dispensa os gates existentes. O prompt orienta evidência não vazia, mas
mantém a entrega ao host para permitir essa recuperação conservadora.

O teste de contrato reproduziu `ZodError` antes da mudança. A regressão local
também cobre dois candidatos sem evidência no fluxo Think/Workflow em Workerd
com modelo simulado, além da preservação de candidatos válidos e resoluções.
Essas verificações não comprovam nova execução com o provedor real. Não houve
deploy nem replay remoto nesta correção.
