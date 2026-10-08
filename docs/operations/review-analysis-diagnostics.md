---
id: OPERATIONS-REVIEW-ANALYSIS-DIAGNOSTICS
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
---

# Diagnóstico de análise parcial ou interrompida

Use o `runId` do Check Run ou do marcador da review para correlacionar a
instância de `holon-review-workflow`, os `ReviewShardWorkflow` e os logs do
`holon-control-plane`. `wrangler workflows instances list` e
`wrangler workflows instances describe <workflow> <id> --no-step-output`
mostram estados e etapas sem imprimir os resultados privados. Um Workflow pai
concluído ainda pode representar análise parcial: confirme o Check Run e os
eventos abaixo. `wrangler tail` acompanha somente eventos novos.

Para um shard, `agent_workflow_failed` significa apenas que o
`ReviewShardWorkflow` terminou com status `errored`. Esse código não distingue
falha do provider, orçamento, tool ou runtime. O ID da instância do shard é
`review-` seguido do SHA-256 hexadecimal de `<runId>:<shardIndex>:<phase>` (índice
começa em zero; fase `investigation` ou `causal_verification`). Para execuções
anteriores à separação das fases, confirme a fórmula no artefato implantado.
Consulte
`wrangler workflows instances describe holon-review-shard-workflow <id> --no-step-output`
e correlacione com os eventos do Agent antes de atribuir uma causa. Evite
imprimir step output ou trace payload em relatórios operacionais: eles podem
conter código privado. Sem acesso à instância ou ao trace, registre a causa
interna como não determinada.

Quando a instância terminar com erro após `review-shard:wait-1`, confira o tipo
do erro e o schema da resposta antes de atribuir a falha ao provider. Na
execução do PR #121 em 2026-10-04, um `ZodError` resultou de `summary` vazio
aceito pelo schema do prompt e rejeitado pelo parser de transporte. A
[API de step do Cloudflare Workflows](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/step/)
(documentação verificada em 2026-10-04) permite consultar a saída integral
quando `wrangler describe` a trunca. Essa saída pode conter código privado:
inspecione em processo, sem imprimir ou persistir payload, e relate somente
estado, etapa e falhas de schema. Veja a
[investigação do PR #121](../research/2026-10-04-pr121-partial-review.md).

Na execução do PR #124 em 2026-10-04, dois candidatos com `evidence: []`
causaram `too_small` em `findings[0].evidence` e `findings[1].evidence` após o
step concluído. A correção descarta candidatos sem evidências válidas e conserva
o shard como degradado, com `evidence_rejected`; não o transforma em análise
limpa. Veja a [investigação do PR #124](../research/2026-10-04-pr124-empty-evidence.md).

Se todos os shards concluíram e a análise permanece parcial, confira
`degradedShards` em `review.analysis_partial` e os motivos de
`review.shard_partial`. No PR #125, em 2026-10-04, o step do modelo concluiu com
`summary: ""` e `isDegraded: false`; o parser marcou degradação por falta de
narrativa, registrada na versão anterior apenas como `model_degraded`.
A correção registra `summary_missing`, tenta uma recuperação durável chamada
`recover-summary` e conserva a revisão parcial com explicação pública se a
tentativa falhar. Essa chamada usa uma inferência de até 1.024 tokens no mesmo
saldo da run, sem tools de repositório e com wait de até 60 segundos, limitado
pelo deadline restante. Não confunda esse caso com shard em status `errored`.
Veja a [investigação do PR #125](../research/2026-10-04-pr125-missing-summary.md).

| Evento                                                                   | Interpretação                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `review.analysis_context_loaded`                                         | Leitura completa, planejamento e digest do snapshot da invocação; `files`, `shards`, `patchBytes` e `durationMs` são contagens e wall time, sem payload. Reconstrução ou retomada exigem nova leitura. |
| `review.analysis_budget_stopped`                                         | Primeira recusa durável impediu nova onda; `rule` identifica a dimensão e `unstartedShards` a cobertura não admitida. Peers já admitidos são aguardados.                                               |
| `model.budget_rejected`                                                  | O ledger recusou uma inferência pelo teto **agregado da run**. `rule`, `current`, `requested` e `limit` identificam a dimensão; shard e fase ajudam a localizar a chamada.                             |
| `model.step_finished`                                                    | Passo do Think concluído: `finishReason` permitido, índice do passo, nomes permitidos de tools e uso reportado. Ausência de saída final e recusa de orçamento continuam eventos distintos.             |
| `repository.tool_budget_rejected`                                        | A run alcançou o teto agregado de 96 consultas; `totalCurrent` e `totalLimit` mostram a admissão transacional.                                                                                         |
| `review.shard_failed`                                                    | O shard falhou ou expirou. `reason` distingue falha do Agent Workflow, deadline e erros classificados do provider.                                                                                     |
| `review.shard_partial`                                                   | O shard devolveu limitações, contexto omitido, evidência rejeitada ou saída degradada.                                                                                                                 |
| `review.analysis_partial`                                                | Escopo, partes planejadas, concluídas, falhas e degradadas da revisão.                                                                                                                                 |
| `review.analysis_step_failed`, `review.analysis_failed`, `review.failed` | Etapa ou run interrompida; correlacione com estado do Workflow e cleanup.                                                                                                                              |
| `project.identification_partial`                                         | Identificação parcial de projetos; isoladamente, não determina falha de review.                                                                                                                        |

Os tetos de modelo são 64 inferências, 4.000.000 bytes de entrada serializada
e 120.000 tokens de saída reservados ou consumidos por run, compartilhados
entre shards. Uso desconhecido conserva a reserva máxima. A decisão de
admissão não mede custo faturado. A [ADR-0049](../decisions/0049-use-cloudflare-think-for-pr-review.md)
substitui a divisão por shard da ADR-0046.

A primeira recusa também interrompe a admissão de novas ondas, sem renovar saldo
após settlement/retry/eviction. A review publicada informa orçamento esgotado e
cobertura parcial; uma recusa na última onda pode não emitir
`review.analysis_budget_stopped` porque não há shards restantes. Consulte
`model.budget_rejected` e o resultado agregado. `agent_workflow_failed` continua
uma falha genérica: não atribua todas as falhas de peers à recusa global.

## CPU e validação após publicação do artefato

No PR #171, a invocação do pai registrou `outcome=exceededCpu`,
`cpuTimeMs=32000` e `wallTimeMs=799044`. O step que estava ativo era
`analyze-review-1`; isso não mede a CPU exclusiva desse callback. O runtime
usava o default de 30 segundos. A correção reduz o trabalho repetido e configura
60 segundos de CPU no script. Veja a
[investigação datada](../research/2026-10-07-pr171-cpu-and-budget-exhaustion.md).

Após um deploy autorizado, confirme a versão do Worker efetivamente utilizada
pelo Workflow, o limite implantado e a invocação correspondente ao `runId`.
Compare `cpuTimeMs` por invocação e por quantidade de shards/contexto, sem
confundir esse valor com `durationMs` do evento de leitura ou com wall time.
Uma run pode atravessar várias invocações. Em revisões grandes, confirme também:

- leitura única do snapshot por invocação sem reconstrução;
- ausência de novos Agents/ondas após a primeira recusa, preservando os peers
  já admitidos e a explicação pública de cobertura parcial;
- ausência de `exceededCpu`, publicação idempotente e `cleanup_completed`.

Workerd local e dry-run não comprovam o limite remoto nem latência/custo real.
Não reinicie uma run nem faça deploy apenas como validação local. Se a margem
continuar insuficiente, meça os trechos ativos antes de alterar outro teto; não
atribua uma função quente somente ao nome do step interrompido.

O Agent tracing fica habilitado durante o beta. Com
`AGENT_TRACE_PAYLOADS=enabled`, mensagens e outputs de tools podem conter
trechos do repositório; restrinja acesso e desabilite a captura quando o
usuário solicitar. Os logs estruturados não devem conter prompt, diff,
argumento de ferramenta, resposta integral, stack, erro arbitrário ou
credencial. Falhas de log não alteram admissão, veredito ou cleanup.

Implementação: `apps/control-plane/src/review/review-agent.ts`,
`ledger/review-generation-budget-store.ts`, `ledger/review-tool-budget-store.ts`,
`review/review-analysis.ts` e `review/review-workflow.ts`.

## Admissão de geração e causas do Think

A [ADR-0053](../decisions/0053-align-review-admission-with-generation-budget.md)
admite até nove shards antes do despacho, dentro dos tetos agregados. O plano
estrutural pode ter mais partes; `model_budget` registra a quantidade original e
a admitida. `executor_budget` continua uma limitação independente de contexto,
incluindo o teto de 32.000 entradas de linhas alteradas.

Cada shard conserva `floor(teto / totalShards)` de chamadas, entrada cumulativa e
saída. Em `model.budget_rejected`, `rule=shard_calls`, `shard_input_bytes` ou
`shard_output_tokens` indica a parcela local; `current/requested/limit` são dessa
parcela. Os campos `callsCurrent/inputBytesCurrent/outputTokensCurrent` continuam
os totais globais. Recusa local não grava `stop_reason` global e não impede a
análise de outras partes. Somente recusa de teto agregado para novas ondas.

Uma falha conhecida fica no estado durável do Agent e chega ao adapter por RPC.
Os códigos são `model_budget_exhausted`, `model_shard_budget_exhausted`,
`model_output_missing`, `model_schema_invalid` e `agent_deadline_exceeded`.
Não inferir a causa de peers usando apenas a parada global. Não usar mensagens
arbitrárias do provider como códigos. O status do Workflow pode apresentar
somente `WorkflowFatalError`, mesmo quando o erro interno é específico.

O Think 0.20.0 já força `think_final_answer` no último passo. Se o modelo terminar
antes sem essa chamada, o código é `model_output_missing`; o host não aceita
texto livre nem inventa uma resposta. A causa histórica no modelo exige evidência
adicional. Verifique a rota real com dados sintéticos e streaming; sucesso de
uma amostra não prova confiabilidade dos turnos de review. Fonte oficial,
consultada em 2026-10-07: [Think Workflows](https://developers.cloudflare.com/agents/harnesses/think/workflows/).

## Protocolo do provedor e investigação de 2026-10-08

As últimas revisões dos PRs #174 e #177 terminaram com seis de nove partes
analisadas. Três partes de cada execução falharam com `model_output_missing`.
Os metadados retidos do Gateway mostraram respostas HTTP 200; esse status não
comprova a chamada de `think_final_answer` nem uma análise completa. No PR #177,
duas partes terminaram após quatro inferências e três consultas ao repositório,
com apenas 36 e 31 tokens na última resposta. Outra resposta registrou 2.051
tokens de texto e 2.348 de raciocínio. Sem `finishReason` por passo e sem
identificação do provedor interno do OpenRouter, não é possível atribuir essas
falhas a truncamento ou a um provedor específico.

Confira o contrato de ferramentas em cada destino da rota, incluindo fallback.
O OpenRouter permite provedores com capacidades diferentes para o mesmo modelo.
`provider.require_parameters=true` restringe a seleção a destinos que suportam
os parâmetros enviados; o padrão permite ignorar parâmetros não suportados.
Isso inclui a exigência de `tool_choice`, que o Think já envia no último passo.
Fonte oficial, verificada em 2026-10-08:
[seleção de provedores do OpenRouter](https://openrouter.ai/docs/guides/routing/provider-selection).
Não trate preferência por um provedor como prova de suporte obrigatório.

O controle `sendReasoning=false` do Think não desativa a geração de raciocínio
no provedor. A solicitação ao Gateway deve explicitar a política de geração;
a contabilização deve usar a saída total reportada, incluindo raciocínio, e
conservar a reserva quando o uso for desconhecido. No adapter OpenAI Compatible,
`includeUsage` solicita uso no streaming; o hook público `transformRequestBody`
permite expressar os parâmetros específicos da rota sem substituir o cliente
HTTP ou o loop do Think. Fonte oficial, verificada em 2026-10-08:
[adapter OpenAI Compatible do AI SDK](https://ai-sdk.dev/providers/openai-compatible-providers).

`model.step_finished` correlaciona `runId`, `shardIndex`, `phase` e
`summaryRecovery` com `stepNumber`, `finishReason`, `tools`, `inputTokens`,
`outputTokens`, `reasoningTokens` e `totalTokens`. Contagens ausentes ou inválidas
não são registradas como zero; motivos desconhecidos recebem `unknown`. O
evento não contém argumentos, texto, raciocínio, resposta bruta ou mensagens
arbitrárias. `outputTokens` já inclui `reasoningTokens`; não some os dois para
medir consumo. Falha de logging não muda o resultado nem a contabilização.

Três chamadas sintéticas de até 256 tokens à rota existente em 2026-10-08
receberam HTTP 200 e `think_final_answer`, com 17 tokens de saída e nenhum de
raciocínio. Duas usaram `provider.require_parameters=true` e
`reasoning.enabled=false`; a terceira usou os parâmetros anteriores. A prova
confirma compatibilidade da rota com esses parâmetros. Não reproduz o incidente,
não mede a confiabilidade de uma revisão completa e não comprova deploy.
Use dados sintéticos, desabilite coleta de payload e relate somente metadados;
não reinicie revisões de PR como parte de uma validação local.

Separe problemas de protocolo das demais limitações observadas:

- A admissão de nove entre dezessete partes do PR #177 segue a ADR-0053.
  Resolver `model_output_missing` não aumenta a cobertura admitida nem autoriza
  aprovar alterações que não foram investigadas.
- Warnings de despacho longo em `_cfRunSubmission` ocorreram no callback do
  SDK. Não desanexe a execução do callback para esconder o aviso: preserve o
  estado durável, o cancelamento e a confirmação de conclusão.
- Warnings de RPC não descartado apareceram durante preparação e descoberta
  do executor. Eles não provam a causa da saída ausente do modelo. Identifique
  a posse da capacidade antes de corrigir; não acesse campos privados do SDK
  para simular descarte de recursos. O SDK instalado
  `@cloudflare/sandbox@0.13.0-next.751.1` guarda uma capacidade no objeto de
  processo sem API pública de descarte. A
  [issue upstream #929](https://github.com/cloudflare/sandbox-sdk/issues/929)
  descreve essa limitação e continuava aberta na consulta de 2026-10-08.
  Isso identifica um defeito compatível com o aviso; não identifica a origem
  de cada ocorrência histórica. Aguarde uma correção pública verificável para
  alterar a dependência e a gestão de recursos.
- Exceções de fetch para `/` e `/favicon.ico` do executor pertencem à superfície
  HTTP, separada dos métodos RPC de preparação e consulta. O entrypoint agora
  responde 404 a qualquer requisição HTTP, sem acessar o Sandbox ou traduzir
  URLs em chamadas RPC. Os métodos privados continuam disponíveis pelo binding.

O gate continua exigindo saída estruturada válida, evidência verificável e
cobertura completa. Texto livre, respostas fabricadas ou retries adicionais
não substituem esse contrato.
