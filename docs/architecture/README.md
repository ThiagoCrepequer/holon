---
id: ARCH-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-08-30
---

# Arquitetura

Os documentos deste diretório descrevem a arquitetura vigente. O código do MVP
materializa as decisões aceitas listadas no
[índice de ADRs](../decisions/README.md); limitações de validação remota
continuam explícitas nos documentos de operação e planejamento.

## Visões

- [Contexto do sistema](system-context.md): atores e sistemas externos.
- [Visão de containers](container-view.md): responsabilidades e fronteiras.
- [Ecossistema técnico](technical-ecosystem.md): toolchain, estrutura atual,
  dependências permitidas e alocação em deployables.
- [Fluxo de execução](review-runtime-flow.md): sequência de uma review.
- [Estado e idempotência](state-and-idempotency.md): identidade, concorrência e
  prevenção de duplicatas.
- [Segurança e trust boundaries](security-and-trust-boundaries.md): ameaças,
  privilégios e isolamento.
- [Ciclo de vida dos dados](data-lifecycle.md): classes de dados e retenção.
- [Ingestão de evidências de CI](ci-evidence-ingestion.md): consumo passivo de
  LCOV e JUnit XML via webhook desacoplado.

## Regra de precedência

Se um desenho contradizer um ADR aceito, o ADR prevalece e o documento de
arquitetura deve ser corrigido.
