---
id: OPERATIONS-DEPLOYMENT
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-08-29
---

# Provisionamento e deploy

Nenhum deploy remoto foi executado durante o bootstrap. Os comandos abaixo são
um runbook e causam efeitos externos; confirme conta e ambiente antes de usá-los.

## Recursos

1. Crie um AI Gateway e escolha um modelo compatível com a API OpenAI-style do
   endpoint REST atual `/accounts/{account_id}/ai/v1`.
2. Crie a DLQ e a Queue principal:

   ```bash
   pnpm exec wrangler queues create holon-review-jobs-dlq
   pnpm exec wrangler queues create holon-review-jobs
   ```

3. Configure o GitHub App conforme [github-app.md](github-app.md).
4. Faça deploy primeiro do executor, porque o control plane possui um service
   binding para ele:

   ```bash
   pnpm --filter @holon/repository-executor deploy
   ```

5. Configure no control plane os sete nomes listados em
   [desenvolvimento local](local-development.md#secrets-locais). Use
   `wrangler secret put` para credenciais; App/account/gateway/model IDs também
   podem ser variáveis por ambiente sem valores reais versionados.
6. Faça deploy do control plane:

   ```bash
   pnpm --filter @holon/control-plane deploy
   ```

O Wrangler aplica a migration v1 do Durable Object SQLite e registra Workflow,
Queue bindings e service binding definidos nos respectivos `wrangler.jsonc`.

## Smoke test controlado

1. Confirme `GET /health` com status 200.
2. Use um repositório sintético privado instalado explicitamente no App.
3. Abra um PR sem bug e confirme uma única review-resumo.
4. Abra um PR com regressão conhecida e confirme coordenada `line`/`side`.
5. Reentregue o mesmo webhook e confirme ausência de novos comentários.
6. Force-push durante uma análise e confirme outcome `obsolete` sem publicação.
7. Revogue/desinstale o App e confirme que novas runs falham sem expor segredo.

## Observabilidade e rollback

O código emite JSON estruturado para `review.started`, `model.usage`,
`review.completed`, `review.failed` e falhas secundárias de cleanup ou
terminalização. Os campos incluem run, IDs não secretos, duração, outcome,
tokens e quantidade publicada; não incluem prompt, diff, arquivo ou mensagem
arbitrária de erro. Antes do piloto, configure retenção e acesso aos logs e ao
AI Gateway.

Uma versão anterior pode ser reimplantada, mas migrations de Durable Objects não
devem ser removidas ou reutilizadas. O executor é efêmero; runs em andamento
podem ser repetidas e serão reconciliadas pelo ledger e pelos marcadores GitHub.
