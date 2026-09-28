---
id: ADR-0040
kind: decision
status: accepted
date: 2026-09-27
owners:
  - core-team
supersedes:
  - 0023-adopt-cloudflare-native-operational-reliability-and-observability.md
  - 0029-adopt-internal-operational-console-and-d1-read-model.md
---

# Retirar o admin e a persistência analítica do core

## Contexto e decisão

O produto ainda não está em uso. O responsável aprovou remover o console e aceitar
um intervalo sem dashboards, custos e telemetria persistida antes de implementar
uma stack especializada. Esta decisão substitui as disposições analíticas e de
console das ADRs 0023/0029 e a retenção administrativa acrescentada pelas ADRs
0034/0037. Preserva retries, idempotência, limpeza durável, configuração imutável,
controle de ferramentas, estado causal e demais garantias funcionais dessas decisões.

Remover `apps/admin`, `packages/ui`, `tooling/admin-cli` e `packages/observability`;
retirar contratos e bindings administrativos, Analytics Engine e etapas de
contabilidade/projeção. Permanecem logs nativos simples dos Workers, classificação
tipada de erros dos adapters e orçamentos funcionais do modelo. Isso não oferece
um substituto equivalente à observabilidade removida.

A migration 17 do ledger elimina `review_finding_artifacts`, `run_telemetry`,
`projection_tasks`, `step_attempts`, `step_executions` e `run_configurations.summary_json`.
Converte `analysis_usage` em `review_tool_budgets` antes de removê-la; reservas já
consumidas permanecem bloqueantes após retry ou eviction. A migração é transacional,
versionada e não altera migrations já aplicadas. A perda desse histórico foi
autorizada explicitamente pelo responsável.

Conservar `pr_findings`, decisões, feedback, publicações, check runs, credenciais,
obrigações de cleanup, snapshots privados temporários e referências de configuração.
Não existe mais read model D1 no runtime atual. D1 continua permitido quando uma
necessidade funcional futura o justificar.

## Alternativas e consequências

Manter o admin até Grafana ficar pronto preservaria visibilidade, mas manteria o
custo e o acoplamento que o responsável decidiu eliminar. Trocar todas as integrações
imediatamente por Grafana ampliaria esta entrega sem hospedagem, retenção e transporte
definidos. Ambas as alternativas foram rejeitadas.

Perdem-se painel, replay administrativo, custos, tempos por etapa e evidências
históricas integrais usadas pelo console. A migração não possui rollback capaz de
reconstruir dados apagados; restaurar apenas o código antigo não é suportado.
Nenhum deploy, exclusão remota ou criação da stack Grafana decorre automaticamente
desta alteração no repositório.

## Confirmação e operação

Testar atualização de ledger com reservas existentes, replay da migração e preservação
do estado funcional. Executar o gate local com cobertura sem reduzir thresholds.
Antes do deploy, encerrar workflows ativos e suspender novos disparos: callbacks
persistidos e steps removidos não devem ser retomados sob a nova composição.
Seguir [retirada operacional](../operations/admin-retirement.md).
O [plano Grafana](../planning/observability-stack-migration.md) permanece proposta.
