---
id: CONTRACTS-INDEX
kind: index
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Contratos

Os contratos executáveis ficam em `packages/contracts/src` e usam Zod 4 com
objetos estritos. TypeScript deriva os tipos dos mesmos schemas usados em
runtime; não há uma segunda cópia JSON Schema para divergir.

## Contratos implementados

| Modulo                   | Contratos principais                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `webhook.ts`             | Envelope atual preserva `pull_request.updated_at`                                                                 |
| `executor.ts`            | Preparação/contexto exact-SHA, política de escopo, broker, tools e resultados                                     |
| `repository-policy.ts`   | YAML normalizado, digests, exclusões e rigor de veredito                                                          |
| `review-output.ts`       | Findings estruturados, evidências, resumo e registro de publicação                                                |
| `causal-verification.ts` | Avaliações restritas a candidatos, resultado causal, confiança e justificativa                                    |
| `dashboard.ts`           | Idiomas, sessão pública, membership, wake privado, metadados paginados e erros estritos; sem segredos ou rows ORM |
| `health.ts`              | Contrato do healthcheck funcional                                                                                 |
| `shared.ts`              | SHA, IDs, inteiros positivos e caminhos relativos normalizados reutilizados                                       |

## Regras

`causalVerificationSchema` valida o `think_final_answer` da fase de
verificação e sua leitura pelo host. Aceita até oito avaliações, com índice
inteiro de 0 a 7, resultado `confirmed`/`refuted`/`inconclusive`, confiança
entre 0 e 1, justificativa de 30 a 2.000 caracteres e resumo de até 10.000.
Campos desconhecidos são rejeitados. O host exige cobertura única e exaustiva
dos candidatos efetivos, conforme a
[ADR-0050](../decisions/0050-verify-finding-causality-before-publication.md).
`causal_verification_incomplete` integra as limitações de saída e a fase causal
integra o pedido de reserva no mesmo orçamento da run.

- Schemas são independentes de SDK e provedor.
- Toda estrutura produzida por modelo é validada em runtime.
- Contratos internos mantêm um único shape atual, alterando produtores e consumidores juntos; sem versões/aliases internos antigos (ADR-0036).
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

`StructuralImpactReport` limita símbolos/referências a 100 e contratos/superfícies
a 50 por categoria. Quando há perdas, `omittedSignals` contém contagens inteiras
não negativas por categoria, calculadas antes do corte. O campo é omitido sem
perdas. Projeções somam suas próprias omissões a essas contagens e propagam
limitação de contexto. `repositoryScanTruncated` continua descrevendo o scan;
não substitui as contagens dos tetos do relatório.

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

## Rejeição de evidências por candidato — 2026-10-04

O schema do prompt orienta o modelo a fornecer pelo menos um excerto por finding
ou resolução. Essa superfície permanece estruturalmente permissiva para que o
Think entregue a resposta ao host mesmo quando um candidato não tiver evidência.
O transporte valida as evidências de cada candidato, incluindo paths e intervalos
de linhas, antes de validar a saída agregada. Candidatos sem evidências válidas
são descartados individualmente; os demais seguem pelos gates canônico e causal.
Não são criadas evidências substitutas.

Qualquer descarte força `isDegraded: true`, adiciona `evidence_rejected` e troca
a narrativa do modelo por um aviso de análise incompleta, evitando repetir
alegações descartadas. Limitações anteriores são preservadas na normalização.
Mesmo com zero candidatos retidos, a saída não pode produzir aprovação. O
envelope continua obrigatório e limitado: formatos inválidos de `findings`,
resumo ausente, metadados inválidos e mais de oito resoluções continuam causando
erro. Os schemas do domínio continuam exigindo evidência não vazia.

## Recuperação de resumo — 2026-10-04

Resumo vazio continua sendo permitido no draft como saída degradada, com
`summary_missing` explícito e sem perder candidatos. `reviewSummaryRecoverySchema`
aceita somente `summary` não vazio de até 10.000 unidades UTF-16, `isDegraded`
booleano e `outputLimitations` com os códigos atuais. Campos adicionais são
rejeitados: a recuperação não pode substituir findings, resoluções ou
observações. O host combina somente essa narrativa e suas limitações com o
draft validado; nunca apaga outras causas de parcialidade. Os limites de uma
inferência, 1.024 tokens e até 60 segundos compartilham orçamento e prazo da run.

## Configuração compilada — 2026-09-09

`repository-config/input.ts` é a entrada estrutural única; `snapshot.ts` separa
snapshot privado, referência e resumo público autenticado. O artefato
[holon.schema.json](holon.schema.json) deriva de Zod draft-07 e é servido pelo
control-plane. O gate verifica schema e identidade gerada do compilador. A
[CLI](../operations/repository-configuration.md) aplica validação semântica.
`configDigest` identifica semântica/defaults/textos, `sourceDigest` a proveniência
e `scopeDigest` somente exclusões. Identidade de run exige PR/head/base.
`AdminRunDetail.historicalRunFindings` contém resultados retidos integrais,
independentes dos manifests temporários e do limite de publicação inline.

## Contratos do core de review (2026-09-27)

A fila compartilhada aceita o envelope de PR e `followUpMessageSchema` para CI/feedback. `savePrFindings` exige a run escritora; `SavedCiEvidence` exige workflow run, tentativa e destino de publicação. `review.documentation` integra o snapshot compilado e seu digest; instruções e compatibilidade seguem o contrato único de configuração. Os schemas executáveis ficam em `packages/contracts/src`. A transição de persistência e os limites estão na [ADR-0038](../decisions/0038-harden-parallel-review-and-publication.md).

## Perguntas em findings

`finding-clarification.ts` valida admissão, identidade do Agent, registro persistido, leituras e resposta. A resposta limita explicação a 5.000 caracteres, cenário a 2.000 e até seis referências, com linhas positivas e trecho de até 2.000 caracteres. O host exige correspondência às leituras efetivas, não apenas um schema válido. A fase `finding_clarification` usa reservas separadas por pergunta. A [ADR-0052](../decisions/0052-answer-finding-questions-in-pr-threads.md) define autoridade e efeitos.

## Evidência recuperada e resultados de shards

`review-evidence.ts` define receipts ligados a run/head/path/janela/digest e o pacote
limitado de oito reads, com 20 kB totais. `validateReviewEvidencePack` recalcula a
identidade e o conteúdo no snapshot esperado. `causalVerificationSchema` exige
`basis` (`patch`/`repository`) e `evidenceReceiptIds`; repository requer IDs de
receipts inspecionados e completos, patch requer lista vazia. O host resolve a
janela inteira pelos IDs e valida os metadados, além da cobertura posicional única
de candidatos. A [ADR-0057](../decisions/0057-select-host-evidence-receipts-in-causal-assessments.md)
remove a repetição de path/coordenadas na resposta, preservando a validação de
identidade/conteúdo pelo adapter.

`shardReviewResultSchema` discrimina sucesso/falha. Sucesso admite até oito
findings; falha exige causa e não carrega findings/resumo publicáveis. A agregação
exige IDs/índices únicos do plano e deriva degradação também das limitações e
rejeições, sem depender só de `isDegraded`.

A porta de lookup GitHub retorna `found` com ID/corpo, `absent` somente após
paginação concluída ou `inconclusive` por limite. Nenhum consumidor pode transformar
inconclusivo em autorização de nova mutação. São contratos atuais, sem fallback.
