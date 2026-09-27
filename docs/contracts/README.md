---
id: CONTRACTS-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-09-08
---

# Contratos

Os contratos executáveis ficam em `packages/contracts/src` e usam Zod 4 com
objetos estritos. TypeScript deriva os tipos dos mesmos schemas usados em
runtime; não há uma segunda cópia JSON Schema para divergir.

## Contratos implementados

| Modulo                 | Contratos principais                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `webhook.ts`           | Envelope atual preserva `pull_request.updated_at`                             |
| `executor.ts`          | Preparação/contexto exact-SHA, política de escopo, broker, tools e resultados |
| `repository-policy.ts` | YAML normalizado, digests, exclusões e rigor de veredito                      |
| `review-output.ts`     | Findings estruturados, evidências, resumo e registro de publicação            |
| `admin-projection.ts`  | Eventos de projeção assíncrona, hash RFC 8785 e validação temporal            |
| `admin-run-detail.ts`  | DTO de detalhe read-only para o console operacional via RPC                   |
| `admin-cursor.ts`      | Schemas e codificação/decodificação segura de cursores de paginação D1        |
| `shared.ts`            | SHA, IDs, inteiros positivos e caminhos relativos normalizados reutilizados   |

## Regras

- Schemas são independentes de SDK e provedor.
- Toda estrutura produzida por modelo é validada em runtime.
- Versões incompatíveis recebem novo identificador de schema.
- Campos desconhecidos são rejeitados nas fronteiras de segurança, salvo decisão
  explícita em contrário.
- Exemplos válidos e inválidos acompanham cada schema.
- Testes de contrato devem provar serialização, validação e rejeição de formatos retirados.

O pedido do executor aceita no máximo 2 MB UTF-8 de diff canônico bruto;
portanto, o request precede a classificação e pode conter seções que serão
excluídas. O contexto persistido seleciona até 50 patches textuais elegíveis,
60 kB por arquivo, 300 kB agregados em até cinco shards e 5.000 linhas alteradas,
com teto adicional de 500 kB de JSON serializado. Cada arquivo registra modo `structural` para
JS/TS ou `textual` para os demais formatos. Binários, lockfiles, artefatos
gerados e caminhos potencialmente sensíveis reconhecidos pelas heurísticas não
entram nesse contexto nem são enviados ao modelo. O contexto preserva cada
patch completo; o prompt pode omitir arquivo inteiro, nunca cortar hunk. A mesma política autoriza
paths e resultados das tools. A saída por shard contém até oito findings, quatro evidências
por finding e resumo de até 10.000 unidades UTF-16 (ADR-0033).

`read_file` aceita uma janela inclusiva de no máximo 500 linhas. Depois de
resolver e autorizar o path real, o executor traduz essa janela para um comando
`sed` construído pelo host dentro do container. O resultado é limitado a 100 kB
e informa truncamento; o Worker não lê nem materializa o arquivo completo.

O credential request contém somente container, run, instalação e identidade do
repositório. `containerId` vem do contexto da plataforma; resposta com token e
expiração existe apenas no broker/outbound handler. Antes da preparação, o
control plane obtém do executor esse mesmo Durable Object ID opaco por RPC e o
registra no scope; o nome determinístico passado a `idFromName` não é o
`containerId`. Installation ID é obrigatório e exige escopo previamente autorizado.

O pedido adiciona a política efetiva e o executor persiste
`ReviewContext` com `ReviewScopePolicy`. A leitura usa `loadContext` para toda
política. O modelo recebe `ReviewShardContext`; nenhum deles aceita formatos antigos.
A seleção ocorre no planner antes da persistência, conforme
[ADR-0035](../decisions/0035-plan-complete-context-before-sharding.md). `sourceDigest` identifica os bytes UTF-8 originais;
`effectivePolicyDigest` identifica o JSON canônico aplicado. Ambos são hashes
SHA-256 e aparecem na telemetria e no Check Run sem expor o conteúdo da
configuração.

## Identificação de versões — 2026-09-05

`packages/contracts/src/project-identification.ts` define requests por SHA, evidências, resultados, cache e output restrito do modelo. Declarações exigem IDs existentes com valor/nome/tipo coincidentes. `AdminRunDetail` adiciona o snapshot ao drill-down; `getRunDetail` é o único RPC de detalhe, sem métodos alternativos. Consulte a [arquitetura](../architecture/project-version-identification.md) e a [ADR-0030](../decisions/0030-identify-project-versions-from-snapshot-evidence.md).

## Manifesto, contabilidade e resoluções — 2026-09-08

`review-analysis.ts` valida o artefato agregado e o manifesto de checkpoint,
que exclui evidências/histórico e limita a 40 coordenadas de findings ativos.
Diagnósticos do manifesto têm até 300 unidades UTF-16; o artefato conserva o
texto validado integral. `analysisUsageSchema` valida contadores não negativos;
`analysisAccountingSchema` inclui tempos das tentativas.

`review-output.ts` aceita `resolutions` opcionais, até oito por shard, com
fingerprint, confiança, localização, diagnóstico e evidências. A aceitação
semântica exige o gate do host descrito na
[ADR-0034](../decisions/0034-make-review-checkpoints-and-revalidation-durable.md).
`finding-lifecycle.ts` exige hash secundário e confiança explícita em findings
persistidos; registros incompletos são rejeitados.

A [ADR-0036](../decisions/0036-use-single-current-development-contracts.md) governa nomes e evolução dos contratos: um formato atual por responsabilidade, sem APIs de compatibilidade.

## Contratos do core de review (2026-09-27)

A fila compartilhada aceita o envelope de PR e `followUpMessageSchema` para CI/feedback. `savePrFindings` exige a run escritora; `SavedCiEvidence` exige workflow run, tentativa e destino de publicação. `RepositoryPolicy.reviewGuidance` é opcional e integra o digest efetivo. Os schemas executáveis ficam em `packages/contracts/src`. A transição de persistência e os limites estão na [ADR-0037](../decisions/0037-harden-parallel-review-and-publication.md).
