---
id: PLAN-ADMIN-CONSOLE-001
kind: planning
status: current
owners:
  - core-team
last-reviewed: 2026-09-04
related:
  - ../architecture/system-overview.md
  - ../architecture/container-view.md
  - ../architecture/technical-ecosystem.md
  - ../architecture/security-and-trust-boundaries.md
  - ../architecture/data-lifecycle.md
  - ../decisions/README.md
  - ../operations/deployment.md
  - review-core-evolution-roadmap.md
---

# Plano de Implementação: Console Operacional Interno do Holon e Design System `@holon/ui`

## 0. Como executar este plano

Este documento é uma especificação de implementação, não uma decisão já aceita. O agente executor deve seguir a ordem das fases e não preencher lacunas arquiteturais por suposição.

Antes de alterar código:

1. Ler `AGENTS.md`, `docs/README.md`, `docs/decisions/README.md`, os ADRs relacionados e os documentos listados no frontmatter.
2. Confirmar a raiz Git, a branch e o estado da worktree com `git status --short`.
3. Preservar alterações do usuário e não misturar mudanças não relacionadas.
4. Atualizar a branch contra `origin/main` antes de numerar o ADR. Não inventar o próximo número.
5. Consultar documentação primária atual da Cloudflare, React Router, Base UI e Tailwind antes de fixar versões ou APIs instáveis.
6. Implementar um teste focado que falhe antes de cada correção comportamental.
7. Fazer commits atômicos por responsabilidade. Não combinar ADR, infraestrutura, design system e telas em um único commit.
8. Não criar recursos remotos, secrets, Access Applications, domínios ou deploys sem autorização explícita.

Quando o código atual divergir deste plano:

- ADR aceito vence o plano.
- Contratos implementados e testes revelam o estado atual, mas não autorizam quebrar uma decisão aceita.
- Se a divergência afetar trust boundary, estado persistido ou contrato externo, parar e atualizar o ADR/plano antes de implementar.
- Não usar cast amplo, `as unknown as`, payload sem schema, armazenamento de conteúdo bruto ou fallback silencioso para contornar incompatibilidades.

### 0.1. Invariantes obrigatórios

1. Falhas do console nunca alteram o resultado, publicação ou cleanup de uma revisão.
2. O navegador nunca recebe prompts, diffs, código-fonte, excerpts de evidência, secrets ou exception messages arbitrárias.
3. D1 é a fonte exata do read model; Analytics Engine é telemetria aproximada e best-effort.
4. Toda entrada externa é validada com schema runtime estrito.
5. Toda entrega da Queue é tratada como at-least-once.
6. Duplicatas idênticas são no-op; payload divergente para a mesma run é incidente de integridade.
7. O console é read-only. Nenhum componente possui autoridade GitHub, Sandbox ou publicação.
8. `workers.dev` e Preview URLs permanecem desativados em staging e produção.
9. Evidência local, browser e live smoke são reportadas separadamente.
10. Os thresholds globais de cobertura não podem ser reduzidos nem contornados por exclusões de produção.

## 1. Escopo do produto e governança

### 1.1. Objetivo

`apps/admin` será a Console Operacional Interna do Holon para engenheiros operadores. Ela oferece:

- visão de saúde e volume das revisões;
- listagem paginada de runs terminais;
- custo e telemetria exatos a partir do D1;
- tendências aproximadas a partir da Analytics Engine;
- drill-down read-only de uma run conhecida;
- indicação explícita de dados parciais ou infraestrutura degradada.

### 1.2. Não objetivos da primeira versão

- produto multi-tenant para clientes;
- RBAC por organização ou repositório;
- mutações sobre runs, findings ou GitHub;
- replay de reviews completas;
- edição de `.holon.yml`;
- armazenamento histórico de código, diff ou prompt;
- auditoria externa/compliance;
- backfill de runs anteriores ao cutover;
- dark mode.

Todos os operadores admitidos pela política do Cloudflare Access visualizam todos os repositórios projetados. Essa consequência deve aparecer no ADR e no runbook de Access.

### 1.3. ADR obrigatório

Criar `docs/decisions/<next-available-adr>-adopt-internal-operational-console-and-d1-read-model.md` antes do código de produção. O ADR deve registrar:

1. terceiro deployable `apps/admin` com React Router v8;
2. D1 como read model exato e segregado;
3. Queue como transporte durável at-least-once;
4. Analytics Engine apenas para tendências best-effort;
5. RPC nomeado e versionado para detalhes read-only;
6. Cloudflare Access como perímetro humano;
7. outbox durável no ledger para falhas de publicação da projeção;
8. retenção e ausência de backfill inicial;
9. riscos e alternativas rejeitadas;
10. critérios de confirmação local, staging e produção.

Atualizar na mesma mudança:

- `docs/decisions/README.md`;
- `docs/architecture/container-view.md`;
- `docs/architecture/technical-ecosystem.md`;
- `docs/architecture/security-and-trust-boundaries.md`;
- `docs/architecture/data-lifecycle.md`;
- `docs/contracts/README.md`;
- `docs/operations/deployment.md`;
- `docs/operations/local-development.md`;
- `docs/README.md`.

## 2. Arquitetura pretendida

```text
Browser autorizado
  -> Cloudflare Access
  -> apps/admin
       |- fetch: React Router SSR, loaders e endpoints read-only
       |- queue: projeção de runs no D1
       |- scheduled: retenção do D1
       |- D1: listagem, totais, quarentena e watermark de cutover
       |- HTTP server-side: Analytics Engine SQL API e Queue Metrics API
       `- Service Binding ADMIN_READ_API
            -> apps/control-plane/AdminReadEntrypoint
                 -> ReviewLedgerObject da PR

apps/control-plane/ReviewWorkflow
  -> terminaliza run e solicita cleanup
  -> cria snapshot imutável da projeção
  -> registra projection_task no ledger
  -> envia à ADMIN_PROJECTION_QUEUE
  -> marca projection_task concluída

ReviewLedgerObject.alarm
  -> prioriza cleanup pendente
  -> reenvia projection_task vencida
  -> agenda o próximo trabalho durável

ADMIN_PROJECTION_QUEUE
  -> apps/admin queue handler
  -> valida contrato
  -> INSERT imutável/no-op/conflito no D1
  -> ack individual
  -> DLQ após retries esgotados
```

Em texto: o Workflow continua dono da execução da review, o ledger por PR continua dono do estado durável e do cleanup, e o console recebe somente um snapshot operacional limitado. A Queue desacopla disponibilidade. O D1 serve consultas exatas. A Analytics Engine não é reconciliada transacionalmente e nunca sustenta valores financeiros absolutos. O RPC só é usado quando o operador abre uma run específica.

## 3. Contratos canônicos

### 3.1. Evento de projeção V1

Criar `packages/contracts/src/admin-projection.ts` e exportá-lo em `packages/contracts/src/index.ts`.

Os schemas compartilhados estão em `./shared.js`; não importar de um módulo inexistente. Reutilizar `gitShaSchema`, `positiveIntegerSchema`, `prKeySchema`, `runIdSchema` e `timestampSchema`.

```typescript
import { z } from "zod";

import { reviewScopeStatusSchema } from "./review-plan.js";
import { reviewVerdictSchema } from "./review-verdict.js";
import {
  gitShaSchema,
  positiveIntegerSchema,
  prKeySchema,
  runIdSchema,
  timestampSchema,
} from "./shared.js";

const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const reviewPhaseReachedSchema = z.enum([
  "admitted",
  "repository_prepared",
  "analysis_started",
  "analyzed",
  "publishing",
]);

export const adminRunProjectionPayloadV1Schema = z.strictObject({
  headSha: gitShaSchema,
  prKey: prKeySchema,
  projectedFrom: z.literal("workflow"),
  projectionRequestedAt: timestampSchema,
  pullRequestNumber: positiveIntegerSchema,
  recordVersion: z.literal(1),
  repository: z.strictObject({
    id: positiveIntegerSchema,
    name: z.string().trim().min(1).max(100),
    owner: z.string().trim().min(1).max(100),
  }),
  reviewPhaseReached: reviewPhaseReachedSchema,
  runId: runIdSchema,
  schemaVersion: z.literal(1),
  scopeStatus: reviewScopeStatusSchema.nullable(),
  telemetry: z.strictObject({
    estimatedCostMicroUsd: nonNegativeSafeIntegerSchema,
    executionDurationMs: nonNegativeSafeIntegerSchema,
    inputTokens: nonNegativeSafeIntegerSchema,
    isDegraded: z.boolean(),
    outputTokens: nonNegativeSafeIntegerSchema,
    pricingModel: z.string().trim().min(1).max(100),
    reasoningTokens: nonNegativeSafeIntegerSchema.nullable(),
    reviewAdmissionQueueWaitMs: nonNegativeSafeIntegerSchema,
    shardsCount: nonNegativeSafeIntegerSchema,
    toolCallsCount: nonNegativeSafeIntegerSchema,
  }),
  terminalState: z.enum(["completed", "failed_terminal", "obsolete"]),
  timestamps: z.strictObject({
    analysisStartedAt: timestampSchema.nullable(),
    terminalAt: timestampSchema,
    webhookReceivedAt: timestampSchema,
    workflowStartedAt: timestampSchema,
  }),
  verdict: reviewVerdictSchema.nullable(),
});

export const adminRunProjectionEventV1Schema = z
  .strictObject({
    eventId: z.string().regex(/^proj:v1:[a-f0-9]{64}:1$/u),
    payload: adminRunProjectionPayloadV1Schema,
    payloadHash: sha256Schema,
  })
  .superRefine((event, context) => {
    if (!event.payload.runId.startsWith(`${event.payload.prKey}:head:`)) {
      context.addIssue({
        code: "custom",
        message: "runId does not belong to prKey",
        path: ["payload", "runId"],
      });
    }
    if (!event.payload.runId.endsWith(event.payload.headSha)) {
      context.addIssue({
        code: "custom",
        message: "runId does not match headSha",
        path: ["payload", "headSha"],
      });
    }
  });

export type AdminRunProjectionEventV1 = z.infer<
  typeof adminRunProjectionEventV1Schema
>;
```

Aplicar também uma validação pura de ordem temporal:

```text
webhookReceivedAt <= workflowStartedAt <= terminalAt
analysisStartedAt, quando presente, fica entre workflowStartedAt e terminalAt
projectionRequestedAt >= terminalAt
```

`scopeStatus = null` é permitido apenas quando a review não alcançou análise suficiente para produzir escopo. Não inventar `partial_by_failure` para uma run obsoleta antes do preparo do repositório.

### 3.2. Imutabilidade e versionamento

Na V1, a projeção terminal é imutável:

- `recordVersion` é literal `1`;
- o mesmo `runId` com o mesmo `payloadHash` é duplicata;
- o mesmo `runId` com hash diferente é conflito;
- não existe correção silenciosa por UPSERT;
- reprojeção apenas reenvia exatamente o snapshot persistido.

Uma futura capacidade de corrigir snapshots exige novo ADR, migration e contrato que defina `recordVersion > 1`. O agente não deve antecipar essa capacidade na V1.

### 3.3. Serialização e hash

Criar uma única função pura `buildAdminProjectionEventV1`. Ela deve:

1. validar o payload;
2. serializar somente o objeto `payload`, excluindo `eventId` e `payloadHash`;
3. aplicar JSON Canonicalization Scheme RFC 8785 ou uma implementação interna equivalente com comportamento documentado;
4. preservar a ordem dos arrays;
5. rejeitar `undefined`, `NaN`, `Infinity`, bigint e valores fora do schema;
6. calcular `payloadHash = sha256(canonicalPayloadUtf8)`;
7. calcular `eventId = proj:v1:${sha256(runId)}:1`;
8. validar novamente o envelope final.

Adicionar test vectors fixos, incluindo Unicode, campos nulos e objetos com chaves em ordens diferentes. Não duplicar a função de canonicalização entre produtor, consumidor e CLI.

### 3.4. DTO de detalhe read-only

Criar `packages/contracts/src/admin-run-detail.ts`. O DTO não reutiliza diretamente `TrackedFinding`, porque esse tipo contém conteúdo mais amplo que a apresentação administrativa deve expor.

Contrato mínimo:

```typescript
import { z } from "zod";

import { ciEvidenceStatusSchema } from "./ci-evidence.js";
import {
  costAccountingSchema,
  stepTimingSchema,
  tokenAccountingSchema,
} from "./telemetry.js";
import {
  findingFingerprintSchema,
  findingStatusSchema,
} from "./finding-lifecycle.js";
import { reviewScopeStatusSchema } from "./review-plan.js";
import { reviewVerdictSchema } from "./review-verdict.js";
import {
  gitShaSchema,
  positiveIntegerSchema,
  prKeySchema,
  repositoryPathSchema,
  runIdSchema,
  timestampSchema,
} from "./shared.js";

export const adminFindingSummaryV1Schema = z.strictObject({
  diagnostic: z.string().min(1).max(512),
  filePath: repositoryPathSchema,
  fingerprint: findingFingerprintSchema,
  line: positiveIntegerSchema,
  severity: z.enum(["critical", "high", "medium", "low"]),
  status: findingStatusSchema,
  updatedAt: timestampSchema,
});

export const adminCiSummaryV1Schema = z.strictObject({
  durationMs: nonNegativeSafeIntegerSchema.nullable(),
  failed: nonNegativeSafeIntegerSchema,
  passed: nonNegativeSafeIntegerSchema,
  skipped: nonNegativeSafeIntegerSchema,
  status: ciEvidenceStatusSchema,
  total: nonNegativeSafeIntegerSchema,
  workflowName: z.string().trim().min(1).max(100).nullable(),
});

export const adminRunDetailV1Schema = z.strictObject({
  currentFindings: z.array(adminFindingSummaryV1Schema).max(100),
  findingsPerspective: z.literal("current_pr_state"),
  run: z.strictObject({
    cost: costAccountingSchema,
    headSha: gitShaSchema,
    isDegraded: z.boolean(),
    prKey: prKeySchema,
    runId: runIdSchema,
    scopeStatus: reviewScopeStatusSchema.nullable(),
    shardsCount: nonNegativeSafeIntegerSchema,
    stepTimings: z.array(stepTimingSchema).max(100),
    terminalState: z.enum(["completed", "failed_terminal", "obsolete"]),
    tokens: tokenAccountingSchema,
    toolCallsCount: nonNegativeSafeIntegerSchema,
    verdict: reviewVerdictSchema.nullable(),
  }),
  schemaVersion: z.literal(1),
  structuredCi: adminCiSummaryV1Schema.nullable(),
});
```

Não colocar texto de interface no contrato. Quando `findingsPerspective` for `current_pr_state`, a UI renderiza localmente: “Esta seção reflete o estado consolidado mais recente dos apontamentos desta PR.”

Zod `.max()` conta caracteres, não bytes. A transformação server-side deve aplicar limites UTF-8 com `TextEncoder` antes da validação final. Truncar em fronteira de code point, acrescentar `…` somente se o resultado continuar no limite e nunca cortar bytes UTF-8. O DTO final deve ser validado no control plane antes de retornar e novamente em `apps/admin` após o RPC.

## 4. Finalização do Workflow e outbox recuperável

### 4.1. Ordem obrigatória

Para cada caminho `completed`, `obsolete` e `failed_terminal`:

1. persistir a telemetria disponível no ledger;
2. executar a transição terminal condicional e obter `terminalAt` persistido;
3. solicitar cleanup durável;
4. executar `build-admin-projection` e persistir o resultado do step;
5. registrar idempotentemente a `projection_task` no ledger antes do primeiro send;
6. executar `publish-admin-projection` com retry explícito;
7. se o send confirmar, marcar a tarefa como `completed`;
8. se o send esgotar retries, capturar somente o tipo seguro do erro, deixar a tarefa `pending` e garantir um alarm;
9. retornar o resultado terminal original da review.

Se o send confirmar e o processo cair antes de marcar a tarefa como concluída, o alarm pode reenviar. Isso é esperado; o consumidor D1 é idempotente.

### 4.2. Schema da outbox no Durable Object

Adicionar ao schema SQLite do `ReviewLedgerObject`:

```sql
CREATE TABLE IF NOT EXISTS projection_tasks (
  run_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'completed', 'exhausted')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  requested_at TEXT NOT NULL,
  next_attempt_at_epoch_ms INTEGER NOT NULL,
  lease_expires_at_epoch_ms INTEGER,
  completed_at TEXT,
  last_error_kind TEXT
);

CREATE INDEX IF NOT EXISTS idx_projection_tasks_due
  ON projection_tasks(state, next_attempt_at_epoch_ms, run_id);
```

`payload_json` é permitido apenas aqui porque contém exclusivamente o envelope administrativo validado, nunca conteúdo arbitrário do repositório. Não logar esse JSON.

### 4.3. Multiplexação do único alarm

O ledger já usa `alarm()` para `cleanup_tasks`. Não criar um segundo alarm nem substituir a lógica atual. Refatorar para um scheduler único:

```typescript
public override async alarm(): Promise<void> {
  const cleanup = this.pendingCleanupDue();
  if (cleanup) {
    await this.processCleanup(cleanup);
    await this.ensureNextMaintenanceAlarm();
    return;
  }

  const projection = this.pendingProjectionDue();
  if (projection) {
    await this.processProjection(projection);
    await this.ensureNextMaintenanceAlarm();
    return;
  }

  await this.ensureNextMaintenanceAlarm();
}
```

Regras:

- cleanup sempre tem prioridade para não reter Sandbox/credenciais;
- processar uma tarefa por disparo para limitar CPU e chamadas externas;
- são elegíveis tarefas `pending` vencidas e tarefas `processing` cujo lease expirou;
- claim para `processing` deve ser condicional, incrementar `attempts` e definir lease de 2 minutos;
- sucesso marca `completed`;
- erro retorna a `pending`, limpa o lease e aplica backoff exponencial limitado a uma hora;
- uma reinicialização do objeto entre claim e conclusão não pode deixar tarefa presa em `processing`;
- após 20 tentativas, marcar `exhausted` e emitir métrica estruturada;
- `ensureNextMaintenanceAlarm` agenda o menor `next_attempt_at` entre cleanup e projeção;
- nunca apagar uma tarefa `exhausted` antes da retenção operacional;
- não registrar arbitrary exception message, payload ou authorization header.

Testar que falha de projeção não impede cleanup, e que cleanup pendente não é postergado por repetidas falhas da Queue.

## 5. D1: read model imutável

### 5.1. Migration inicial

Criar `apps/admin/migrations/0001_initial_admin_read_model.sql`:

```sql
CREATE TABLE admin_runs (
  run_id TEXT PRIMARY KEY,
  repository_id INTEGER NOT NULL CHECK (repository_id > 0),
  repository_owner TEXT NOT NULL CHECK (length(repository_owner) BETWEEN 1 AND 100),
  repository_name TEXT NOT NULL CHECK (length(repository_name) BETWEEN 1 AND 100),
  pr_key TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  head_sha TEXT NOT NULL CHECK (length(head_sha) = 40),
  terminal_state TEXT NOT NULL CHECK (terminal_state IN ('completed', 'failed_terminal', 'obsolete')),
  verdict TEXT CHECK (verdict IN ('APPROVE', 'REQUEST_CHANGES', 'COMMENT') OR verdict IS NULL),
  scope_status TEXT CHECK (scope_status IN ('complete', 'partial_by_policy', 'partial_by_failure', 'unsupported') OR scope_status IS NULL),
  review_phase_reached TEXT NOT NULL CHECK (review_phase_reached IN ('admitted', 'repository_prepared', 'analysis_started', 'analyzed', 'publishing')),
  review_admission_wait_ms INTEGER NOT NULL CHECK (review_admission_wait_ms >= 0),
  execution_duration_ms INTEGER NOT NULL CHECK (execution_duration_ms >= 0),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  reasoning_tokens INTEGER CHECK (reasoning_tokens >= 0 OR reasoning_tokens IS NULL),
  tool_calls_count INTEGER NOT NULL CHECK (tool_calls_count >= 0),
  estimated_cost_micro_usd INTEGER NOT NULL CHECK (estimated_cost_micro_usd >= 0),
  pricing_model TEXT NOT NULL CHECK (length(pricing_model) BETWEEN 1 AND 100),
  shards_count INTEGER NOT NULL CHECK (shards_count >= 0),
  is_degraded INTEGER NOT NULL CHECK (is_degraded IN (0, 1)),
  webhook_received_at TEXT NOT NULL,
  workflow_started_at TEXT NOT NULL,
  analysis_started_at TEXT,
  terminal_at TEXT NOT NULL,
  terminal_at_epoch_ms INTEGER NOT NULL CHECK (terminal_at_epoch_ms > 0),
  projection_requested_at TEXT NOT NULL,
  projected_at TEXT NOT NULL,
  projected_at_epoch_ms INTEGER NOT NULL CHECK (projected_at_epoch_ms > 0),
  projection_delivery_lag_ms INTEGER NOT NULL CHECK (projection_delivery_lag_ms >= 0),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  record_version INTEGER NOT NULL CHECK (record_version = 1),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  source_event_id TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_admin_runs_cursor
  ON admin_runs(terminal_at_epoch_ms DESC, run_id DESC);
CREATE INDEX idx_admin_runs_repo_cursor
  ON admin_runs(repository_id, terminal_at_epoch_ms DESC, run_id DESC);
CREATE INDEX idx_admin_runs_state_cursor
  ON admin_runs(terminal_state, terminal_at_epoch_ms DESC, run_id DESC);
CREATE INDEX idx_admin_runs_repo_pr
  ON admin_runs(repository_id, pr_number, terminal_at_epoch_ms DESC, run_id DESC);
CREATE INDEX idx_admin_runs_head_sha
  ON admin_runs(head_sha);

CREATE TABLE admin_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);

CREATE TABLE admin_projection_quarantine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_event_id_hash TEXT,
  observed_run_id_hash TEXT,
  computed_payload_hash TEXT NOT NULL CHECK (length(computed_payload_hash) = 64),
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
  observed_schema_version INTEGER,
  error_code TEXT NOT NULL CHECK (length(error_code) BETWEEN 1 AND 100),
  created_at_epoch_ms INTEGER NOT NULL CHECK (created_at_epoch_ms > 0)
);

CREATE INDEX idx_admin_projection_quarantine_created
  ON admin_projection_quarantine(created_at_epoch_ms);
```

Não usar `CREATE TABLE IF NOT EXISTS` em migrations versionadas: falhar diante de drift é preferível a mascarar uma migration parcialmente aplicada.

Após aplicar a migration, inserir `projection_enabled_at` em `admin_metadata`. A UI mostra “Dados disponíveis desde …”. Não fazer backfill na V1.

### 5.2. Algoritmo do consumidor

O handler deve processar cada mensagem independentemente:

```text
para cada message:
  medir o tamanho serializado de forma limitada
  validar AdminRunProjectionEventV1
  se inválida:
    calcular somente hashes seguros
    inserir quarentena sem payload bruto
    ack somente após a quarentena confirmar
    se D1 falhar, retry da mensagem
    continuar

  recalcular payloadHash do payload canônico
  se divergir do envelope:
    quarentena HASH_MISMATCH
    ack após persistência
    continuar

  calcular projectedAt e projectionDeliveryLagMs
  INSERT INTO admin_runs (...) VALUES (...)
    ON CONFLICT(run_id) DO NOTHING
  se rowsWritten = 1:
    ack
    continuar

  SELECT payload_hash, source_event_id, schema_version, record_version
  se hash e IDs forem idênticos:
    ack como duplicate
  senão:
    inserir quarentena IMMUTABLE_RUN_CONFLICT
    ack após persistência
```

Não usar `INSERT OR IGNORE`: ele também pode ocultar violações de `CHECK` e `NOT NULL`. Um conflito isolado de `source_event_id` com outro `run_id` deve ser consultado, classificado como `EVENT_ID_COLLISION` e persistido na quarentena; não pode entrar em retry infinito.

Usar `message.ack()` e `message.retry()` individualmente. Uma mensagem ruim não pode causar redelivery das mensagens já persistidas do batch. Não engolir erro de D1.

Não chamar Analytics Engine no consumidor; o emissor atual do control plane continua sendo o único writer de tendências.

### 5.3. Paginação, filtros e busca

O cursor é um token HMAC opaco, não autorização. Formato lógico antes de base64url:

```json
{
  "v": 1,
  "terminalAtEpochMs": 0,
  "runId": "github:...",
  "filterHash": "sha256",
  "issuedAtEpochMs": 0,
  "kid": "cursor-key-2026-01"
}
```

Assinar o payload serializado com HMAC-SHA-256. Regras:

- secret `ADMIN_CURSOR_HMAC_KEYS` contém keyring primária + secundária;
- emitir com a primária e aceitar ambas durante rotação;
- expiração máxima de 24 horas;
- `filterHash` inclui período, repository ID, terminal state, verdict, page size e ordenação;
- assinatura inválida, cursor expirado ou filtro divergente retorna `400` genérico;
- comparar assinatura em tempo constante;
- limitar `pageSize` a 20, 50 ou 100; default 50;
- buscar `pageSize + 1` e nunca executar `COUNT(*)` por página.

Usar queries distintas com e sem cursor. Para filtros, criar query builders por combinações suportadas; valores continuam bind parameters. Nunca interpolar entrada do usuário em SQL.

A busca V1 é estruturada, não full-text:

- `owner/name#123` -> repository + PR exatos;
- run ID completo -> `run_id = ?`;
- SHA de 40 caracteres -> `head_sha = ?`;
- nenhum `LIKE '%texto%'`.

### 5.4. Retenção

- `admin_runs`: 180 dias;
- `admin_projection_quarantine`: 30 dias;
- `projection_tasks.completed`: 7 dias no ledger;
- `projection_tasks.exhausted`: 30 dias;
- Analytics Engine: retenção da plataforma, apresentada como 90 dias;
- Queue/DLQ: 96 horas na V1.

O `scheduled` handler de `apps/admin` executa deletes em lotes pequenos, com limite temporal, e registra apenas contagens. Nunca fazer uma transação de limpeza sem limite de linhas.

Usar uma forma compatível com SQLite/D1 sem depender de `DELETE ... LIMIT`:

```sql
DELETE FROM admin_runs
WHERE run_id IN (
  SELECT run_id
  FROM admin_runs
  WHERE terminal_at_epoch_ms < ?
  ORDER BY terminal_at_epoch_ms ASC, run_id ASC
  LIMIT 500
);
```

Repetir em invocações futuras do `scheduled`; não criar loop longo em uma única execução.

## 6. Queue, DLQ e replay

### 6.1. Recursos e bindings

Provisionar, após autorização explícita:

- `holon-admin-projections` com retenção de 345600 segundos;
- `holon-admin-projections-dlq` com retenção de 345600 segundos;
- producer binding `ADMIN_PROJECTION_QUEUE` em `apps/control-plane`;
- push consumer no `apps/admin` com batch 10, timeout 5 segundos, retries 5 e DLQ;
- nenhum push consumer na DLQ;
- pull consumer habilitado na DLQ pela API/dashboard, pois isso não é configurado no `wrangler.jsonc`.

Gerar tipos com `wrangler types`; não manter binding manual tipado por cast.

### 6.2. CLI de replay

Criar `tooling/admin-cli/replay-dlq.ts` com:

- `--dry-run` como default;
- `--execute` obrigatório para mutar;
- `--limit <1..1000>` obrigatório em execução;
- `--batch-size <1..100>`, default 10;
- `--visibility-timeout <30..43200>`, default 300 segundos;
- confirmação do nome/ID da Queue e ambiente;
- token local `CF_QUEUES_REPLAY_TOKEN` com Queue Read e Queue Write;
- token nunca vinculado ao Worker e nunca impresso;
- ack na DLQ somente depois que o send à fila principal confirmar;
- retry/ausência de ack quando o reenvio falhar;
- resumo `pulled`, `requeued`, `acked`, `failed`, sem bodies;
- exit code não zero se qualquer mensagem falhar;
- testes do client HTTP com respostas controladas, lease expirado e sucesso parcial.

Replay não corrige payload inválido. Eventos incompatíveis com o schema vigente permanecem na DLQ até correção do consumidor ou expiração.

## 7. Analytics Engine e saúde operacional

### 7.1. Escrita

Manter `AnalyticsEngineTelemetryEmitter` no control plane como único writer. Documentar o layout físico:

| Campo lógico                 | Analytics Engine |
| ---------------------------- | ---------------- |
| `runId`                      | `blob1`          |
| `pricingModel`               | `blob2`          |
| `terminalState`              | `blob3`          |
| `scopeStatus`                | `blob4`          |
| `verdict`                    | `blob5`          |
| `prKey`                      | `blob6`          |
| `schemaVersion`              | `blob7`          |
| `durationMs`                 | `double1`        |
| `reviewAdmissionQueueWaitMs` | `double2`        |
| `inputTokens`                | `double3`        |
| `outputTokens`               | `double4`        |
| `estimatedCostMicroUsd`      | `double5`        |
| `toolCallsCount`             | `double6`        |
| `shardsCount`                | `double7`        |
| `isDegraded`                 | `double8`        |
| sampling key                 | `index1 = prKey` |

Não mudar posições sem incrementar `schemaVersion` e adaptar queries. Escritas são best-effort e não bloqueiam a review.

### 7.2. Leitura server-side

Criar um adapter `AnalyticsQueryClient` em módulo `.server.ts`:

- endpoint fixo derivado de `CF_ACCOUNT_ID`;
- secret `CF_ANALYTICS_API_TOKEN` com `Account Analytics Read`;
- somente queries predefinidas para `24h`, `7d` e `30d`;
- timeout de 5 segundos com `AbortSignal.timeout` ou `AbortController`;
- validar status, content type, tamanho máximo e schema JSON da resposta;
- não registrar token, SQL com dados do usuário, response body ou exception message;
- erro retorna resultado tipado `unavailable`, nunca quebra D1/listagem;
- ponderar contagens e quantis por `_sample_interval`;
- rotular a UI como tendência aproximada.

Valores absolutos de custo, runs e tokens vêm do D1.

### 7.3. Queue metrics e freshness

Criar adapter server-side para a Queue Metrics API com secret separado `CF_QUEUES_READ_TOKEN`, limitado a Queue Read. Configurar IDs da fila principal e DLQ como vars não secretas.

Exibir:

- última run projetada do D1;
- backlog aproximado;
- idade aproximada da mensagem mais antiga;
- profundidade da DLQ;
- projeções `exhausted`, quando expostas por métrica estruturada.

Classificar como `degraded` apenas quando `backlogCount > 0` e a mensagem mais antiga exceder o SLO definido no ADR. Ausência de runs novas não é falha.

### 7.4. Readiness

`/readiness` é protegido pelo Access e retorna HTML ou JSON sanitizado. Probes em paralelo:

| Dependência      | Probe                            | Timeout | Falha      |
| ---------------- | -------------------------------- | ------: | ---------- |
| D1               | `SELECT 1`                       |      1s | `degraded` |
| RPC              | `pingV1()` no entrypoint nomeado |      2s | `degraded` |
| Analytics Engine | query constante/`SHOW TABLES`    |      5s | `unknown`  |
| Queue metrics    | metrics endpoint                 |      3s | `unknown`  |

Deadline total: 5 segundos. Uma dependência opcional indisponível não remove dados exatos já carregados. Não testar Sandbox para evitar custo/wakeup. Não incluir response bodies externos nos diagnósticos.

## 8. RPC e privacidade

### 8.1. Entrypoint versionado

Implementar no control plane:

```typescript
export class AdminReadEntrypoint extends WorkerEntrypoint<ControlPlaneEnv> {
  public async pingV1(): Promise<{ readonly schemaVersion: 1 }> {
    return { schemaVersion: 1 };
  }

  public async getRunDetailV1(
    request: unknown,
  ): Promise<AdminRunDetailV1 | null> {
    const { runId } = adminReadRequestV1Schema.parse(request);
    const prKey = derivePrKeyFromRunId(runId);
    const stub = this.env.REVIEW_LEDGERS.getByName(prKey);
    const detail = await stub.getSanitizedAdminRunDetailV1(runId);
    return detail === null ? null : adminRunDetailV1Schema.parse(detail);
  }
}
```

O browser passa somente `runId`. O loader do admin valida o parâmetro, chama o service binding com timeout de 5 segundos e valida a resposta. O método confirma que o run pertence ao ledger derivado. Nenhum método é exportado pelo `fetch` público do control plane.

### 8.2. CI estruturado

O ledger atual persiste CI como markdown. Não parsear esse markdown para o console.

Antes de expor `structuredCi`:

1. ampliar `CiEvidenceLedger` para persistir um resumo estruturado allowlisted junto do markdown existente;
2. manter o markdown apenas para o fluxo atual de publicação;
3. armazenar contagens, status, duração e workflow name truncado;
4. não persistir failure messages, excerpts ou conteúdo de arquivo no resumo administrativo;
5. migrar o schema SQLite do ledger de forma aditiva e idempotente;
6. retornar `structuredCi = null` para runs antigas sem resumo.

### 8.3. Sanitização server-side

Não prometer redaction absoluta. A política é defesa em profundidade:

1. selecionar campos por allowlist;
2. rejeitar campos não previstos;
3. limitar entrada antes de regex para custo previsível;
4. remover controles ASCII, escapes ANSI e caracteres invisíveis perigosos;
5. aplicar redaction com padrões lineares revisados;
6. truncar por bytes UTF-8 sem cortar sequência multibyte;
7. validar o DTO final;
8. renderizar como texto React, nunca HTML/markdown.

Não usar regex para “remover HTML”; texto escapado é seguro e preserva o diagnóstico. `dangerouslySetInnerHTML` deve ser proibido pelo lint e por busca de verificação. Redaction ocorre antes do truncamento final para evitar fragmentar um segredo conhecido.

Feedback humano arbitrário não entra na V1 do DTO. Expor apenas contagens/labels agregados se necessário.

## 9. Segurança de borda

### 9.1. Wrangler

O Custom Domain usa hostname sem `/*`:

```jsonc
{
  "workers_dev": false,
  "preview_urls": false,
  "routes": [
    { "pattern": "<admin-staging.example.com>", "custom_domain": true },
  ],
}
```

Produção usa outro arquivo/env e `<admin.example.com>`. Substituir placeholders somente após confirmar a zona real. Não comitar domínio privado não autorizado.

O Worker de staging também fica atrás de uma Access Application própria. Como Preview URLs estão desligadas, o live smoke ocorre no Custom Domain de staging, não em Preview URL.

### 9.2. Access JWT

Middleware server-side obrigatório antes de loaders e endpoints:

- ler `Cf-Access-Jwt-Assertion`;
- rejeitar ausência com `401`;
- validar RS256, issuer, `exp`, `nbf` e audience esperada;
- aceitar `aud` string ou array somente quando contém `ACCESS_AUD`;
- exigir e-mail normalizado no domínio corporativo configurado;
- rejeitar `payload.type === "app"` para sessão humana;
- em `unknown kid`, invalidar cache e tentar um único refresh do JWKS;
- limitar timeout e tamanho da resposta JWKS;
- falhar fechado quando não houver chave válida;
- não logar JWT, cookie, email completo ou JWKS body;
- aplicar `Cache-Control: private, no-store` também em 401/403/500.

Testes usam um JWKS local e tokens assinados durante o teste. Não criar `AUTH_DISABLED=true` em código de produção.

### 9.3. CSP e headers

Gerar nonce criptograficamente aleatório por resposta SSR e propagar o mesmo valor ao React Router e ao `CSPProvider` do Base UI.

```text
default-src 'self';
script-src 'self' 'nonce-{NONCE}';
style-src-elem 'self' 'nonce-{NONCE}';
style-src-attr 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'self';
```

Analytics Engine e Queue APIs são chamadas pelo Worker; não adicionar `api.cloudflare.com` ao `connect-src` do navegador.

Aplicar também:

- `Referrer-Policy: no-referrer`;
- `X-Content-Type-Options: nosniff`;
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`;
- `Cross-Origin-Opener-Policy: same-origin` quando compatível com o login Access;
- assets hasheados com cache público imutável;
- HTML e dados com `private, no-store, must-revalidate`.

Testar o HTML SSR construído para garantir que tags inline emitidas por React Router/Base UI recebam nonce. `style-src-attr 'unsafe-inline'` é uma exceção consciente para estilos de posicionamento/dimensões; documentar no ADR.

## 10. Runtime full-stack do `apps/admin`

### 10.1. Composição do Worker

Partir do template oficial React Router v8/Cloudflare Vite e preservar `workers/app.ts`. O default export precisa compor três handlers:

```typescript
export default {
  fetch: reactRouterFetchHandler,
  queue: consumeAdminProjectionBatch,
  scheduled: runAdminRetention,
} satisfies ExportedHandler<AdminEnv, AdminRunProjectionEventV1>;
```

O snippet é estrutural; usar a assinatura exata gerada pelas versões fixadas. Não criar dois default exports nem um Worker separado apenas para a Queue sem novo ADR.

Adicionar um teste de integração que prove que `fetch`, `queue` e `scheduled` coexistem no mesmo módulo construído.

### 10.2. Dependências e versões

Resolver versões compatíveis no início da implementação e então fixá-las sem `^` ou `~` no catálogo, respeitando `saveExact: true` e `strictPeerDependencies: true`.

Dependências esperadas:

- `react`, `react-dom`, `react-router` v8;
- `@cloudflare/vite-plugin`;
- `vite`;
- `@base-ui/react`;
- `tailwindcss` e `@tailwindcss/vite`;
- `recharts`;
- biblioteca JWT revisada (`jose`, salvo decisão diferente documentada);
- Testing Library, Axe e Playwright como dev dependencies.

Executar resolução de peers, audit e build mínimo antes de implementar componentes. Registrar versões e data de verificação em pesquisa datada. Não adicionar Agents SDK ou `@cloudflare/think`.

## 11. Design system `@holon/ui`

### 11.1. Fronteira do pacote

`packages/ui` é genérico e não importa `@holon/domain`, `@holon/contracts` ou apps. Componentes de domínio ficam em `apps/admin/app/features/reviews`.

Exports explícitos:

- `button`, `icon-button`, `badge`, `card`, `metric-card`;
- `dialog`, `drawer`, `select`, `tabs`;
- `table`, `skeleton`, `empty-state`, `chart-frame`;
- `theme.css`.

Configurar:

```json
{
  "sideEffects": ["./src/styles/theme.css", "**/*.css"]
}
```

Em `apps/admin/app/styles.css`:

```css
@import "tailwindcss" source(none);
@source ".";
@source "../../../packages/ui/src";
```

Usar classes completas em mapas de variantes. Não construir `bg-${color}` ou equivalentes.

### 11.2. Tokens e direção visual

Definir tokens semânticos, sem espalhar cores diretas pelos componentes:

- canvas, surface, surface-hover, border, focus-ring;
- text-primary, text-secondary, text-muted;
- accent e accent-contrast;
- success, warning, danger, info e respectivos backgrounds;
- chart-1 a chart-5;
- radius-sm/md/lg/xl;
- shadow-card e shadow-overlay;
- durations fast/normal/slow.

Direção V1:

- light-first;
- system font stack, sem fontes externas;
- números com `tabular-nums`;
- monoespaçada apenas para IDs e SHAs;
- cards com raio consistente e micro-bordas;
- sombras discretas;
- no máximo duas séries simultâneas em gráfico de linha;
- `monotoneX` apenas para métricas contínuas;
- animações desativadas com `prefers-reduced-motion`;
- skeleton com dimensões idênticas ao conteúdo final.

### 11.3. Acessibilidade de gráficos

Todo gráfico deve possuir:

- título e descrição associados;
- legenda textual;
- resumo do insight sem depender de cor;
- tabela ou lista acessível com os mesmos valores;
- paleta com contraste e símbolos/labels redundantes;
- tooltip acessível por teclado quando aplicável;
- fallback vazio e indisponível;
- domínio do eixo que não distorça comparação.

Lazy-load de Recharts deve usar fallback com altura fixa e ser validado em SSR/hidratação. Não afirmar CLS zero sem medição no browser.

## 12. Rotas e comportamento de UI

### 12.1. `/`

- período fechado `24h | 7d | 30d`, refletido na URL;
- quatro métricas exatas do D1;
- tendência p50/p95 aproximada da Analytics Engine;
- distribuição de vereditos exata do D1;
- tabela de runs recentes;
- “Dados disponíveis desde …”;
- última run projetada;
- banner degradado isolado por dependência.

### 12.2. `/runs`

- filtros em URL por repository ID, terminal state, verdict e período;
- busca estruturada conforme seção 5.3;
- paginação keyset assinada;
- loaders validam query params e aplicam defaults fechados;
- filtros inválidos retornam erro de validação amigável, não SQL vazio;
- estado vazio distingue “sem runs no período” de “filtros sem resultado”.

### 12.3. `/runs/:runId`

- `runId` é URL-encoded e validado por `runIdSchema`;
- desktop usa nested route/drawer preservando a listagem ao fechar;
- mobile usa página completa;
- back/forward restaura corretamente o drawer;
- foco entra no drawer e retorna ao acionador;
- RPC só ocorre ao abrir a run;
- erro RPC não apaga a linha/listagem D1;
- telemetria histórica é separada visualmente dos findings atuais.

### 12.4. Estados obrigatórios

Cada bloco assíncrono possui estados independentes:

- loading;
- success;
- empty;
- partial/degraded;
- unavailable;
- validation error.

Não bloquear toda a página por falha da Analytics Engine ou Queue Metrics.

## 13. Plano de testes

### 13.1. Camadas

| Camada                | Prova                                                   | Não prova                             |
| --------------------- | ------------------------------------------------------- | ------------------------------------- |
| unitária pura         | schemas, hash, cursor, redaction, query builders        | bindings ou browser                   |
| Vitest Cloudflare     | D1, Queue handler, RPC, middleware, handlers combinados | Access real ou layout                 |
| Testing Library       | contrato de componentes e estados visíveis              | layout/browser real                   |
| Playwright            | navegação, foco, SSR, responsividade e regressão visual | recursos Cloudflare reais sem staging |
| live smoke autorizado | hostname, Access, bindings e APIs reais                 | cobertura completa de regras          |

Axe é complemento automatizado e não comprova sozinho conformidade WCAG 2.2 AA.

### 13.2. Matriz mínima de backend/infra

- evento válido em todos os terminal states;
- obsolete antes de análise com campos nulos honestos;
- relações inválidas entre runId, prKey e SHA;
- canonicalização independente da ordem de chaves;
- retry do Workflow envia envelope byte-equivalente;
- send confirmado + falha antes de completar task causa reenvio seguro;
- falha de projeção não impede cleanup;
- alarm prioriza cleanup e depois projeção;
- backoff e transição para exhausted;
- duplicata idêntica no D1 é no-op;
- mesma run com hash divergente vai para quarentena;
- payload inválido sem eventId/runId/schemaVersion é quarentenável;
- falha ao gravar quarentena causa retry, não ack;
- batch misto não repete mensagens já reconhecidas;
- cursor alterado, expirado, com filtro diferente ou chave antiga;
- queries usam bind parameters;
- retenção remove apenas registros vencidos e respeita limite de batch;
- RPC deriva prKey do runId e recusa inconsistência;
- response RPC é validada nos dois lados;
- CI antigo sem resumo estruturado retorna null;
- Analytics/Queue API inválida ou lenta degrada apenas seu widget;
- nenhuma mensagem de erro externa alcança logs ou browser.

### 13.3. Matriz mínima de UI/browser

- carregamento, sucesso, vazio, parcial e erro por widget;
- filtros sobrevivem a reload e back/forward;
- resposta antiga não sobrescreve filtro mais recente;
- drawer addressable abre/fecha e restaura foco;
- teclado completo em Select, Tabs, Dialog e Drawer;
- 320px, tablet, desktop e ultrawide sem overflow horizontal indevido;
- zoom 200%;
- reduced motion;
- contraste automatizado + revisão visual;
- hidratação sem warnings;
- CSP bloqueia script sem nonce e aceita o build real;
- screenshot regression dos principais estados;
- tabela acessível equivalente aos gráficos;
- bundle não inclui secrets, bindings ou módulos server-only.

### 13.4. Disciplina dos testes

- `userEvent.setup()` novo por teste;
- router/cache/handlers novos por teste;
- requests interceptados na fronteira de rede, sem mockar o hook sob teste;
- nenhum sleep arbitrário;
- assertions por role/name e consequências públicas;
- erro inclui ausência explícita de estado de sucesso contraditório;
- fixtures diferenciam filtros e ordenação;
- nenhum snapshot gigante de DOM;
- testes de browser usam contextos isolados;
- relatar exatamente o que foi e não foi executado.

## 14. Fases de implementação

### Fase 0 — Preflight e decisão

- confirmar estado Git e próximo ADR;
- validar versões atuais e peers;
- criar pesquisa datada com fontes primárias;
- escrever ADR e atualizar índices/arquitetura;
- decidir nomes reais de ambientes sem criar recursos.

Gate: ADR revisado; nenhum código de produção iniciado antes disso.

### Fase 1 — Contratos e políticas puras

- implementar `admin-projection.ts`;
- implementar `admin-run-detail.ts`;
- implementar canonicalização/hash;
- implementar cursor HMAC/keyring;
- adicionar exports e testes puros.

Gate: testes focados, lint e typecheck dos pacotes verdes.

### Fase 2 — Skeleton do `apps/admin`

- scaffold pelo template oficial React Router v8/Cloudflare;
- adaptar ao monorepo sem scripts duplicados;
- compor `fetch`, `queue` e `scheduled` em `workers/app.ts`;
- configurar bindings tipados e ambientes local/staging/production;
- criar migration D1;
- validar Wrangler dry-run sem deploy.

Gate: build local, types gerados e teste de coexistência dos handlers.

### Fase 3 — D1 e Queue consumer

- implementar adapter D1;
- implementar algoritmo imutável do consumidor;
- implementar quarentena segura;
- implementar paginação e filtros;
- implementar retenção agendada;
- executar migrations local/preview isolado, sem produção.

Gate: matriz D1/Queue focada verde e migration reproduzível do zero.

### Fase 4 — Control plane producer, outbox e RPC

- adicionar binding producer;
- persistir timestamps necessários em todos os caminhos terminais;
- adicionar `projection_tasks` ao ledger;
- multiplexar alarm sem regressão de cleanup;
- implementar build/send/complete da projeção;
- implementar RPC V1 e CI estruturado;
- atualizar testes do Workflow, ledger e RPC.

Gate: falhas de projeção não mudam outcome nem cleanup da review.

### Fase 5 — Design system

- criar `packages/ui` e exports;
- implementar tokens e componentes genéricos;
- documentar props e estados;
- testes de componente e acessibilidade automatizada;
- prova de scan Tailwind no build consumidor.

Gate: pacote não depende de domínio e todas as classes aparecem no CSS final.

### Fase 6 — Rotas e visualização

- implementar loaders/actions somente read-only;
- implementar dashboard e runs;
- implementar drawer/page de detalhe;
- integrar D1, Analytics e RPC com falhas independentes;
- implementar equivalentes textuais dos gráficos;
- medir bundle e comportamento de hidratação.

Gate: jornadas críticas em Playwright e regressão visual verdes.

### Fase 7 — Segurança e operação

- implementar Access middleware e JWKS;
- implementar CSP nonce e headers;
- implementar adapters Analytics/Queue Metrics;
- implementar readiness;
- implementar CLI de DLQ;
- escrever runbooks de provisionamento, replay, retenção, rotação e incidentes.

Gate: testes de segurança, CLI dry-run e revisão de secrets/bundle verdes.

### Fase 8 — Verificação completa

Executar na ordem:

1. testes focados alterados;
2. suites dos workspaces afetados;
3. `pnpm format:check`;
4. `pnpm lint`;
5. `pnpm typecheck`;
6. `pnpm test`;
7. `pnpm test:coverage`;
8. Playwright;
9. `pnpm build` com Docker disponível;
10. `pnpm verify`.

Não excluir produção da cobertura. Separar falhas baseline de regressões introduzidas.

## 15. Provisionamento e rollout autorizados

O código deve estar mergeável sem efeitos externos. Após autorização explícita, executar em staging:

1. criar D1, Queue, DLQ e datasets;
2. configurar retenção da Queue e DLQ;
3. habilitar pull consumer apenas na DLQ;
4. configurar secrets e vars de staging;
5. aplicar migration D1;
6. implantar `apps/admin` com consumer e Custom Domain de staging protegido pelo Access;
7. implantar control plane com RPC/outbox, mas producer desabilitado por flag de rollout;
8. validar Access, CSP, D1, RPC e Queue consumer;
9. habilitar producer;
10. executar uma run sintética/autorizada e confirmar projeção;
11. simular duplicata, falha transitória e replay controlado;
12. confirmar métricas, logs sem conteúdo sensível e cleanup;
13. somente então repetir em produção.

O smoke live deve registrar data, ambiente, comandos e limites da evidência. Nunca afirmar validação live se apenas mocks/local foram executados.

### 15.1. Rollback

1. desabilitar producer por configuração/flag;
2. preservar Queue, DLQ e D1 para recuperação;
3. reverter control plane para versão sem emissão;
4. desabilitar rota/Custom Domain do admin se necessário;
5. não executar down migration destrutiva;
6. documentar mensagens pendentes e plano de replay;
7. manter o Access ativo enquanto o hostname responder.

## 16. Definition of Done

A implementação só está concluída quando:

1. ADR e documentação arquitetural correspondem ao código.
2. Contratos V1 são estritos, exportados e testados.
3. Todos os terminal paths geram snapshot honesto, inclusive obsolete precoce.
4. Falha de projeção não altera outcome nem cleanup.
5. Outbox possui retry descobrível por alarm e estado exhausted observável.
6. D1 é imutável por run: duplicata idêntica é no-op e divergência é quarentena.
7. Quarentena nunca armazena payload bruto.
8. DLQ replay é dry-run por padrão e foi testado sem imprimir bodies.
9. Browser recebe somente DTO allowlisted e sanitizado.
10. RPC é read-only, versionado e não possui rota HTTP pública.
11. Analytics Engine é apresentada como aproximada; totais financeiros vêm do D1.
12. Freshness usa backlog/idade, não apenas ausência de runs.
13. `workers_dev` e `preview_urls` estão explicitamente falsos.
14. Custom Domain está protegido pelo Access antes da exposição.
15. CSP do build real não apresenta violações inesperadas.
16. UI funciona em 320px, zoom 200%, teclado e reduced motion.
17. Gráficos têm equivalente textual e estados degradados independentes.
18. Nenhum secret, binding ou módulo server-only aparece no client bundle.
19. Thresholds permanecem em 85% branches e 90% functions/lines/statements.
20. `pnpm verify` passa; browser e live smoke são reportados separadamente.
21. Rollout e rollback foram documentados antes de produção.
22. A worktree termina sem mudanças não relacionadas introduzidas pelo agente.

## 17. Fontes externas verificadas

Verificação: 2026-09-04.

- [Cloudflare React Router v8](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)
- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Workflows retries](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Cloudflare Queues batching e retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Cloudflare Queue pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/)
- [Cloudflare Queue metrics](https://developers.cloudflare.com/queues/observability/metrics/)
- [Cloudflare Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
- [Querying Analytics Engine from a Worker](https://developers.cloudflare.com/analytics/analytics-engine/worker-querying/)
- [Base UI CSPProvider](https://base-ui.com/react/utils/csp-provider)
- [Tailwind CSS source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files)
