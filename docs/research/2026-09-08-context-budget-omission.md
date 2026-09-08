---
id: RESEARCH-CONTEXT-BUDGET-OMISSION
kind: research
status: current
verified-on: 2026-09-08
owners: [core-team]
---

# Omissão de contexto antes do planejamento

## Fatos observados

O diff original do PR #69 na revisão `0b595d3` contém 47 arquivos, 2.580
coordenadas alteradas e 167.335 bytes de patches. A reprodução local do executor
anterior reteve 29 arquivos, 1.946 coordenadas e 119.633 bytes; omitiu 18 arquivos,
incluindo mudanças no ciclo de vida/fingerprints e no gerador de review.
O Workflow remoto inspecionado foi criado antes do código desse PR e ainda usava
um passo agregado de análise. Terminou com revisão parcial e degradada, 12 tools,
218.195 tokens de entrada e 5.162 de saída.

A reprodução após a correção reteve 47 arquivos, 2.580 coordenadas e 167.335 bytes,
com `truncated=false`. O contexto serializado dessa reprodução local, sem inventário
adicional do repositório, ficou em 419.090 bytes. Não se trata de um novo resultado
remoto nem de comprovação da qualidade dos findings.

## Limites e inferência

O histórico remoto disponível confirma o estado, a versão do fluxo e os contadores.
Os logs detalhados de Workers não estavam acessíveis (403) e a consulta de logs do
AI Gateway falhou (500). Assim, não foi possível reconstruir cada chamada, latência,
resposta de tool ou raciocínio do modelo. Isso limita a atribuição das demais
causas da revisão, mas não invalida a omissão determinística reproduzida no executor.
Nenhum prompt, diff privado, token ou credencial é registrado neste documento.

## Correção e validação

A [ADR-0035](../decisions/0035-plan-complete-context-before-sharding.md) move a seleção
para o planner, versiona o contexto como V4 e impede narrativa conclusiva quando a
revisão é incompleta. Regressões exercitam limites de bytes UTF-8, omissões inteiras,
contratos e publicação. A validação permanece local; nenhuma nova implantação foi
realizada como parte dessa correção.
