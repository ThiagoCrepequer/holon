---
id: OPERATIONS-EVALUATIONS
kind: runbook
status: current
owners:
  - core-team
last-reviewed: 2026-10-03
---

# Execução das avaliações

Holon mantém um corpus e recordings sintéticas versionados para regressão
local/offline. A avaliação live do gerador próprio foi retirada na
[ADR-0049](../decisions/0049-use-cloudflare-think-for-pr-review.md). Ela não
representava o Agent Think e, portanto, não deve ser usada para estimar sua
qualidade ou custo. Uma avaliação live futura deve iniciar o Agent real, com
Workflow, tools e orçamento equivalentes ao runtime de PR.

## Avaliação offline

Os testes do pacote `@holon/evaluation` fazem parte do gate geral `pnpm verify`
no CI. A execução do corpus V3 contra recordings sintéticas é manual:

```bash
pnpm --filter @holon/evaluation evaluate:recorded
```

O comando grava `artifacts/evaluation/recorded-output.json` localmente, sem
secrets ou chamada a provider externo. O relatório contém configuração, IDs,
métricas e categorias de falha, sem patches ou respostas integrais. Um resultado
verde prova apenas a estabilidade do corpus e dos graders registrados. Não
prova a qualidade do modelo escolhido, execução de tools, Sandbox, GitHub App
ou publicação remota. Consulte
[teste e evidência](../engineering/testing-and-evidence.md) para separar os
níveis de prova.

## Próxima avaliação live

A próxima suíte deve usar casos com repositório isolado, head/base fixos e
provider/modelo explícitos. Deve registrar cobertura de shards, saída
estruturada, evidência aceita/rejeitada, falhas, duração e reservas do ledger,
sem expor prompts, diffs ou segredos no relatório. A rota `dynamic/pr-review`
precisa de smoke com tool calling e final answer do Think antes de ser tratada
como compatível. A decisão de modelo e o custo real serão avaliados depois do
funcionamento correto do Agent.
