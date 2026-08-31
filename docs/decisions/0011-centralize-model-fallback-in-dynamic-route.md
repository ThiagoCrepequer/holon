---
id: ADR-0011
kind: decision
status: superseded
date: 2026-08-30
owners:
  - core-team
supersedes:
  - 0010-use-dynamic-route-for-pr-review.md
related:
  - ../architecture/review-runtime-flow.md
  - ../research/2026-08-30-model-output-and-retry-incident.md
superseded-by:
  - 0012-use-canonical-diff-and-bounded-semantic-recovery.md
---

# Centralizar fallback de modelo na Dynamic Route

## Contexto e problema

O AI SDK já executava com `maxRetries: 0`, mas o step durável
`analyze-review` permitia duas repetições. Essa configuração parecia preservar
recuperação para falhas transitórias sem multiplicar retries entre camadas.

Uma execução real invalidou essa premissa. O modelo selecionado pela Dynamic
Route respondeu HTTP 200, consumiu todo o limite de output e não produziu o
objeto estruturado. O Workflow executou a sessão agentiva completa três vezes,
incluindo o mesmo contexto de 37.695 tokens. A classificação local gerou
`NonRetryableError`, mas o runtime persistiu um erro comum e aplicou o limite do
step.

O fallback da Dynamic Route é aplicado a cada requisição do loop agentivo. Já o
retry do step reinicia o loop completo, repete contexto, ferramentas e output,
e pode operar sobre um Sandbox que precisou ser reconstruído.

## Direcionadores

- Evitar que uma resposta inválida ou uma indisponibilidade do modelo reinicie
  toda a sessão agentiva.
- Manter fallback de provider/modelo configurável sem deploy do Worker.
- Preservar checkpoints, terminalização e cleanup duráveis.
- Não registrar prompt, diff, resposta ou mensagem arbitrária do provider.
- Tornar o limite de custo independente da serialização especial de erros do
  runtime.

## Opções consideradas

### Manter retries no Workflow e confiar em `NonRetryableError`

- Prós: uma falha transitória após esgotar todos os modelos poderia iniciar
  outra sessão automaticamente.
- Contras: a produção demonstrou três execuções para uma falha determinística;
  uma repetição reinicia todo o contexto agentivo e amplia custo e latência.

### Aplicar um retry condicional fora de `step.do`

- Prós: permitiria decidir após inspecionar a categoria do erro.
- Contras: ainda repetiria a sessão inteira e duplicaria a responsabilidade da
  Dynamic Route.

### Fazer uma execução do step e delegar fallback ao Gateway

- Prós: uma única camada de fallback por requisição, custo máximo previsível e
  nenhuma repetição do histórico de tools.
- Contras: se todos os modelos da rota falharem, a run termina e depende de um
  novo evento ou mecanismo explícito de replay.

## Decisão

`analyze-review` usa `retries.limit: 0`. O AI SDK mantém `maxRetries: 0`. A
Dynamic Route `dynamic/pr-review` é a única proprietária de fallback entre
providers e modelos para cada requisição feita durante a sessão agentiva.

Uma resposta permanente ou estruturalmente inválida ainda é convertida em
`NonRetryableError`, sem alterar o `name` padrão esperado pelo runtime. A
mensagem contém somente um código seguro:

- `provider_permanent`;
- `output_missing`;
- `object_invalid`;
- `schema_invalid`;
- `tool_budget_exhausted`.

Falhas transitórias do provider preservam sua classificação, mas não reiniciam
o step. Toda falha passa pela terminalização do ledger e pelo cleanup durável do
repositório antes de encerrar a instância.

Retries continuam permitidos em steps pequenos e idempotentes, como estado,
preparação do repositório e publicação. Esta decisão se aplica somente à sessão
agentiva, cujo replay tem custo alto e inclui múltiplos serviços.

## Consequências

### Positivas

- Uma run executa no máximo uma sessão `generateText`, embora essa sessão possa
  fazer várias inferências legítimas para tool use.
- A ordem de fallback pode ser alterada na Dynamic Route sem novo deploy.
- Uma falha terminal não depende de `instanceof` para respeitar o teto de
  tentativas.
- Logs do Workflow distinguem categorias seguras sem persistir conteúdo.
- O Sandbox é destruído logo após terminalização, sem aguardar backoffs do
  modelo.

### Negativas

- Falha total da rota não recebe uma segunda sessão automática.
- A qualidade do fallback depende da compatibilidade real dos modelos com tools
  e JSON Schema, não apenas de metadados declarados pelo provider.
- A definição remota da rota ainda pode divergir da documentação até o próximo
  smoke ou reconciliação operacional.

## Critérios de confirmação

- Testes provam uma tentativa de `analyze-review` para 401, 403, 404, 500,
  output ausente, objeto inválido, schema inválido e budget esgotado.
- O erro determinístico mantém `name: NonRetryableError` e somente um código
  seguro na mensagem.
- Uma execução real com falha registra apenas uma sessão completa no Workflow.
- Terminalização e cleanup continuam concluindo mesmo quando a análise falha.
- Um modelo compatível conclui tools, resposta JSON Schema e publicação sem
  retries no Worker.

## Gatilhos para revisitar

- A Cloudflare oferecer validação semântica de JSON Schema antes de decidir o
  fallback da Dynamic Route.
- O AI SDK permitir retomar com segurança uma sessão agentiva parcialmente
  concluída.
- Uma política de replay manual ou agendado for adicionada com budget próprio.

## Evidência

Verificada em 2026-08-30:

- [Workflows: sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [AI Gateway fallbacks](https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/)
- [Dynamic Route JSON configuration](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/json-configuration/)
