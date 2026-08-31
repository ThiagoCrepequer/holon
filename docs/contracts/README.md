---
id: CONTRACTS-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-08-30
---

# Contratos

Os contratos executáveis ficam em `packages/contracts/src` e usam Zod 4 com
objetos estritos. TypeScript deriva os tipos dos mesmos schemas usados em
runtime; não há uma segunda cópia JSON Schema para divergir.

## Contratos implementados

| Modulo             | Contratos principais                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| `webhook.ts`       | Envelope GitHub v1 e job associado a repo, PR e head SHA                    |
| `executor.ts`      | Pedido exact-SHA com diff canônico, contexto limitado, tools e resultados   |
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

O pedido do executor aceita no máximo 2 MB de diff canônico bruto na fronteira;
portanto, o request precede a classificação e pode conter seções que serão
excluídas. O contexto persistido seleciona até 50 patches textuais elegíveis,
120 kB e 5.000 linhas alteradas. Cada arquivo registra modo `structural` para
JS/TS ou `textual` para os demais formatos. Binários, lockfiles, artefatos
gerados e caminhos potencialmente sensíveis reconhecidos pelas heurísticas não
entram nesse contexto nem são enviados ao modelo. A mesma política autoriza
paths e resultados das tools. A saída contém até três findings, duas evidências
por finding e um resumo de até 800 caracteres.

`read_file` aceita uma janela inclusiva de no máximo 500 linhas. Depois de
resolver e autorizar o path real, o executor traduz essa janela para um comando
`sed` construído pelo host dentro do container. O resultado é limitado a 100 kB
e informa truncamento; o Worker não lê nem materializa o arquivo completo.
