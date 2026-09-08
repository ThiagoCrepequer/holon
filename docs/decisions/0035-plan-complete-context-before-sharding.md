---
id: ADR-0035
kind: decision
status: accepted
date: 2026-09-08
owners: [core-team]
supersedes:
  - 0013-use-tiered-structural-and-textual-review.md
  - 0016-require-complete-patches-and-host-verifiable-evidence.md
  - 0032-require-current-rpc-contracts.md
---

# Planejar o contexto completo antes de aplicar limites de shards

## Contexto

O executor limitava os patches agregados a 120.000 bytes antes do planejamento.
Isso descartava arquivos que caberiam no orçamento dos cinco shards. Na revisão
investigada, 18 de 47 arquivos foram omitidos antes de chegar ao modelo.
Uma narrativa do modelo podia ainda descrever a revisão parcial como conclusiva.

## Decisão

O planner recebe todos os patches canônicos elegíveis antes da seleção. A política
preserva uma oportunidade inicial para cada modo e a preferência estrutural 3:1,
com ordenação determinística por diretório/path dentro dos modos. Seleciona até
50 arquivos em no máximo cinco shards, cada um com até 60.000 bytes de patches
UTF-8 e 20 arquivos. O alvo de 1.500 linhas por shard não divide um patch;
o limite de coordenadas continua sendo 5.000. Patches maiores que 60.000 bytes
são omitidos inteiros e marcam cobertura parcial. Permanecem as exclusões,
o checkout exact-SHA, os patches completos e a verificação de evidência no host
das ADRs 0013 e 0016; somente o orçamento agregado e o ponto de seleção mudam.

O contexto persistido passa a `ReviewContextV4`, com teto agregado de 300.000 bytes
de patches, 60.000 por arquivo e 500.000 bytes de JSON serializado. O limite de
5.000 coordenadas por contexto permanece. Limites residuais de serialização ou
coordenadas são explícitos em `truncated`. O control-plane mantém essa informação
como cobertura parcial, inclusive quando nenhum patch couber.

A preparação permanece `prepareRepositoryV3`, com request e resposta V3 inalterados.
A leitura passa exclusivamente a `loadContextV4`. O contrato histórico V3 conserva
seu limite de 120.000 bytes; não existe fallback RPC para ele. Contextos por shard
enviados ao modelo permanecem V2. Preservam-se todas as demais regras da ADR-0032,
inclusive atualização coordenada, detalhe admin V2 e ausência de downgrade.

Para cobertura parcial, shard degradado ou findings anteriores sem revalidação,
a narrativa publicada é determinística: informa incompletude e quantidade de
findings verificados, sem conclusões sobre mudanças omitidas. Findings, evidências,
limitações e ciclo de vida continuam publicados. A síntese adicional por modelo
é reservada à revisão completa e sem degradação ou revalidação pendente.

## Alternativas rejeitadas e consequências

Apenas aumentar o antigo teto manteria duas políticas de seleção independentes.
Remover todos os limites elevaria custo e risco de payloads excessivos. Cortar hunks
violaria a evidência canônica. Manter uma narrativa conclusiva com um rodapé de
limitações continuaria contraditório. A solução amplia o contexto total possível,
mas preserva os limites por shard e pode aumentar o custo em PRs antes omitidos.
O contrato novo exige deploy coordenado de executor/control-plane e novas runs;
artefatos V3 não são retomados automaticamente como V4.

## Confirmação

Testes cobrem patches completos acima de 120.000 bytes agregados, limites UTF-8,
50 arquivos, cinco shards, patch individual excessivo, contexto vazio por orçamento,
e supressão de narrativas conclusivas em revisões incompletas. A reprodução local
do diff original reteve 47/47 arquivos; isso não comprova qualidade de uma nova
revisão remota. Ver [evidência datada](../research/2026-09-08-context-budget-omission.md).
