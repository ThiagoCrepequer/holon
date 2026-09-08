---
id: ADR-0020
kind: decision
superseded-by: 0034-make-review-checkpoints-and-revalidation-durable.md
status: superseded
date: 2026-09-02
owners:
  - core-team
related:
  - 0001-adopt-incremental-mvp-architecture.md
  - 0016-require-complete-patches-and-host-verifiable-evidence.md
  - 0018-adopt-two-phase-decoupled-review-generator.md
  - 0019-derive-deterministic-review-verdict-by-policy.md
  - ../architecture/review-runtime-flow.md
  - ../planning/review-core-evolution-roadmap.md
---

# Reconciliar findings entre commits via stable fingerprinting e ciclo de vida

## Contexto e problema

Até então, o Holon analisava cada execução de Pull Request de forma isolada e efêmera. A identidade do finding (`createFindingId(runId, ...)`) vinculava-se estritamente ao `runId` (que embute o `headSha`) e às coordenadas absolutas de linha (`startLine`, `endLine`).

Em fluxos reais de desenvolvimento colaborativo, o autor do PR responde às revisões realizando novos commits (`pull_request.synchronize`). Essa ausência de memória entre execuções causava quatro problemas severos:

1. **Invalidação de identidade por deslocamento de linha**: Se o autor inserisse linhas no topo do arquivo, a linha de um achado existente mudava (ex: de 45 para 55), gerando um novo hash de finding e perdendo o vínculo histórico.
2. **Poluição por comentários inline duplicados**: Findings persistentes ainda não corrigidos eram comentados repetidamente a cada push.
3. **Invisibilidade da resolução de defeitos**: Quando o autor corrigia o código, o Holon simplesmente deixava de emitir o finding, sem notificar a thread aberta de que o problema fora sanado.
4. **Veredito estagnado**: Um PR que recebeu `REQUEST_CHANGES` no primeiro commit não conseguia transicionar automaticamente para `APPROVE` após o autor resolver todos os apontamentos, pois o sistema não correlacionava o estado anterior com o atual.

## Decisão

1. **Identidade Estável por Fingerprint Canônico (SARIF-inspired)**:
   - Adotar um fingerprint determinístico independente de `runId` e de números de linha absolutos:
     $$\text{fingerprint} = \text{SHA-256}(\text{path} + \text{ruleIdOrCategory} + \text{normalizedExcerpt} + \text{normalizedDiagnostic})$$
   - O trecho de código (`excerpt`) é normalizado (removendo whitespace volátil e indentação variável) para garantir estabilidade mesmo se o arquivo for reformatado ou sofrer adição de linhas anteriores.
   - O formato canônico é `fp:[a-f0-9]{64}`.

2. **Ciclo de Vida Formal do Finding**:
   - Reconciliar os achados entre o baseline histórico do PR (carregado do ledger SQLite) e os achados da execução atual (`currentFindings`):
     - **`NEW`**: Achado detectado pela primeira vez neste commit/push.
     - **`PERSISTENT`**: Achado presente no baseline ativo que continua detectado no novo commit.
     - **`RESOLVED`**: Achado do baseline ativo que não é mais detectado no novo diff (o autor corrigiu o defeito).
     - **`OBSOLETE`**: Arquivo ou trecho que foi deletado ou amplamente refatorado fora do escopo do PR.
     - **`REINTRODUCED`**: Achado anteriormente marcado como `RESOLVED` que voltou a ser detectado em um commit posterior.

3. **Política de Publicação Idempotente no GitHub**:
   - **`NEW` e `REINTRODUCED`**: O Holon publica novos comentários inline na linha exata do novo commit e registra o `github_comment_id` no ledger.
   - **`PERSISTENT`**: O Holon **suprime a publicação de novo comentário inline**, preservando o comentário original já existente e evitando spam. O item é marcado como pendente no sumário geral.
   - **`RESOLVED`**: O Holon publica uma resposta direta na thread do comentário original no GitHub (ex: `✅ Corrigido no commit <sha>`) confirmando a correção e lista o item como resolvido no sumário.
   - **`OBSOLETE`**: O item é arquivado no histórico sem novos comentários.

4. **Integração com o Veredito Determinístico (ADR-0019)**:
   - Findings com status `RESOLVED` ou `OBSOLETE` **não contam como defeitos bloqueadores**.
   - Apenas findings ativos (`NEW`, `PERSISTENT`, `REINTRODUCED`) pontuam na política de veredito.
   - Se 100% dos findings anteriores estiverem `RESOLVED` e não houver novos bloqueadores, o veredito torna-se **`APPROVE`**, destravando o merge do PR.

5. **Persistência Durável no Ledger SQLite (`pr_findings`)**:
   - Implementar a Migration 4 no SQLite do Durable Object (`ReviewLedgerObject`) com a tabela `pr_findings`, indexada por `(pr_key, fingerprint)` e `(pr_key, status)`, armazenando `first_seen_head_sha`, `last_seen_head_sha`, `github_comment_id`, severidade e diagnóstico.

## Consequências

### Positivas

- **Zero Duplicação de Comentários**: O autor pode realizar dezenas de pushes sem sofrer comentários repetidos para o mesmo problema.
- **Feedback Construtivo**: O agente confirma e elogia explicitamente as correções implementadas pelo autor.
- **Desbloqueio Automático do PR**: O ciclo de review transiciona naturalmente de `REQUEST_CHANGES` para `APPROVE` conforme os problemas são sanados.
- **Auditoria Transparente**: Histórico completo de quando cada finding foi introduzido e resolvido no banco SQLite do PR.

### Negativas

- Requer consultas adicionais ao SQLite do Durable Object no início e no final do workflow (mitigado por índices dedicados e execução em sub-milissegundos local ao DO).
