---
id: ADR-0031
kind: decision
status: accepted
owners: [core-team]
last-reviewed: 2026-09-05
---

# Identificação de versões como comportamento padrão

## Contexto

O rollout inicial da ADR-0030 condicionava a identificação a uma flag desligada por padrão. Isso permitia concluir reviews novas sem registrar versões, apesar de a funcionalidade integrar o workflow esperado pelo produto.

## Decisão

Por orientação explícita do produto, a identificação integra o workflow padrão sem `PROJECT_IDENTIFICATION_ENABLED`. Esta decisão substitui apenas a exigência de ativação inicial da [ADR-0030](0030-identify-project-versions-from-snapshot-evidence.md).

`PROJECT_IDENTIFICATION_MODE=observe` continua registrando versões sem enriquecer o prompt; `enrich` controla exclusivamente esse enriquecimento. Limites, evidências, cache, revogação e tratamento de indisponibilidade permanecem vigentes.

## Consequências

Novas execuções tentam identificar os projetos automaticamente, com os orçamentos de chamadas existentes. Configurações antigas da flag não controlam mais o serviço. Runs históricas não recebem backfill. A alteração requer novo deploy do control-plane; não altera remotamente uma versão já publicada.
