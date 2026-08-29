---
id: CONTRACTS-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-08-29
---

# Contratos

Os contratos executáveis ficam em `packages/contracts/src` e usam Zod 4 com
objetos estritos. TypeScript deriva os tipos dos mesmos schemas usados em
runtime; não há uma segunda cópia JSON Schema para divergir.

## Contratos implementados

| Modulo             | Contratos principais                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| `webhook.ts`       | Envelope GitHub v1 e job associado a repo, PR e head SHA                    |
| `executor.ts`      | Pedido exact-SHA, contexto limitado, tool calls e resultados                |
| `review-output.ts` | Findings estruturados, evidências, resumo e registro de publicação          |
| `shared.ts`        | SHA, IDs, inteiros positivos e caminhos relativos normalizados reutilizados |

## Regras

- Schemas são independentes de SDK e provedor.
- Toda estrutura produzida por modelo é validada em runtime.
- Versões incompatíveis recebem novo identificador de schema.
- Campos desconhecidos são rejeitados nas fronteiras de segurança, salvo decisão
  explícita em contrário.
- Exemplos válidos e inválidos acompanham cada schema.
- Testes de contrato devem provar serialização, validação e compatibilidade.
