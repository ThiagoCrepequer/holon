---
id: ADR-0029
kind: decision
status: accepted
date: 2026-09-04
owners:
  - core-team
related:
  - 0003-adopt-initial-typescript-application-stack.md
  - 0004-adopt-workflows-do-ledger-and-sandbox-executor.md
  - 0015-use-causal-admission-and-durable-terminal-cleanup.md
  - 0018-adopt-two-phase-decoupled-review-generator.md
  - 0023-adopt-cloudflare-native-operational-reliability-and-observability.md
  - ../architecture/container-view.md
  - ../architecture/technical-ecosystem.md
  - ../architecture/security-and-trust-boundaries.md
  - ../architecture/data-lifecycle.md
  - ../planning/internal-operational-console-plan.md
---

# Adotar Console Operacional Interno com Read Model D1 e Projeção Assíncrona

## Contexto e problema

O Holon possui atualmente dois deployables de produção: `apps/control-plane` (orquestração via Workflows e ledger por PR em Durable Objects SQLite) e `apps/repository-executor` (execução isolada em Cloudflare Sandbox).

Conforme o sistema processa revisões de Pull Requests, operadores de engenharia necessitam de visibilidade operacional centralizada:

1. Visão de saúde global, volume de reviews e latências de admissão/análise;
2. Listagem paginada e filtrável de execuções terminais (`completed`, `failed_terminal`, `obsolete`);
3. Detalhamento de custos, consumo de tokens e decisões de revisão;
4. Identificação rápida de execuções degradadas e gargalos na fila.

Consultar o estado operacional diretamente nos Durable Objects de PR (`ReviewLedgerObject`) apresenta limitações severas:

- O particionamento por PR impossibilita consultas analíticas agregadas (ex.: "quantas revisões falharam nas últimas 24 horas?");
- Executar varreduras analíticas ou paginação em Durable Objects individuais criaria disputa de locks (lock contention), degradando a latência do fluxo crítico de revisão;
- Não há interface visual segura para operadores humanos inspecionarem execuções sem expor dados confidenciais de código ou credenciais.

## Decisão

1. **Terceiro Deployable: `apps/admin` (Console Operacional Interno)**:
   Criar o deployable `apps/admin` baseado no Cloudflare Workers com React Router v8 e Vite. O Worker unifica três handlers em um único ponto de entrada (`workers/app.ts`):
   - `fetch`: SSR do React Router v8 com CSP dinâmico por nonce;
   - `queue`: Consumo assíncrono de eventos de projeção em lote com idempotência e quarentena;
   - `scheduled`: Rotina de retenção temporal de registros analíticos.
     O console é estritamente **read-only**: não possui autoridade de publicação no GitHub, execução no Sandbox ou mutação de ledger.

2. **D1 como Read Model Exato e Segregado**:
   Adotar o Cloudflare D1 como fonte exata de consulta operacional. O schema (`admin_runs`, `admin_metadata`, `admin_projection_quarantine`) suporta paginação keyset ordenada por `(terminal_at_epoch_ms DESC, run_id DESC)` com índices secundários dedicados. Toda inserção utiliza `ON CONFLICT(run_id) DO NOTHING` e validação pós-inserção para garantia de idempotência estrita.

3. **Cloudflare Queues como Transporte Durável At-Least-Once**:
   A transferência de dados entre o Workflow de revisão e o D1 é desacoplada via Cloudflare Queues (`ADMIN_PROJECTION_QUEUE`) com Dead Letter Queue (`ADMIN_PROJECTION_QUEUE_DLQ`).
   Falhas temporárias ou indisponibilidade do consumidor não afetam o resultado, a publicação ou o tempo de vida da revisão. Cada mensagem é confirmada (`ack()`) ou reenviada (`retry()`) individualmente no consumidor.

4. **Analytics Engine Apenas para Tendências Best-Effort**:
   Cloudflare Analytics Engine continua com emissão unidirecional a partir do control plane (`AnalyticsEngineTelemetryEmitter`). O console consome Analytics Engine server-side exclusivamente para gráficos de tendências agregadas (p50/p95 de duração e latência). Valores contábeis, totais de tokens e contagens de execuções derivam exclusivamente do D1.

5. **RPC Nomeado e Versionado para Detalhes de Run**:
   Para inspeção granular de uma revisão específica, o console utiliza um Service Binding nomeado (`ADMIN_READ_API`) chamando o método `getRunDetailV1` na classe `AdminReadEntrypoint` do `apps/control-plane`. O control-plane consulta o `ReviewLedgerObject` da respectiva PR, aplica sanitização allowlisted rigorosa e retorna um DTO `AdminRunDetailV1`. Esse RPC é estritamente interno e não possui rotas HTTP públicas no control plane.

6. **Perímetro de Segurança com Cloudflare Access**:
   A aplicação `apps/admin` é protegida pelo Cloudflare Access em staging e produção.
   O middleware server-side valida a assinatura RS256 de `Cf-Access-Jwt-Assertion` contra o JWKS corporativo, checa audience (`ACCESS_AUD`), vigência temporal e sufixo de domínio corporativo em emails autorizados, e exige `email` válido e `sub` não vazio como identidade humana positiva.
   `workers.dev` e `preview_urls` permanecem explicitamente desativados.

   **Errata registrada em 2026-09-04**: a versão inicial deste ADR descrevia incorretamente `type === "app"` como identificador de token não humano. A [documentação do application token do Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/) mostra que esse claim também está presente no token de uma sessão humana. Service tokens são rejeitados porque não fornecem o `email` verificado de usuário e apresentam `sub` vazio; o middleware não autoriza apenas pela ausência desses sinais, mas exige positivamente ambos os claims humanos.

7. **Outbox Durável no Ledger e Multiplexação do Alarm**:
   A tabela `projection_tasks` é adicionada ao SQLite do `ReviewLedgerObject`.
   O scheduler de `alarm()` multiplexa tarefas de limpeza de sandbox (`cleanup_tasks`) e tarefas de projeção (`projection_tasks`).
   **Invariante de prioridade**: O cleanup de containers Sandbox e credenciais possui prioridade incondicional. Projeções pendentes são processadas com lease de 2 minutos, backoff exponencial e limite de 20 tentativas (`exhausted`).

8. **Retenção e Ausência de Backfill Inicial**:
   - `admin_runs`: 180 dias;
   - `admin_projection_quarantine`: 30 dias;
   - `projection_tasks.completed`: 7 dias;
   - `projection_tasks.exhausted`: 30 dias.
     A V1 entra em operação com watermark `projection_enabled_at` em `admin_metadata`. Execuções anteriores ao cutover não sofrerão backfill, sendo sinalizado na UI que o histórico analítico está disponível a partir da ativação.

9. **Design System `@holon/ui`**:
   Criação de `packages/ui` totalmente desacoplado do domínio, com tokens semânticos (Tailwind CSS v4) e primitivas de acessibilidade (`@base-ui/react`) compatíveis com navegação por teclado, leitor de tela, `tabular-nums` e `prefers-reduced-motion`.

## Opções consideradas e rejeitadas

- **Consultas Diretas ao SQLite dos Durable Objects**: Rejeitado devido à impossibilidade de agregar múltiplas PRs e risco de contenção de locks na orquestração principal.
- **Transmissão Síncrona via HTTP na Finalização do Workflow**: Rejeitado porque indisponibilidade temporária do serviço de analytics poderia falhar ou retardar o fechamento de revisões válidas.
- **Armazenamento de Código e Diffs no D1**: Rejeitado por princípio de privacidade e segurança. O console opera com metadados e resumos allowlisted, nunca com código-fonte arbitrário.
- **Autenticação Manual / Sessões Próprias**: Rejeitado em favor do Cloudflare Access, eliminando gerenciamento de credenciais e senhas no código da aplicação.

## Consequências

### Positivas

- Total isolamento de falhas: o fluxo de review é imune a quedas ou instabilidades no console operacional.
- Consultas agregadas rápidas e com paginação keyset determinística via D1.
- Auditabilidade e isolamento de dados com quarentena para mensagens com divergência de schema ou colisão de integridade.
- Garantia de que nenhum código-fonte ou segredo é exposto aos operadores no navegador.

### Negativas

- Necessidade de gerenciar um terceiro deployable e novas filas na infraestrutura Cloudflare.
- A projeção analítica é eventualmente consistente em relação ao encerramento imediato do Workflow (atraso esperado de milissegundos a poucos segundos).
- Ausência de histórico analítico de revisões executadas antes da data de ativação da projeção.

## Critérios de confirmação

1. **Local e Testes**:
   - Contratos Zod V1 e funções de canonicalização/hash validados com 100% de cobertura.
   - Suíte de testes unitários e de integração de D1, Queue consumer, Outbox e RPC passando localmente.
   - Thresholds de cobertura do monorepo rigorosamente preservados (85% branches, 90% functions, lines, statements).
2. **Staging e Produção**:
   - Eventos de finalização no Workflow enfileiram projeções e confirmam inserção no D1 em menos de 5 segundos de atraso (lag).
   - Tentativa de envio de eventos duplicados é absorvida de forma idempotente sem duplicação de linhas.
   - Acesso via Custom Domain sem JWT válido do Cloudflare Access retorna 401 Unauthorized imediato.
