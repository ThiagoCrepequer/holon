---
id: OPERATIONS-EVALUATIONS
kind: runbook
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Execução das avaliações

Holon mantém um corpus e recordings sintéticas versionados para regressão
local/offline. A avaliação live do gerador próprio foi retirada na
[ADR-0049](../decisions/0049-use-cloudflare-think-for-pr-review.md). Ela não
representava o Agent Think e, portanto, não deve ser usada para estimar sua
qualidade ou custo. O harness manual atual inicia o Agent real com Workflow, tools e quota
de shard equivalentes ao runtime; seus limites estão descritos abaixo.

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

## Requisitos de avaliação live

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

## Métricas e corpus atuais (2026-10-08)

O runner conserva `rawGrade` e candidatos brutos antes do filtro canônico.
Evidência inventada falha integridade mesmo se sua publicação for impedida.
Precisão principal conserva candidatos brutos no denominador; `publishedPrecision`
mede somente os admitidos, sem esconder sua seleção. Recall operacional inclui
os findings esperados de casos cujo subject falhou; `completedRecall` explicita
a amostra concluída. Falha não é removida do denominador para obter um gate verde.

Calibração deduplica por PR/fingerprint, separa labels conflitantes e resolução
de thread e considera apenas aceitação/rejeição adjudicadas no denominador de
utilidade. Não interpretar ausência de feedback como verdadeiro positivo; não
converter um feedback individual em veredito de todo o PR. Candidato de corpus
extraído de feedback permanece `requiresAdjudication`.

`packages/evaluation/corpus/review-core` possui 24 casos em doze famílias causais,
com positivos/negativos e desenvolvimento/holdout separados por família. São
sintéticos e revisados por agente; exigem adjudicação independente antes de
servirem como baseline de qualidade real. `compareEvaluationSubjects` executa os
mesmos casos/configuração e conserva regressões e falhas. Os testes do harness
não demonstram benefício de especialista ou modelo distinto.

Os [benchmarks locais](../research/experiments/2026-10-08-review-core-implementation/README.md)
medem índice/cache/lanes e políticas experimentais. Revisão incremental, prefetch
adicional e quotas ponderadas de modelo não foram ativados sem seus gates.
Nenhum comando de avaliação live do motor retirado foi restaurado.

## Harness Think real e orçamento de campanha (2026-10-09)

`apps/control-plane/evaluation/live-benchmark.mts` é manual, fora de `pnpm test`
e `pnpm verify`. Seus testes financeiros de filesystem (`test:benchmark-host`)
e políticas puras fazem parte dos comandos locais, sem consumir inferência. Exige autorização de consumo, Docker local, imagem do executor,
credencial em arquivo local e IDs públicos do account/Gateway. Não imprima nem
use `source` no arquivo de credenciais. O CLI lê somente os campos necessários
com `parseEnv`; o token permanece no relay Node, fora do Workerd e dos artefatos.

Configure `HOLON_BENCH_CREDENTIAL_FILE`, `AI_GATEWAY_ACCOUNT_ID` e
`AI_GATEWAY_ID` no ambiente, usando uma configuração autorizada. Em seguida:

```bash
pnpm --filter @holon/control-plane benchmark:live --quality-check --structural-context
```

O perfil executa quatro casos com teto de 24 requests, 600 kB de entrada,
50.000 tokens reservados de saída, 45 s por request e seis minutos de suíte.
`--holdout` seleciona as famílias independentes iniciais; `--confirmation`
seleciona as famílias de confirmação, hoje já expostas. As duas flags são
exclusivas e exigem `--quality-check`. `--code-regression` é uma terceira partição
exclusiva, exige também `--structural-context` e executa o par novo de export com
alias: teto de 14 requests, 250 kB de entrada, 30.000 tokens reservados de saída,
45 s por request e quatro minutos de suíte. `--probe` restringe ao primeiro positivo,
sem constituir gate de qualidade. `--temperature-zero` e `--thinking` são
experimentos manuais desse perfil; os resultados não autorizam sua ativação.
Sem `--quality-check`, a ablação pré-declarada mede `repeated`, `receipts`,
`full` e `selective` com os tetos gravados no plano. Prefetch não integra o runtime.

Antes das chamadas, todos os casos passam compilação TypeScript estrita em
base/head e oracle executável, sem instalar dependências no fixture. Um erro
estático ou label divergente interrompe a preparação. O grader atual conserva
motivos de reprovação por completude, integridade, localização, severidade,
confiança e rubrica lexical da família. Essa rubrica não prova equivalência
semântica; ganhos de precisão precisam de inspeção independente. Mudanças de
fixtures/graders exigem novos resultados, preservando o histórico. Consulte a
[continuação de código](../research/2026-10-09-review-core-code-follow-up.md).

O teto acumulado é US$ 0,50, incluindo rodadas anteriores. O CLI confere
deployment/modelo/preços de endpoints, reserva custos antes de chamar e usa lock
e checkpoint atômico em `artifacts/evaluation/live-spend.json`. Não apague esse
ledger para repetir testes. Ausência local recupera o snapshot versionado em
`docs/research/experiments/2026-10-08-live-review/campaign-spend.json`. Custo
desconhecido mantém reserva integral; margem/duas tentativas não garantem fatura
interna do provider. Falha HTTP abre o circuito e impede novos requests pagos
na mesma invocação. Um lock órfão após interrupção forçada requer conferir que
nenhum processo está ativo antes de removê-lo; não remova locks de outro processo.

O exit code `0` exige todos os pares esperados únicos aprovados; `2` conserva
falha/incompletude de qualidade. Retomada exige perfil, caps, temperatura,
partição, rota, fontes e imagem idênticos e conserva casos falhos e gasto.
As respostas finais capturadas são exclusivamente dessas fixtures sintéticas.
Não registre prompts, raciocínio, headers, tokens nem arquivos privados.
`cf-aig-collect-log-payload:false`, bypass de cache e trace desligado acompanham
as chamadas. O CLI remove somente seu diretório temporário, sem alterar Gateway,
secrets ou GitHub. O [relatório](../research/2026-10-08-review-core-live-benchmark.md)
conserva as tentativas e distingue schema válido, integridade e verdade causal.
