---
id: OPERATIONS-ADMIN-RETIREMENT
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-09-27
---

# Retirada do admin e dos históricos analíticos

A [ADR-0040](../decisions/0040-retire-admin-and-analytical-storage.md) autoriza a
retirada do código e a migration 17. A exclusão nominal dos históricos no ledger
foi confirmada pelo responsável. Este documento não afirma que houve deploy ou
remoção de recursos remotos.

## Atualização coordenada

1. Identificar conta, Workers e revisão exata que será publicada. Suspender novos
   disparos; aguardar ou encerrar workflows antigos e confirmar cleanup pendente.
   Não retomar instâncias com os checkpoints antigos sob o código novo.
2. Executar `pnpm verify` e publicar os dois deployables da mesma revisão conforme
   [deploy](deployment.md). Não publicar mais `apps/admin`.
3. Na inicialização de cada ledger, `applyLedgerMigrations` aplica a migration 17
   em transação: transfere reservas consumidas, remove históricos analíticos e
   registra a versão. Falha reverte a transação; nova inicialização tenta novamente.
   Não há comando D1 para essa migração: os ledgers são SQLite em Durable Objects.
4. Validar um PR novo: check iniciado, resultado no GitHub, achados inline quando
   elegíveis, feedback e limpeza terminal. Liberar novos disparos após esse smoke.

## Recursos remotos que não são apagados pelo código

Inventariar separadamente o Worker `holon-admin`, seus domínios/Access, D1
`holon-admin-d1`, filas `holon-admin-projections` e `holon-admin-projections-dlq`,
dataset `holon_telemetry_events`, variáveis e secrets exclusivos do admin.
O nome configurado não comprova existência nem ausência de outros consumidores.
Não há mais bindings locais para esses recursos; sua exclusão remota deve ser
executada como operação explícita após confirmar IDs, conta e consumidores.
Não remover filas de review, Workflows, ledger, cache de identificação ou executor.

## Dados e recuperação

São apagados `review_finding_artifacts`, `run_telemetry`, `projection_tasks`,
`step_attempts`, `step_executions`, `analysis_usage` e `summary_json` de
`run_configurations`. `review_tool_budgets` conserva os limites consumidos por
run/shard. Findings funcionais, configuração necessária ao replay, publicações e
obrigações de cleanup permanecem.

Não restaurar o binário antigo sobre o schema novo. Uma recuperação exige correção
aditiva compatível com o schema atual ou restauração previamente preparada; não
há reconstrução automática do histórico eliminado.

Durante o intervalo anterior à stack Grafana, há somente logs nativos simples e
estado funcional. Não há painel, contabilidade de custos nem histórico de etapas.
