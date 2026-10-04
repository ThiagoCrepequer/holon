---
id: OPERATIONS-EVALUATIONS
kind: runbook
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Execução das avaliações

Holon mantém um corpus e recordings sintéticas versionados para regressão
local/offline. A avaliação live do gerador próprio foi retirada na
[ADR-0049](../decisions/0049-use-cloudflare-think-for-pr-review.md). Ela não
representava o Agent Think e, portanto, não deve ser usada para estimar sua
qualidade ou custo. Uma avaliação live futura deve iniciar o Agent real, com
Workflow, tools e orçamento equivalentes ao runtime de PR.

A [ADR-0050](../decisions/0050-verify-finding-causality-before-publication.md)
acrescenta verificação em conversa isolada. Os testes locais com provider
simulado comprovam o protocolo, inclusive a leitura de uma guarda e a retenção
do candidato refutado. Não medem a qualidade das inferências reais.

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

## Evidência local da verificação causal (2026-10-04)

`pnpm verify` passou com Node.js 24.19.0 e pnpm 11.24.0: schema/configuração,
formatação, lint, tipos, testes com os limites de cobertura existentes e build
em dry-run dos dois Workers, incluindo a imagem Docker do executor. O módulo
puro de decisão causal teve 100% de linhas e branches cobertos. Os testes do
control plane passaram (253 casos), incluindo as duas conversas Think,
leitura simulada do chamador, refutação, saldo compartilhado, cancelamento e
deadline. O Sandbox e o provider remoto não foram usados nesse teste causal.

O Workerd emitiu mensagens de cancelamento por detecção de request pendurado
nos testes Think; os casos e o gate terminaram com sucesso. Essa ressalva
permanece na evidência local. Não houve deploy, publicação no GitHub ou smoke
com modelo real; precisão, recall, custo e latência reais continuam não medidos.

## Próxima avaliação live

A próxima suíte deve usar casos com repositório isolado, head/base fixos e
provider/modelo explícitos. Deve registrar cobertura de shards, saída
estruturada, evidência aceita/rejeitada, falhas, duração e reservas do ledger,
sem expor prompts, diffs ou segredos no relatório. A rota `dynamic/pr-review`
precisa de smoke com tool calling e final answer do Think antes de ser tratada
como compatível. A decisão de modelo e o custo real serão avaliados depois do
funcionamento correto do Agent.

A avaliação deve exercitar investigação e verificação no mesmo saldo, usando
pares positivos/negativos com guardas, validações, chamadores fora do diff e
contexto insuficiente. Deve distinguir candidatos confirmados, refutados e
inconclusivos e medir falsos positivos removidos, regressões indevidamente
retidas, precisão/recall final, parcialidade, custo e latência adicionais.
