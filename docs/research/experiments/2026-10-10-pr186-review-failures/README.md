# Evidências da auditoria do PR #186

Data: 2026-10-10. Resultado interpretado no
[relatório](../../2026-10-10-pr186-review-failures.md).

`summary.json` é uma projeção sanitizada das consultas de leitura. Preserva
identidade, horários UTC, estados, versões, contagens, códigos catalogados,
paths de validação e classificação individual de 82 registros. Não contém
prompts, respostas integrais, argumentos de tools, diffs, credenciais ou
mensagens arbitrárias de exceção. Os dados inválidos citados no relatório são
descritos pelo formato e pelas violações do contrato.

## Fontes e coleta

- GitHub: 21 commits do PR, Check Runs Holon de cada commit, reviews e finding
  público indicado no relatório; leitura dos arquivos no head exato do finding.
- Workers Observability: janela `2026-10-09T21:50:00Z` a
  `2026-10-10T16:15:00Z`, serviços cujo nome começa com `holon-`.
- Workflows: sete instâncias de `holon-review-workflow` e 167 de
  `holon-review-shard-workflow`; estados da listagem e detalhes das instâncias.
- AI Gateway `holon`: listagem filtrada pelos metadados do PR, com 50 registros
  por página; quatro páginas e 181 requisições. O registro de sucesso HTTP
  permanece separado da conclusão do Workflow e da validade do stream.
- Workers Versions: metadados dos três artefatos identificados nos logs. O tag
  de commit não comprova identidade byte a byte do bundle.

A coleta ampla consultou eventos/invocações em janelas de uma hora, com limite
de 2.000 por página e paginação pelo último `$metadata.id`. Foram preservados
11.452 registros únicos para correlação. Consultas específicas por run
capturaram eventos de plano, diagnóstico e conclusão.

O inventário final de erros/avisos usou 37 janelas de até 30 minutos. O filtro
combinou `$metadata.level` em `error,warn` **ou** `severity` em `error,warning`:
eventos estruturados do Holon nem sempre têm o primeiro campo. Todos os
resultados dessas consultas tiveram `statistics.abr_level=1`. A consulta ampla
inicial com `abr_level=10` não integra a contagem final. O registro inclui dois
spans associados ao erro NextBit e um span cuja atribuição permanece incerta.

Os estados e a paginação foram conferidos separadamente: 163 filhos completos,
três com erro e um terminado. Três leituras de detalhes retornaram código API
`10001` em HTTP 200, mesmo após três tentativas; seus estados completos foram
obtidos da listagem. `detailReadLimitations` identifica essas instâncias.

## Identidade e replay

O ID do Workflow pai é `review-` seguido do SHA-256 do `runId`. Para o filho,
o hash usa `runId:shardIndex:phase`; `shardIndex` começa em zero. As partes
exibidas no relatório começam em um. A associação dos 167 filhos foi conferida
com essa regra.

Os dois resultados rejeitados por schema foram lidos pelo endpoint de step
`waitForEvent`, inspecionados em memória e revalidados localmente com o grafo
de contratos do commit anotado no deploy `b7dd6b4`. Apenas paths/códigos,
estados e contagens foram exportados. A leitura da avaliação causal do falso
positivo também preserva apenas resultado, confiança, base e número de recibos.

APIs usadas, verificadas em 2026-10-10:
[telemetria](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/),
[instâncias](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/list/),
[step](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/step/) e
[Gateway logs](https://developers.cloudflare.com/api/resources/ai_gateway/subresources/logs/methods/list/).

## Limites e verificação

Os 82 registros são mensagens, eventos e spans; não uma contagem de incidentes
independentes. As categorias descrevem a evidência de cada registro e não
atribuem ao modelo falhas de integração ou cobertura. Correlações por trace,
run e Workflow aparecem explicitamente; retries sem vínculo completo de actor
têm essa limitação registrada.

Conferências locais: IDs únicos, sete pais/checks, estados dos 167 filhos,
37 consultas sem amostragem de query, 181 requisições HTTP 200, classificação
dos 82 registros e soma de 51 erros/31 avisos. Também foram verificados os links
locais, JSON e formatação. Não houve nova inferência nem alteração em produção.
Retenção e amostragem na ingestão continuam limitando a completude histórica.
