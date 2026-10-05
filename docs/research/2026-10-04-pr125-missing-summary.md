---
id: RESEARCH-REVIEW-125-MISSING-SUMMARY
kind: research
status: current
date: 2026-10-04
owners: [core-team]
---

# PR #125: Workflows concluídos com resumo ausente

## Evidência confirmada

Consultas somente leitura à Cloudflare correlacionaram duas reviews do
[PR #125](https://github.com/ThiagoCrepequer/holon/pull/125):

- Review de `2026-10-04T18:31:24Z`, head
  `eef21d6d7cbaf9ad1f1f649b44515761a4a9c21c`, base
  `d23115c6d698e3449c258ae46b48034217899f84`: seis Workflows de investigação
  concluídos e `shard-3` com resumo vazio e saída degradada.
- Review de `2026-10-04T18:58:35Z`, head
  `e75fe9c1cf418ca41a4fdac44e5f98d5593387be`, base
  `9f9000c488a20370b09aad4715cfde6ee8a8177a`: seis Workflows concluídos e
  `shard-4` degradado. Sua instância é
  `review-b5fdabe2b6910fad822b7afca0febc8f3bcac8fa2742a4fe277ea99f118251e9`.
  O resultado original de `review-shard:wait-1` tinha status `completed`,
  `summary` com zero caracteres, `isDegraded: false`, nenhuma limitação e
  listas vazias de findings, resoluções e observações.

Na segunda execução, o evento `review.shard_partial`, ID
`01M444GDM600000000000000TJ`, registrou índice 4 e motivo `model_degraded`.
O evento `review.analysis_partial`, ID `01M444GE5500000000000000VK`, confirmou
`scopeStatus: complete`, seis partes planejadas e analisadas, zero falhas e
uma parte degradada. A run concluiu e executou cleanup. A consulta filtrada
pelo `runId` encontrou 16 eventos estruturados, sem rejeição de orçamento
nessa execução. As fases causais não foram iniciadas, pois não havia candidatos.

O parser marcava resumo vazio como degradação, mas não adicionava código de
limitação. A agregação publicava análise incompleta sem explicar a falta de
narrativa, e o cabeçalho chamava esse estado de cobertura parcial mesmo com
todos os shards concluídos. Não foi observada uma falha de execução como a
do PR #124; o resultado conservador veio da ausência de narrativa.

Payloads e credenciais foram inspecionados somente em memória; este relatório
não conserva conteúdo privado. A leitura usou as APIs de
[step do Workflows](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/step/)
e [telemetria](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/).

## Correção e evidência local

Resumo vazio agora recebe `summary_missing`. O Workflow faz uma única tentativa
de recuperar somente narrativa e limitações pelo `ThinkWorkflow.step.prompt`
existente. O modo durável do Agent restringe a chamada a uma inferência, sem
tools de repositório, com até 1.024 tokens e 60 segundos, respeitando o deadline
e o orçamento agregado atuais. O schema não aceita substituição de candidatos.
Uma resposta válida remove apenas a causa do resumo ausente; todas as outras
limitações ou declarações de degradação permanecem. Falhas preservam o draft
como parcial; supersession impede devolver um resultado.

Regressões locais reproduziram a falta de recuperação e de diagnóstico antes
da mudança. Os testes Workerd usam Think e Workflows reais com provider
simulado e o ledger de orçamento, cobrindo sucesso, nova narrativa vazia,
erro do provider, negação de orçamento, mudança de autoridade, tentativa de
alterar findings e preservação das demais limitações e dados. Testes puros
verificam o motivo específico e o cabeçalho de análise incompleta. Essa prova
não mede a qualidade do modelo nem comprova recuperação em produção; não
houve deploy ou replay remoto nesta correção.

Integração conferida em 2026-10-04 com `@cloudflare/think` 0.20.0, Agents 0.26.0
e as fontes oficiais de [Think Workflows](https://developers.cloudflare.com/agents/harnesses/think/workflows/)
e [regras de Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).
