# Prova local de ledger SQLite e alarms

Workspace privado para DASH-04 / issue #131, milestone 0 do dashboard.
O [relatório datado](../../docs/research/2026-10-05-dashboard-ledger-proof.md)
registra resultado, fontes, comandos e limites.

A fonte comprova primitiva de revisão/obrigação/wake-up, não implementa projeção,
API pública ou ledger de produção. `test/worker.ts` exporta somente classes do
harness para o plugin oficial Vitest; bindings são locais, sem Wrangler/deploy.

```sh
pnpm --filter @holon/dashboard-ledger-proof test
pnpm --filter @holon/dashboard-ledger-proof test:coverage
pnpm --filter @holon/dashboard-ledger-proof typecheck
```

`src/ledger-proof.ts` compara transação async atômica com SQL síncrono seguido de
alarm separado; os testes consultam SQLite e alarm reais. Falhas/relógio/efeito
são controlados, e execução de alarm é dirigida pelo helper oficial. Não há
credenciais, chamada remota ou migração do core.
