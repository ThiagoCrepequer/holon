---
id: ADR-0021
kind: decision
status: accepted
date: 2026-09-02
owners:
  - core-team
related:
  - 0001-adopt-incremental-mvp-architecture.md
  - 0016-require-complete-patches-and-host-verifiable-evidence.md
  - 0018-adopt-two-phase-decoupled-review-generator.md
  - 0019-derive-deterministic-review-verdict-by-policy.md
  - 0020-reconcile-findings-across-commits-with-stable-fingerprints.md
  - ../architecture/review-runtime-flow.md
  - ../planning/review-core-evolution-roadmap.md
---

# Capturar feedback humano, comandos de dispensa e sinais de calibração

## Contexto e problema

O Holon analisa Pull Requests, emite apontamentos analíticos e deriva vereditos determinísticos de aprovação ou solicitação de alterações (ADR-0019, ADR-0020). Contudo, a interação entre o agente e os desenvolvedores era estritamente unidirecional:

1. **Falta de canal para sinalizar falsos positivos**: Se o modelo emitisse uma análise incorreta ou alucinada com severidade alta/crítica, o PR ficava bloqueado em `REQUEST_CHANGES` a menos que o autor fizesse alterações desnecessárias no código ou ignorasse a ferramenta.
2. **Incapacidade de capturar utilidade (`helpful`)**: O sistema não possuía métricas estruturadas sobre quais apontamentos geraram valor real para a equipe de engenharia e quais foram ignorados.
3. **Ausência de dados de calibração**: Sem feedback humano categorizado, não era possível medir a taxa de falsos positivos ($FP / (TP + FP)$) por regra, por severidade ou por modelo, impedindo a melhoria sistemática dos prompts e analisadores.
4. **Desconexão com o sistema de avaliação**: Não havia um mecanismo padronizado para promover apontamentos contestados ou aprovados por humanos para o corpus versionado de regressão do Holon.

## Decisão

1. **Taxonomia Mínima de Rótulos de Feedback (SARIF / Industry Standard)**:
   - `helpful`: O apontamento é correto, acionável e ajudou a equipe.
   - `false_positive`: O código está correto; o apontamento decorreu de má interpretação semântica ou alucinação do modelo.
   - `wrong_severity`: O problema existe, mas a severidade foi superestimada (ex: cosmético marcado como `critical`) ou subestimada.
   - `duplicate`: O problema já foi apontado em outro comentário ou por outra ferramenta de CI.
   - `not_actionable`: O apontamento é genérico demais ou impraticável no contexto da alteração.
   - `missed_defect`: Defeito relevante no PR que o Holon não detectou (apontado pelo revisor humano).
   - `thread_resolved`: O autor resolveu a conversa nativamente no GitHub sem digitar um comando explícito.

2. **Comandos ChatOps na Thread do Comentário Inline (`pull_request_review_comment`)**:
   - Os desenvolvedores podem responder diretamente na thread do comentário gerado pelo Holon com sintaxe concisa:
     - `/holon dismiss false-positive [justificativa opcional]`
     - `/holon dismiss not-actionable [justificativa opcional]`
     - `/holon dismiss wrong-severity:<critical|high|medium|low> [justificativa]`
     - `/holon dismiss duplicate [justificativa]`
     - `/holon helpful` (ou `/holon accept` ou `👍` / `+1`)
   - Respostas a apontamentos gerais de PR (comentário de issue):
     - `/holon missed-defect <path>:<line> [descrição]`

3. **Status de Ciclo de Vida `DISMISSED` e Recálculo Determinístico de Veredito**:
   - Quando um finding recebe um comando de dispensa (`false_positive`, `not_actionable`, `duplicate`), seu status no ledger SQLite transiciona para `dismissed`.
   - Findings com status `dismissed` são **imediatamente excluídos da lista de defeitos bloqueadores ativos**.
   - O veredito do PR é deterministicamente recalculado segundo as políticas do ADR-0019:
     - Se o finding dispensado era o único bloqueador (`critical`/`high`), o veredito geral do PR transiciona automaticamente para **`APPROVE`**.
     - O Check Run do GitHub é atualizado via API REST para refletir a nova conclusão (`success` com título `Holon Review — Approved`).
     - O Holon publica uma resposta direta na thread confirmando a ação:
       `👀 Defeito dispensado como falso positivo. Veredito do PR recalculado para APPROVE.`

4. **Captura Nativa de Resolução de Threads (`pull_request_review_thread.resolved`)**:
   - O Holon escuta o webhook de resolução nativa de conversa do GitHub. Se a thread correspondente pertencer a um comentário inline do Holon, o evento é registrado no ledger como `thread_resolved`, permitindo medir a taxa de resolução voluntária.

5. **Persistência Estruturada e Sanitizada no SQLite do Durable Object (Migration 5)**:
   - Adicionar a tabela `finding_feedbacks` com chave primária autoincrementada, vinculada ao `pr_key`, `fingerprint`, `label`, `author_login`, `reason`, `github_comment_id` e `created_at`.
   - Em conformidade com as regras de governança de `AGENTS.md`, nenhum trecho de código-fonte arbitrário ou credencial é armazenado na tabela de feedbacks; apenas metadados relacionais e justificativas textuais sanitizadas.

6. **Métricas de Calibração e Promoção para Corpus de Avaliação (`@holon/evaluation`)**:
   - Disponibilizar funções de agregação de métricas:
     $$\text{False Positive Rate} = \frac{\text{Feedbacks FP}}{\text{Findings com Feedback}} \times 100\%$$
     $$\text{Utility Rate} = \frac{\text{Feedbacks Helpful}}{\text{Findings Totais}} \times 100\%$$
   - Permitir que casos com feedbacks confirmados (adjudicados) sejam exportados para o formato de caso de teste em `packages/evaluation/corpus/`.

7. **Autorização Obrigatória para Dispensas e Mitigação de Evasão de Segurança**:
   - Apenas usuários com `author_association` de mantenedor (`OWNER`, `MEMBER` ou `COLLABORATOR`) têm autorização para executar comandos de dispensa (`/holon dismiss ...`) ou resolver threads com efeito de dispensa de apontamentos.
   - Comentários de dispensa emitidos por autores não autorizados (como `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` ou `NONE`) são rejeitados com aviso informativo na thread, sem modificar o status do apontamento nem alterar o veredito do PR. Sinais não dispensatórios (`helpful`) são registrados normalmente para fins de calibração.

## Consequências

- **Positivas**:
  - Elimina o bloqueio indevido de PRs causado por eventuais falsos positivos do modelo, oferecendo uma válvula de escape técnica e auditável via ChatOps.
  - Oferece transparência total no Check Run do GitHub ao recalcular o veredito instantaneamente após a dispensa.
  - Alimenta a engenharia do Holon com métricas de qualidade e calibração objetivas baseadas na experiência real de uso dos desenvolvedores.
  - Fecha o ciclo virtuoso do sistema de avaliação com o corpus offline.
- **Negativas / Limitações**:
  - Requer que a GitHub App tenha permissão de leitura nos eventos de comentários de PR (`pull_request_review_comment`) e threads de revisão (`pull_request_review_thread`).
  - O webhook precisa autenticar a assinatura HMAC de cada requisição antes do parsing do comando para proteger contra spoofing.
