---
id: ARCH-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-09-10
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
- [Ingestão de evidências de CI](ci-evidence-ingestion.md): descrição histórica
  da funcionalidade retirada pela ADR-0049.

- [Dashboard dos usuários](user-dashboard.md): fundações locais SSR/API, UI, D1 e entrega privada; integrações futuras explicitadas.

## Regra de precedência

Se um desenho contradizer um ADR aceito, o ADR prevalece e o documento de
arquitetura deve ser corrigido.

- [Configuração imutável por run](../decisions/0037-compile-repository-configuration-per-run.md) e [operação](../operations/repository-configuration.md).

- [Memória incremental do repositório](repository-memory.md): captura, governança humana e snapshots de regras.
