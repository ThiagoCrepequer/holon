---
id: PLAN-MVP-001
kind: planning
status: current
owners:
  - core-team
last-reviewed: 2026-08-31
related:
  - ../product/mvp-scope.md
  - ../decisions/0001-adopt-incremental-mvp-architecture.md
  - ../decisions/0002-adopt-typescript-monorepo-toolchain.md
  - ../decisions/0003-adopt-initial-typescript-application-stack.md
  - ../decisions/0013-use-tiered-structural-and-textual-review.md
  - technical-bootstrap.md
---

# Plano de entrega do MVP

O plano privilegia provas baratas antes de integrações caras. As fases 0 a 5
possuem implementação e provas locais. A fase 5 foi parcialmente comprovada em
ambiente remoto com zero finding, um finding inline e encerramento parcial de PR
grande; os demais cenários e o piloto da fase 6 ainda não foram executados.

O [estado do bootstrap técnico](technical-bootstrap.md) registra as provas e os
limites atuais.

| Fase             | Estado atual                                              |
| ---------------- | --------------------------------------------------------- |
| 0 — contratos    | Implementada; corpus representativo ainda precisa crescer |
| 1 — entrada      | Implementada e testada em Workerd                         |
| 2 — idempotência | Implementada com Workflow + Durable Object SQLite         |
| 3 — analisador   | Implementada; imagem e CLIs validadas localmente          |
| 4 — motor        | Implementada com schemas, budgets e AI Gateway atual      |
| 5 — publicação   | Parcialmente comprovada com GitHub e Cloudflare reais     |
| 6 — piloto       | Não iniciada                                              |

## Fase 0 — Contratos e conjunto de avaliação

- Definir o envelope normalizado do webhook.
- Definir `ReviewRun`, `Finding`, `Publication` e tool calls.
- Montar corpus de PRs positivos e negativos para avaliação.
- Definir métricas iniciais de precisão, falsos positivos e custo.
- Aplicar a decisão de review estrutural JS/TS, review textual elegível e
  exclusões heurísticas do piloto.

Saída: contratos versionados e avaliação reproduzível sem Cloudflare.

## Fase 1 — Entrada GitHub

- Registrar GitHub App de desenvolvimento com menor privilégio.
- Implementar validação do corpo bruto e HMAC.
- Filtrar ações de `pull_request` suportadas.
- Enfileirar envelope sem credenciais.
- Provar redelivery e payload inválido.

Saída: webhook responde rapidamente e cada entrega válida chega ao consumidor.

## Fase 2 — Idempotência e coordenação

- Prototipar Workflow com ID composto e etapas reiniciáveis.
- Simular duplicata, retry, timeout ambíguo e head SHA obsoleto.
- Comparar ledger em Workflow, Durable Object SQLite e D1.
- Registrar a escolha em novo ADR.

Saída: nenhuma simulação produz publicação duplicada.

## Fase 3 — Analisador de repositório

- Definir porta read-only do `RepositoryAnalyzer`.
- Fazer spike do Sandbox com repositório sintético malicioso.
- Medir startup, clone, buscas, parser, limites, limpeza e custo.
- Implementar alternativa mínima se Sandbox falhar nos critérios.

Saída: evidência recuperável com proveniência e isolamento demonstrado.

## Fase 4 — Motor de review

- Implementar surface mapping determinístico.
- Expor ferramentas mínimas e tipadas.
- Integrar AI Gateway com orçamento e metadados de run.
- Validar saída do modelo contra schema e diff.
- Executar corpus de avaliação e registrar resultados.

Saída: findings estruturados sem publicação externa.

Estado local: surface mapping, parser de unified diff, classificação estrutural
ou textual, exclusões heurísticas, redaction, budgets e schemas estão
implementados. O corpus de avaliação e suas métricas permanecem pendentes
porque dependem de casos representativos aprovados.

## Fase 5 — Publicação controlada

- Revalidar head SHA e coordenadas.
- Publicar review em repositório de teste.
- Reconciliar timeout e secondary rate limit.
- Registrar IDs externos e resumo único.
- Executar end-to-end com zero, um e múltiplos findings.

Saída: fatia vertical completa e auditável.

Estado remoto: o [smoke de 2026-08-31](../research/2026-08-31-live-github-app-review-smoke.md)
comprovou publicação com zero e um finding e bounded completion de um PR grande.
Redelivery, head obsoleto, múltiplos findings, falhas ambíguas e rate limits
continuam pendentes; portanto a saída da fase ainda não foi atingida por
completo.

## Fase 6 — Piloto restrito

- Habilitar poucos repositórios consentidos.
- Coletar aprovação/rejeição humana de findings.
- Medir custo por run, latência e falhas por etapa.
- Revisar retenção e privacidade antes de ampliar acesso.

Saída: decisão informada sobre evolução para conversa, RAG e escala.

## Capacidade posterior

Após o MVP, uma decisão separada pode introduzir Agents SDK e
`@cloudflare/think` para respostas em comentários, memória por PR e loops
resumíveis. Isso não deve bloquear as fases anteriores.
