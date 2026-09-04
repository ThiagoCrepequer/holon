---
id: CONTRACTS-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-09-04
---

# Contratos

Os contratos executáveis ficam em `packages/contracts/src` e usam Zod 4 com
objetos estritos. TypeScript deriva os tipos dos mesmos schemas usados em
runtime; não há uma segunda cópia JSON Schema para divergir.

## Contratos implementados

| Modulo                 | Contratos principais                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `webhook.ts`           | Envelopes V1/V2; V2 preserva `pull_request.updated_at`                      |
| `executor.ts`          | RPC V1/V2/V3 exact-SHA, política de escopo, broker, tools e resultados      |
| `repository-policy.ts` | YAML v1 normalizado, digests, exclusões e rigor de veredito                 |
| `review-output.ts`     | Findings estruturados, evidências, resumo e registro de publicação          |
| `admin-projection.ts`  | Envelopes V1 de projeção assíncrona, hash RFC 8785 e validação temporal     |
| `admin-run-detail.ts`  | DTOs V1 de detalhe read-only para o console operacional via RPC             |
| `admin-cursor.ts`      | Schemas e codificação/decodificação segura de cursores de paginação D1      |
| `shared.ts`            | SHA, IDs, inteiros positivos e caminhos relativos normalizados reutilizados |

## Regras

- Schemas são independentes de SDK e provedor.
- Toda estrutura produzida por modelo é validada em runtime.
- Versões incompatíveis recebem novo identificador de schema.
- Campos desconhecidos são rejeitados nas fronteiras de segurança, salvo decisão
  explícita em contrário.
- Exemplos válidos e inválidos acompanham cada schema.
- Testes de contrato devem provar serialização, validação e compatibilidade.

O pedido V2 do executor aceita no máximo 2 MB UTF-8 de diff canônico bruto;
portanto, o request precede a classificação e pode conter seções que serão
excluídas. O contexto persistido seleciona até 50 patches textuais elegíveis,
60 kB por arquivo, 120 kB agregados e 5.000 linhas alteradas. Cada arquivo registra modo `structural` para
JS/TS ou `textual` para os demais formatos. Binários, lockfiles, artefatos
gerados e caminhos potencialmente sensíveis reconhecidos pelas heurísticas não
entram nesse contexto nem são enviados ao modelo. O contexto V2 preserva cada
patch completo; o prompt pode omitir arquivo inteiro, nunca cortar hunk. A mesma política autoriza
paths e resultados das tools. A saída contém até três findings, duas evidências
por finding e um resumo de até 800 caracteres.

`read_file` aceita uma janela inclusiva de no máximo 500 linhas. Depois de
resolver e autorizar o path real, o executor traduz essa janela para um comando
`sed` construído pelo host dentro do container. O resultado é limitado a 100 kB
e informa truncamento; o Worker não lê nem materializa o arquivo completo.

O credential request contém somente container, run, instalação e identidade do
repositório. `containerId` vem do contexto da plataforma; resposta com token e
expiração existe apenas no broker/outbound handler. Antes da preparação V2, o
control plane obtém do executor esse mesmo Durable Object ID opaco por RPC e o
registra no scope; o nome determinístico passado a `idFromName` não é o
`containerId`. V1 permanece aceito para rollout N-1, mas seu argumento token é
ignorado pelo executor dual-stack.

O pedido V3 adiciona a política efetiva e o executor persiste
`ReviewContextV3` com `ReviewScopePolicyV2`. Quando a fonte é customizada, V3 é
obrigatório em preparação e leitura: ausência do método encerra a run sem retry
e não permite fallback. `sourceDigest` identifica os bytes UTF-8 originais;
`effectivePolicyDigest` identifica o JSON canônico aplicado. Ambos são hashes
SHA-256 e aparecem na telemetria e no Check Run sem expor o conteúdo da
configuração.
