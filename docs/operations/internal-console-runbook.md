---
id: OPERATIONS-INTERNAL-CONSOLE-RUNBOOK
kind: runbook
status: current
owners:
  - core-team
last-reviewed: 2026-09-04
---

# Runbook de Operação do Console Interno

Este runbook orienta a equipe de engenharia e sustentação na resposta a incidentes, reprocessamento de Dead Letter Queue (DLQ), rotação de chaves criptográficas e políticas de retenção de dados do Console Operacional Interno do Holon.

> [!NOTE]
> Verificado em 2026-09-04. Acesso ao console e aos endpoints é estritamente de leitura (read-only); operações mutantes de infraestrutura devem ser executadas via CLI autorizado fora do runtime do Worker.

---

## 1. Resposta a Incidentes

### 1.1. Alerta de Degradação na Interface

Quando qualquer subsistema apresentar anomalias, um banner de alerta vermelho/âmbar será renderizado no topo de todas as páginas do console:
`Atenção: O sistema está operando em modo degradado. Algumas informações podem estar desatualizadas ou indisponíveis.`

### 1.2. Diagnóstico via Endpoint de Prontidão

Para inspecionar o status exato de cada subsistema:

```bash
curl -H "cf-access-jwt-assertion: <SEU_TOKEN_ACCESS>" \
     -H "Accept: application/json" \
     https://admin.holon.internal/readiness
```

Exemplo de resposta de diagnóstico:

```json
{
  "status": "degraded",
  "timestamp": "2026-09-04T12:00:00.000Z",
  "checks": {
    "d1": "healthy",
    "rpc": "degraded",
    "analyticsEngine": "healthy",
    "queueMetrics": "degraded"
  }
}
```

### 1.3. Matriz de Tratamento de Subsistemas

| Subsistema            | Sintoma                               | Causa Provável                                                          | Ação Operacional                                                                                                                         |
| :-------------------- | :------------------------------------ | :---------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 Database**       | `checks.d1 == "degraded"`             | Timeout na query `SELECT 1` ou indisponibilidade regional D1.           | Verificar status da Cloudflare. Confirmar binding `DB` em `wrangler.jsonc`.                                                              |
| **Control Plane RPC** | `checks.rpc == "degraded"`            | Binding `ADMIN_READ_API` desconectado ou versão de schema incompatível. | Verificar se o Worker `apps/control-plane` está deployado e se o método `pingV1()` responde com schema version 1.                        |
| **Queue Metrics**     | `checks.queueMetrics == "degraded"`   | Mensagens acumuladas na DLQ (`dlqCount > 0`) ou backlog alto (`> 100`). | Inspecionar a DLQ usando o CLI de replay. Avaliar erros no consumer de projeções.                                                        |
| **Analytics Engine**  | `checks.analyticsEngine == "unknown"` | Credenciais `CF_ANALYTICS_API_TOKEN` ou `CF_ACCOUNT_ID` ausentes.       | O console continuará operando normalmente exibindo apenas métricas do D1. Configure o segredo se desejar tendências de latência p50/p95. |

---

## 2. Reprocessamento de Mensagens da DLQ

Mensagens chegam à fila `holon-admin-projections-dlq` quando:

1. O payload do evento não passa na validação Zod do `AdminRunProjectionEventV1`;
2. A integridade do hash HMAC falha contra a assinatura enviada;
3. Ocorreram 5 falhas consecutivas de inserção no banco D1.

> [!CAUTION]
> Mensagens com schemas corrompidos ou chaves de assinatura inválidas continuarão falhando se reprocessadas. Sempre investigue o log da quarentena (`admin_projection_quarantine`) antes de disparar o replay massivo.

### 2.1. Inspeção Prévia (Dry-Run)

O CLI opera em modo `--dry-run` por padrão. Nenhuma mensagem é removida da DLQ ou reenviada:

```bash
# Executa em modo de inspeção (mostra quantidade de mensagens pendentes)
CF_ACCOUNT_ID="<ID_CONTA>" \
CF_QUEUES_REPLAY_TOKEN="<TOKEN_COM_QUEUE_READ_WRITE>" \
pnpm --filter @holon/admin-cli run replay:dlq --dry-run
```

### 2.2. Execução do Replay Bounded

Para reprocessar mensagens efetivamente, a flag `--execute` e a flag explícita `--limit <1..1000>` são obrigatórias:

```bash
# Reprocessa até 50 mensagens em lotes de 10
CF_ACCOUNT_ID="<ID_CONTA>" \
CF_QUEUES_REPLAY_TOKEN="<TOKEN_COM_QUEUE_READ_WRITE>" \
pnpm --filter @holon/admin-cli run replay:dlq \
  --execute \
  --limit 50 \
  --batch-size 10 \
  --visibility-timeout 300
```

Garantias de segurança do replay:

- Uma mensagem só é confirmada com **ACK** na DLQ após a confirmação de entrega bem-sucedida na fila principal.
- Mensagens que falharem no reenvio não recebem ack e continuam na DLQ.
- Corpos de mensagens e tokens nunca são impressos nos logs do console.

---

## 3. Rotação de Chaves Criptográficas

### 3.1. Rotação do Keyring de Cursores (`ADMIN_CURSOR_HMAC_KEYS`)

O console utiliza assinaturas HMAC SHA-256 para prevenir adulteração de cursores de paginação (`keyset pagination`). O sistema suporta um keyring duplo (`primary` e `secondary`), permitindo rotação com zero downtime.

#### Passo a Passo para Rotação:

1. Gere uma nova chave de 32 bytes em formato hexadecimal:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Monte o payload JSON contendo a nova chave como `primary` e a chave atual como `secondary`:
   ```json
   {
     "primary": {
       "kid": "cursor-key-2026-q4",
       "secretHex": "<NOVO_HEX_32_BYTES>"
     },
     "secondary": {
       "kid": "cursor-key-2026-q3",
       "secretHex": "<HEX_ATUAL>"
     }
   }
   ```
3. Atualize o segredo no Worker `apps/admin`:
   ```bash
   wrangler secret put ADMIN_CURSOR_HMAC_KEYS
   ```
4. Após 24 horas (tempo limite para expiração natural de cursores abertos em navegadores de usuários), remova o bloco `secondary` e atualize o segredo mantendo apenas a chave `primary`.

### 3.2. Rotação da Chave de Assinatura de Projeção (`ADMIN_PROJECTION_HMAC_KEY`)

Chave compartilhada entre o outbox do `apps/control-plane` e a verificação no `apps/admin`:

1. Gere um novo segredo hexadecimal de 32 bytes:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Atualize no `apps/control-plane`:
   ```bash
   wrangler secret put ADMIN_PROJECTION_HMAC_KEY
   ```

---

## 4. Retenção e Manutenção de Dados

### 4.1. Limpeza Automática via Cron

O Worker `apps/admin` possui um disparador agendado (`cron = "0 3 * * *"`, diariamente às 03:00 UTC) que executa `cleanupRetention()` no D1:

- **Tabela `admin_runs`**: Registros com `terminal_at_epoch_ms` anterior a **180 dias** são expurgados em lotes de até 500 registros por execução.
- **Tabela `admin_projection_quarantine`**: Eventos descartados ou com falha com mais de **30 dias** são expurgados em lotes de até 500 registros por execução.

### 4.2. Purga Manual Sob Demanda

Caso seja necessário forçar uma limpeza fora do horário agendado:

```bash
# Execução direta via Wrangler D1 no ambiente remoto
wrangler d1 execute holon-admin --remote --command="
  DELETE FROM admin_runs
  WHERE terminal_at_epoch_ms < strftime('%s', 'now', '-180 days') * 1000;
"
```
