---
id: OPERATIONS-EVALUATIONS
kind: runbook
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
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
no CI. A execução do corpus V4 contra recordings sintéticas é manual:

```bash
pnpm --filter @holon/evaluation evaluate:recorded
```

O comando grava `artifacts/evaluation/recorded-output.json` localmente, sem
secrets ou chamada a provider externo. O relatório contém configuração, IDs,
métricas e categorias de falha, sem patches ou respostas integrais. Um resultado
verde prova apenas a estabilidade do corpus e dos graders registrados. Não
prova a qualidade do modelo escolhido, execução de tools, Sandbox, GitHub App
ou publicação remota. A V4 acrescenta controles negativos para campo requerido
com string vazia e reexport de tipo, motivados pelo PR #121. Eles permitem medir
uma futura avaliação live; as recordings não demonstram que o Agent real
evitará os dois falsos positivos. Consulte
[teste e evidência](../engineering/testing-and-evidence.md) para separar os
níveis de prova.

## Evidência local da verificação causal (2026-10-04)

`pnpm verify` passou com Node.js 24.19.0 e pnpm 11.24.0: schema/configuração,
formatação, lint, tipos, testes com os limites de cobertura existentes e build
em dry-run dos dois Workers, incluindo a imagem Docker do executor. O módulo
puro de decisão causal teve 100% de linhas e branches cobertos. Os testes do
control plane passaram (259 casos após integrar `main`), incluindo as duas conversas Think,
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

## Qualificação da política para PRs grandes — 2026-10-08

A ADR-0055 aumenta limites máximos; isso não comprova aumento de qualidade.
A qualificação deve fixar base/head e usar o Agent/Workflow reais, incluindo
verificação causal, tools e ledger. O conjunto precisa conter:

- PR #177 antes das correções (`cc7889f` contra `b360283`), com os oito defeitos
  confirmados na revisão humana como expected findings, e a versão corrigida
  (`515f6e4`) como controle negativo para esses defeitos.
- PR #171 e PRs de 25–64 partes, com relações produtor/consumidor separadas,
  mudanças sem defeito e casos de contrato reexportado que não justificam finding.
- Falhas de protocolo, saída/entrada truncadas, retry/eviction e gasto incerto.

Relatar partes e linhas elegíveis, investigadas, omitidas e falhas; verificações
de contrato adicionadas/omitidas; recall dos defeitos conhecidos, falsos positivos,
finalização estruturada, chamadas, bytes cumulativos, tokens e duração por ondas.
Comparar os perfis no mesmo SHA e rota, distinguindo admissão de qualidade do
modelo. Não tratar passagem de gravações sintéticas como detecção dos oito bugs.

Os testes locais desta alteração exercitam a política e o ciclo simulado de
19, 24, 50 e 64 partes. A comparação live e suas métricas de qualidade/custo
permanecem pendentes de uma execução remota autorizada; não houve replay de
PR, deploy, alteração de rota nem chamada paga ao modelo nesta entrega.

Em 2026-10-08, a medição offline de `buildReviewPlan` sobre o diff Git contra
`b360283`, sem inventário estrutural externo nem inferência, produziu:

| Head do PR #177 | Partes | Arquivos elegíveis | Linhas elegíveis | Bytes de patch | Perfil por quantidade |
| --------------- | ------ | ------------------ | ---------------- | -------------- | --------------------- |
| `cc7889f`       | 17     | 68                 | 8.807            | 370.654        | `large`               |
| `515f6e4`       | 19     | 71                 | 9.776            | 414.193        | `large`               |

Ambos os planos conservaram todas as partes elegíveis, sem omissão de orçamento.
O número de partes pode mudar quando o executor acrescenta pistas estruturais e
verificações de contrato. O perfil real também depende do prompt compilado.
Esta medição confirma admissão; não investigou código nem mediu recall, custo
ou confiabilidade do modelo.
