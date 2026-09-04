---
id: RESEARCH-2026-09-04-ADMIN-CONSOLE
kind: research
status: current
date: 2026-09-04
verified-at: 2026-09-04
owners:
  - core-team
related:
  - ../planning/internal-operational-console-plan.md
  - ../decisions/0029-adopt-internal-operational-console-and-d1-read-model.md
---

# Toolchain e Arquitetura do Console Operacional Interno (`apps/admin`)

## Pergunta

Qual conjunto de tecnologias, contratos e padrões arquiteturais permite implementar o Console Operacional Interno do Holon (`apps/admin`) com garantia de que falhas de projeção não alterem a integridade ou a latência das revisões, sem expor código-fonte ou secrets no navegador, e preservando os padrões estritos de qualidade do monorepo?

## Resumo dos achados

### Fatos confirmados

- **React Router v8 e Cloudflare Workers**: O template oficial do Cloudflare Workers com React Router v8 e Vite (`@cloudflare/vite-plugin`) suporta SSR direto na borda, mantendo o ponto de entrada em `workers/app.ts`. O Worker pode compor os handlers `fetch`, `queue` e `scheduled` no mesmo export default (`satisfies ExportedHandler<AdminEnv, AdminRunProjectionEventV1>`).
- **Cloudflare D1 como Read Model**: D1 oferece SQLite segregado na borda com transações locais e índices customizados. O uso de `ON CONFLICT(run_id) DO NOTHING` associado a queries de verificação pós-inserção permite idempotência estrita sem mascarar erros de integridade ou colisões de hash.
- **Cloudflare Queues para Projeção Assíncrona**: O desacoplamento via fila garante entrega _at-least-once_. Os métodos individuais `message.ack()` e `message.retry()` permitem processar lotes onde mensagens válidas são reconhecidas e falhas pontuais são retentadas individualmente sem duplicar processamento de mensagens bem-sucedidas.
- **Pull consumer e replay**: O Pull API usa `visibility_timeout_ms`; mensagens publicadas com content type `json` chegam com o campo `body` codificado em Base64 e precisam ser decodificadas antes da validação. No push REST, `content_type: "json"` recebe o objeto JSON no campo `body`, não uma string JSON. O ACK usa o `lease_id` e só deve ocorrer após o push confirmado.
- **Métricas de Queue**: O endpoint REST atual é `GET /accounts/{account_id}/queues/{queue_id}/metrics` e retorna `backlog_count`, `backlog_bytes` e `oldest_message_timestamp_ms` como métricas best-effort. O SLO de frescor deve ser calculado pela idade da mensagem mais antiga, em vez de inferido apenas pelo tamanho do backlog.
- **Cloudflare Analytics Engine para Tendências**: Analytics Engine opera via SQL API e agregação com `_sample_interval`. Trata-se de telemetria aproximada best-effort; nunca deve substituir o D1 em consultas financeiras e contagens exatas.
- **Service Bindings para Detalhe Read-Only**: O consumo de dados pontuais da PR via RPC (`ADMIN_READ_API`) direcionado ao `AdminReadEntrypoint` no control-plane elimina endpoints HTTP públicos para inspeção do ledger e evita acoplar o banco analítico ao estado transacional do Durable Object.
- **Segurança de Borda com Cloudflare Access**: O header `Cf-Access-Jwt-Assertion` assinado com RS256 deve ser validado via JWKS da equipe Cloudflare. A validação de claims (`aud`, `iss`, `exp`, `nbf`, `type !== "app"` e sufixo de email corporativo) garante acesso restrito a operadores humanos autenticados.
- **Content Security Policy Estrita**: CSP baseado em nonces criptográficos por requisição SSR (`nonce-{NONCE}`) para scripts e estilos de elementos isola o console contra XSS, dispensando `unsafe-inline` em tags de script.
- **Design System `@holon/ui` e Tailwind CSS v4**: Tailwind CSS v4 utiliza a diretiva `@import "tailwindcss"` e detecção de fontes via `@source`. Um pacote de UI semântico isolado (`packages/ui`) com componentes acessíveis baseados em `@base-ui/react` e suporte a `tabular-nums` e `prefers-reduced-motion` atende WCAG 2.2 AA sem dependência do domínio de review.
- **Status das bibliotecas no npm (verificado em 2026-09-04)**:
  - `react`: 19.2.8
  - `react-dom`: 19.2.8
  - `react-router`: 8.3.1
  - `@react-router/cloudflare`: 8.3.1
  - `@react-router/dev`: 8.3.1
  - `@cloudflare/vite-plugin`: 1.54.4
  - `vite`: 8.2.2
  - `tailwindcss`: 4.3.3
  - `@tailwindcss/vite`: 4.3.3
  - `@base-ui/react`: 1.7.0
  - `recharts`: 3.10.1
  - `jose`: 6.2.10

### Inferências para Holon

- O console operacional deve ser estritamente read-only: nenhum botão ou endpoint no `apps/admin` terá capacidade de mutar revisões, alterar o ledger ou acionar o GitHub.
- Falhas na fila de projeção ou no D1 nunca afetam a finalização da review no Workflow ou o cleanup dos containers Sandbox.
- O Durable Object de ledger da PR utiliza uma outbox durável (`projection_tasks`) e multiplexa seu scheduler de `alarm()` dando prioridade incondicional a tarefas de limpeza de sandbox pendentes antes de qualquer projeção.
- O navegador jamais recebe prompts, diffs, arquivos brutos ou mensagens de exceção não tratadas.

## Opções comparadas

| Área                    | Escolha recomendada                 | Alternativas avaliadas                    | Motivo principal                                                                            |
| :---------------------- | :---------------------------------- | :---------------------------------------- | :------------------------------------------------------------------------------------------ |
| Read model              | Cloudflare D1 (SQLite)              | Consultas diretas ao Durable Object ou KV | Suporte a índices secundários compostos para paginação keyset sem lock contention no ledger |
| Transporte da projeção  | Cloudflare Queues com DLQ           | Emissão HTTP síncrona ou webhook interno  | Tolerância a falhas, backpressure automático e isolamento da latência do Workflow           |
| Interface Web           | React Router v8 SSR na borda        | SPA estático (SPA mode) ou Next.js        | SSR integrado nativo ao Worker, com nonces de CSP dinâmicos e menor latência                |
| Componentes UI          | `@base-ui/react` + Tailwind v4      | Radix UI / shadcn manual ou Tailwind v3   | Primitivas headless acessíveis modernas e integração de build nativa com Vite               |
| Telemetria de tendência | Cloudflare Analytics Engine SQL API | D1 aggregation tables                     | Consultas temporais de alta escala sem custo de query scan em SQLite transacional           |

## Fontes primárias

Verificadas em 2026-09-04:

- [Cloudflare React Router v8 Framework Guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)
- [Cloudflare Vite Plugin Documentation](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare Queues JavaScript API & Retries](https://developers.cloudflare.com/queues/configuration/javascript-apis/)
- [Cloudflare Queues Pull Consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/)
- [Cloudflare Queues Get Metrics API](https://developers.cloudflare.com/api/resources/queues/methods/get_metrics/)
- [Cloudflare Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
- [Cloudflare Access JWT Validation](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)
- [RFC 8785: JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
