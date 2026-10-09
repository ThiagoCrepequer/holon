---
id: RESEARCH-REVIEW-CONTEXT-COVERAGE
kind: research
status: snapshot
date: 2026-10-09
owners: [core-team]
---

# Cobertura após o PR #184

Os ajustes corrigem perdas de inventário, classificação de cobertura e janelas
redundantes. O par sintético real terminou 2/2 com Gemma após fornecer a política
de severidade que faltava nas instruções/schema. Isso fecha as regressões locais
descritas aqui; não fecha o gate geral de precisão nem demonstra nova execução
publicada do PR #184. As famílias usadas para ajustes são desenvolvimento.

## Incidente e causas

O check do [PR #184](https://github.com/ThiagoCrepequer/holon/pull/184) foi parcial:
dez partes concluídas, nenhuma falha terminal, todas degradadas; zero achados
publicados. Os logs Cloudflare consultados na investigação anterior mostraram
20 checks de contrato e 351 sinais estruturais omitidos. Todas as chamadas ao
Gateway retornaram HTTP 200; esse resultado não foi um erro HTTP do modelo.

O produtor retinha apenas 100 símbolos e o tracer 50 referências. A projeção
iniciava sua contagem de perdas pela soma global, propagada para cada parte,
mesmo quando o pequeno contexto daquela parte cabia integralmente no prompt.
O plano não distinguia perda global de projeção local. O planner exigia a linha
da declaração em um hunk mesmo quando a AST reconhecia mudança no corpo. Também
criava partes repetidas por referência, sem compartilhar a mesma janela.

Não foi comprovado o SHA de código do bundle implantado; a investigação comparou
os fontes locais pertinentes com a base do PR e correlacionou logs/run/head.
Não incluímos payloads privados nem credenciais no arquivo desta avaliação.

## Correções e provas sintéticas

A [ADR-0060](../decisions/0060-separate-review-inventory-and-pack-contract-windows.md)
registra as alterações de política, preservando tetos financeiros e de leitura.

- Produtor e schema compartilham limites de 1.000 símbolos/referências e 500
  pistas de contrato/superfícies de segurança. Overflow continua contabilizado.
- `structural_inventory` mantém o plano parcial quando a varredura ou inventário
  são incompletos. Projeção contabiliza somente suas perdas locais. Seu teto de
  24.000 bytes não remove preflight nem limites agregados de geração.
- `patchLine` conserva a coordenada canônica da mudança no corpo. A declaração
  mantém sua linha original; imports intactos não viram evidência publicável.
- Patches completos colocalizados dispensam checks redundantes. Janelas idênticas
  são compartilhadas sob limites de bytes, linhas, arquivos e evidências; até oito
  partes adicionais. Janelas diferentes do mesmo arquivo não são concatenadas.
- Diagnósticos distinguem capacidade, janela ausente e limite de evidências;
  rejeições distinguem admissão causal de publicação. Normalização sem contador
  original declara essa limitação, sem inventar contagens ou registrar conteúdo.
- A mesma política de severidade do produto é fornecida no prompt e no schema.
  Confiança não aumenta severidade; uma exceção isolada não prova indisponibilidade
  generalizada. O grader não foi relaxado para aceitar `critical` neste caso.

As regressões foram escritas antes das correções e falharam pelo comportamento
esperado. Cobrem 348 símbolos/153 referências, overflow com 1.001 símbolos,
declaração fora do hunk, import intacto, nove consumidores em uma janela,
janela indisponível, cobertura global/local e o gate de agregação. A prova de
agregação usa saída limpa controlada e testa completude do host, não recall.
Testes de diagnóstico conferem estágio, razão e ausência de texto privado.

## Replay local do PR

Base `7ead18c84e4fb958b28c9df5f1d157b7912dfde4`,
head `c69b12aa01f5329de97b32998f66d8def7e1bde2`.
O replay lê somente 73 módulos alterados (618.623 bytes), com teto de 64.000
bytes/arquivo. Não reproduz o inventário completo coletado em produção; por isso
declara `repositoryScanTruncated:true` e mantém o plano parcial globalmente.

| Métrica                                | Antes do ajuste local |         Depois |
| -------------------------------------- | --------------------: | -------------: |
| Símbolos retidos                       |               100/348 |        348/348 |
| Referências retidas                    |                 50/89 |          89/89 |
| Omissões de checks de contrato         |                    16 |              0 |
| Partes                                 |                    10 |             12 |
| Omissões na projeção local após ajuste |                     — | 0 em 12 partes |

A maior projeção nova tem 22.242 bytes, sob 24.000. A única omissão global nova
nesse replay é a varredura explicitamente parcial. Os 16 checks da reprodução
local não equivalem aos 20 dos logs: o escopo dos inventários é diferente.
O [arquivo de evidências](experiments/2026-10-09-review-context-coverage/README.md)
preserva o resumo novo e o script de replay, com esses limites explícitos.

## Gateway real com orçamento limitado

`--quality-check --structural-context --coverage-regression` usa Think/ReviewAgent,
executor Sandbox local, planejamento/projeção reais, recibos e verificação causal.
O harness conserva o envelope predeclarado de nove partes para pressionar a
alocação compartilhada, executando somente a parte zero de cada caso; o plano
de cobertura desta fixture contém uma parte. Não é uma execução completa do
workflow coordenador/GitHub nem uma medição do perfil de produção de uma parte.
O Gateway `holon`, rota `dynamic/pr-review`, deployment
`e335278a-96b4-4a32-87d5-219ca80dd052`, respondeu com
`google/gemma-4-26b-a4b-it`. Preços/rota foram conferidos por leitura em 2026-10-09.
Cache bypass, trace desligado e `cf-aig-collect-log-payload:false` em todas as
chamadas. Nenhuma configuração remota ou secret foi alterada.

O produtor tem 131 símbolos; o corpo muda na linha 37, fora da declaração.
O consumidor usa o alias exportado fora de seu hunk. Base/head compilam em modo
estrito, o patch produz o HEAD exato e o oracle executável demonstra TypeError
somente no positivo; o negativo possui guarda para `null`.

| Rodada                                        | Requests | Casos aprovados | Resultado                                                                                             |
| --------------------------------------------- | -------: | --------------: | ----------------------------------------------------------------------------------------------------- |
| Inicialização                                 |        0 |    0 executados | Binding de dashboard ausente no harness; corrigido com stub que rejeita uso inesperado                |
| Primeiro par, teto 250 kB                     |        5 |             0/2 | Positivo com severidade exagerada; negativo com evidência rejeitada e recuperação bloqueada pelo teto |
| Repetição, teto 600 kB                        |        7 |             1/2 | Negativo limpo; positivo causal correto, ainda `critical`                                             |
| Política de severidade explícita, teto 600 kB |        7 |             2/2 | Positivo `high` confirmado com dois recibos; negativo sem achado, sem degradação                      |

Todas as rodadas pagas retiveram 131 símbolos, uma parte completa e nenhum
truncamento local. A última consumiu quatro gerações no positivo e três no
negativo, dois `read_file` por caso; durações de 24,231 s e 11,410 s. São tempos
observados, não comparação causal de velocidade: há variação do provider.

Os 19 requests novos somam 256.822 tokens de entrada, 2.801 de saída e
US$ 0,013466190 informados pelo provider. A campanha inteira conserva 272
requests, US$ 0,075948501 informados e exposição conservadora de
US$ 0,196858445, sob o teto acumulado de US$ 0,50. Reservas sem custo conhecido
permanecem integrais; o valor informado não é fatura dos attempts internos.
Nenhuma falha foi apagada e o seed novo preserva todas as reservas anteriores.

## Verificação e limites restantes

`pnpm verify` passou em Node 24.19.0/pnpm 11.24.0: marca/configuração, formatação,
lint, tipos, direção dos imports, integridade/contabilidade das evidências,
cobertura, provas de browser e builds/dry-runs. A identidade de configuração foi
regenerada porque o lockfile passou a declarar `test-kit` como dependência de
testes do control-plane. As três expectativas antigas de diagnóstico/cobertura
foram atualizadas para exigir o novo estágio e manter scan parcial visível; nenhuma
verificação de motivo, contagem, veredito ou threshold foi enfraquecida.

O recorte focado passou 67 testes. No gate completo, o control-plane passou 402,
o executor 130, a análise estrutural 226, contracts 177, application 158 e model 51. O control-plane atingiu 93,55% de linhas/86,90% de branches; análise estrutural
97,04%/90,92%; model 98,12%/93,37%. O
[resumo local](experiments/2026-10-09-review-context-coverage/local-verification.json)
registra comandos, métricas, arquivos alterados e hashes dos fontes finais.

Antes da abertura do PR, a correção `99cf7caf0ab1ffb3782bdfca525439c0139b2e4d`
foi integrada à `main` em `929ed5b8eaed671f7c6d5da3e8cdb1a117ba5ce0`.
A identidade do compilador foi regenerada a partir dos inputs e lockfile
combinados. `pnpm verify` passou novamente em Node 24.19.0/pnpm 11.24.0,
incluindo os novos testes de projeção/leitura do dashboard e os dry-runs.
O control-plane passou 414 testes, com 93,57% de linhas/87,02% de branches.
O resumo local anterior e os snapshots pagos permanecem intactos: registram
a versão anterior à integração. Nenhuma chamada paga adicional foi executada
para abrir o PR; essa nova validação comprova a integração local.

Os arquivos produtivos alterados pertencem a `packages/contracts` (limites,
omissões, severidade e identidade gerada), `packages/repository-analysis`
(inventário, coordenadas, planejamento e janelas), `packages/model` (projeção e
instruções), `packages/application`/`packages/domain` (agregação e mensagens) e
`apps/control-plane/src/review` (diagnósticos e composição). Os demais são testes,
harness, manifests e documentação. Não foi criada dependência externa nova.

Não houve deploy nem rerun remoto do PR #184. O benchmark valida um par pequeno,
sintético e ajustado; não estima precisão/recall geral, custo de PR grande,
qualidade com outro modelo ou estabilidade entre muitas repetições. O falso
positivo da confirmação histórica permanece evidência adversa do gate geral;
esta família nova não o substitui. Janela ausente ou inventário maior que os
tetos continuam produzindo revisão parcial, de forma explícita.
