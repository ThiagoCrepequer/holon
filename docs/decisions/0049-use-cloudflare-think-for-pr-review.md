---
id: ADR-0049
kind: decision
status: accepted
date: 2026-10-03
owners: [core-team]
supersedes:
  - 0018-adopt-two-phase-decoupled-review-generator.md
  - 0045-bound-review-generation-expenditure.md
  - 0046-protect-shard-completion-and-local-replay.md
related:
  - 0004-adopt-workflows-do-ledger-and-sandbox-executor.md
  - 0039-partition-large-reviews-and-bound-concurrency.md
  - 0035-plan-complete-context-before-sharding.md
  - 0040-retire-admin-and-analytical-storage.md
---

# Usar Cloudflare Agents SDK e Think na revisão de Pull Requests

## Contexto e problema

O gerador próprio de duas fases exigia manter loop de tools, progresso, cache,
recovery e timeout. Incidentes documentados em `docs/research/` mostraram
falhas de encerramento e gasto elevado. O usuário decidiu substituir esse motor
pelo harness `@cloudflare/think` sobre Agents SDK, mantendo o AI SDK para o
provider e o AI Gateway. Qualidade e custo comparativos serão medidos depois.

## Direcionadores

- Preservar identidade causal por head/base SHA, publicação idempotente, revisão
  conservadora e verificação de evidência no host.
- Restringir tools a leitura e busca autorizadas pelo executor Sandbox.
- Compartilhar teto duro por run entre shards, inclusive após retry e eviction.
- Usar turnos duráveis e tracing do runtime sem reimplementar o loop do modelo.
- Remover o enriquecimento de comentário por artefatos de CI.

## Opções consideradas

### Manter o motor próprio

- Prós: controle fino de cada fase e da cadência de tools.
- Contras: mais estado, tratamento de falhas e código para manter; histórico de
  bugs e gasto não justificou esse custo.

### Construir outro harness próprio sobre Agents SDK

- Prós: interface de Agent com política customizada.
- Contras: repete justamente o loop, as sessões, o recovery e a observabilidade
  que motivaram a migração.

### Usar Think com política pequena do Holon

- Prós: Think possui o turno agentivo, tool calling, saída estruturada e
  `ThinkWorkflow.step.prompt`; Holon conserva seus limites de confiança.
- Contras: dependência das versões e semântica beta do runtime; exige prova
  remota com a rota dinâmica e o modelo real.

## Decisão

Cada shard de uma run usa um `ReviewAgent extends Think` nomeado por run e índice.
`ReviewShardWorkflow extends ThinkWorkflow` conduz um `step.prompt` com saída
estruturada. O `ReviewWorkflow` existente prepara o repositório, compila
configuração, planeja shards e publica. O ledger por PR permanece a autoridade
de causalidade, orçamento e cleanup. O Agent revalida a run antes de turns,
tools e conclusão; o host valida a resposta contra o contrato, diff canônico e
head atual antes de publicar.

O Agent expõe ao modelo somente `read_file`, `search_text` e
`search_structure`, encaminhadas ao executor read-only com Sandbox. O Think
registra internamente tools de workspace; `activeTools` as exclui do turno e
`beforeToolCall` bloqueia `write`, `edit`, `delete`, `bash` e qualquer outra
tool fora da allowlist. MCP e bash de workspace também ficam desabilitados.
Não há aprovação humana interativa para review.
O provider continua pelo AI SDK e Dynamic Route do AI Gateway. O middleware
reserva chamada, bytes de entrada e máximo de saída antes da inferência; usage
conhecido liquida a reserva. Falha incerta conserva a reserva. O ledger limita
64 chamadas, 4.000.000 bytes e 120.000 tokens de saída por run, além de 96
consultas de repositório compartilhadas. Esses números são tetos de exposição,
não previsão de custo em dinheiro.

Shards passam a admitir 16 arquivos, 768 linhas e 96 kB de patch, com três
execuções simultâneas. O planejamento ainda respeita contexto e limite de 64
shards. Aumentar tolerância reduz repetição de contexto, mas não autoriza
ignorar omissões ou ampliar automaticamente o teto de gasto.
Os resumos dos shards são agregados de forma determinística; a síntese extra
por modelo citada na ADR-0035 é retirada com o motor anterior.

Tracing fica habilitado. `AGENT_TRACE_PAYLOADS=enabled` permite capturar
mensagens e tools no Agent durante o beta; mudar para `disabled` desliga essa
captura. **Desabilitar quando o usuário solicitar.** Essa captura pode conter
trechos de código; acesso e retenção precisam ser revistos antes de produção.
O AI Gateway mantém coleta de payload desabilitada.

O webhook `workflow_run`, parser ZIP/LCOV/JUnit, armazenamento de evidência de
CI, follow-up de enriquecimento e atualização do comentário são retirados.
Tabelas históricas do ledger permanecem intactas para preservar dados. A
avaliação live do motor anterior é retirada; o corpus recorded continua e a
próxima avaliação live deverá exercitar o Agent real.

## Consequências

### Positivas

- Menos código próprio para turnos, checkpoints, recovery e cache de tools.
- Uma fronteira explícita para tools, modelo, orçamento e saída.
- Tracing de Agent e Workflow para investigação de falhas.

### Negativas

- Dois Workflows por análise de shard adicionam coordenação e custo de runtime.
- Tracing com payloads habilitado exige tratamento de acesso e desligamento.
- Build local não demonstra compatibilidade de streaming e final answer com
  `dynamic/pr-review` e o modelo escolhido.
- A avaliação live fica indisponível até ser refeita sobre o Agent.

## Critérios de confirmação

- Typecheck, testes Workerd e dry-run do Worker reconhecem bindings e contratos.
- Teste com provider simulado prova um turno `step.prompt` e bloqueio de tools
  não autorizadas; smoke remoto prova streaming, tools e saída estruturada via
  rota/modelo reais antes de ativar revisão real.
- Run obsoleta não executa novas tools nem publica resultado.
- Orçamento agregado não é renovado por retry, eviction ou concorrência.
- Webhook `workflow_run` não gera trabalho nem altera comentários.

## Gatilhos para revisitar

- Incompatibilidade entre Think, AI SDK, Gateway ou modelo escolhido.
- Evidência medida de qualidade, custo ou latência pior que os limites de produto.
- Requisito de tools externas ou escrita no repositório, que exige nova decisão
  de confiança e autorização.

Fontes oficiais verificadas em 2026-10-03:
[Think](https://developers.cloudflare.com/agents/harnesses/think/),
[Think Workflows](https://developers.cloudflare.com/agents/harnesses/think/workflows/),
[Agent tracing](https://developers.cloudflare.com/agents/runtime/operations/observability/tracing/).
