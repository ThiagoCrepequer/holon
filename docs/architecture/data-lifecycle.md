---
id: ARCH-DATA-001
kind: architecture
status: proposed
owners:
  - core-team
last-reviewed: 2026-09-08
related:
  - ../decisions/0013-use-tiered-structural-and-textual-review.md
  - ../decisions/0014-version-executor-rpc-and-broker-github-credentials.md
  - ../decisions/0015-use-causal-admission-and-durable-terminal-cleanup.md
  - ../decisions/0027-actively-supersede-obsolete-review-workflows.md
  - ../decisions/0028-adopt-declarative-repository-policy.md
  - ../decisions/0029-adopt-internal-operational-console-and-d1-read-model.md
---

# Ciclo de vida dos dados

Este documento define classes de dados, princípios e as políticas de retenção
aprovadas para o pipeline de review e o read model do Console Operacional Interno (ADR-0029).

## Classes de dados

| Classe               | Exemplos                                            | Persistência pretendida                                                         |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Identidade           | installation ID, repository ID, PR number, head SHA | Enquanto a instalação existir e conforme auditoria                              |
| Evento               | delivery ID, tipo, timestamp, envelope normalizado  | Workflow: 1 dia sucesso, 3 dias erro; demais ainda aberta                       |
| Diff canônico bruto  | Request temporário do executor, limitado a 2 MB     | Somente durante preparação; não vira checkpoint ou prompt                       |
| Contexto filtrado    | Patches elegíveis, arquivos lidos, AST temporária   | Somente durante a run no MVP                                                    |
| Evidência            | Trechos usados para sustentar finding               | Mínima e com retenção limitada                                                  |
| IA                   | Prompt, resposta, tokens, modelo e latência         | Metadados por padrão; conteúdo conforme política explícita                      |
| Política efetiva     | Fonte, source digest e effective policy digest      | Metadados da run; conteúdo YAML não é persistido                                |
| Publicação           | finding ID, GitHub comment ID, coordenadas e estado | Enquanto necessário para reconciliação/auditoria                                |
| Segredo              | Chaves e tokens                                     | Secret binding; token JIT não persistido e repo-scoped                          |
| Read Model Operacion | Runs agregadas, custos, tempos e vereditos (D1)     | 180 dias no D1 (`admin_runs`), limpeza diária agendada em lotes de 500          |
| Quarentena Projeção  | Hashes e erro de mensagens inválidas (sem payload)  | 30 dias no D1 (`admin_projection_quarantine`)                                   |
| Outbox Projeção      | Tarefas de envio no ledger (`projection_tasks`)     | 7 dias concluídas (`completed`), 30 dias esgotadas (`exhausted`)                |
| Fila e DLQ Projeção  | Envelopes de projeção na fila                       | 96 horas (345.600 segundos) na fila principal e DLQ                             |
| Tendências A.Engine  | Métricas aproximadas com sampling                   | Retenção nativa da plataforma (apresentada como 90 dias na UI)                  |
| Avaliação sintética  | IDs, prompt derivado do corpus V3 e saída validada  | Workflow com retenção de 1 dia; Agent destruído por callback durável após 1 dia |

## Princípios

- Coletar somente o necessário para produzir e auditar a review.
- Não persistir clone integral por padrão.
- Filtrar o diff canônico antes de persistir contexto ou construir prompt e
  aplicar a mesma exclusão às tools.
- Não reutilizar código privado de uma organização para outra.
- Separar telemetria operacional de conteúdo de código.
- Tornar deleção por instalação e repositório possível.
- Persistir obrigação de cleanup até o executor confirmar destruição; remover
  credential scope no mesmo encerramento durável.
- Persistir a obrigação de terminar Workflow obsoleto até confirmação do
  cancelamento ou reconciliação de estado terminal; ela contém somente run ID,
  Workflow instance ID, tentativas e timestamps, nunca código ou segredo.
- Definir residência, retenção e uso por provedor antes do piloto privado.
- Desabilitar ou redigir logs de prompts que contenham código sensível.
- Limitar o harness experimental a corpus sintético versionado. O runner
  persiste somente relatório sanitizado em artifact; o DO/Workflow pode manter
  temporariamente a conversa necessária ao `step.prompt`, mas nunca recebe
  conteúdo arbitrário ou repositório privado.

## R2 e Vectorize

R2 e Vectorize estão fora do primeiro MVP. Antes de adotá-los, uma decisão deve
definir:

- finalidade exata;
- unidade de isolamento por organização/repositório;
- expiração e deleção;
- tratamento de force-push e branch deletion;
- modelo de embedding e possibilidade de reconstrução;
- resposta à desinstalação do GitHub App.

## Questões pendentes

- Prazo de retenção de delivery IDs, ledger e comentários publicados além da
  retenção de Workflow já definida no ADR-0015.
- Prazo de retenção das evidências individuais no histórico do Workflow além
  da remoção do artefato agregado temporário definida na ADR-0034.
- Configuração de logging e retenção no AI Gateway.
- Requisitos contratuais para provedores de modelo em repositórios privados.
- Processo verificável de deleção após desinstalação.

## Identificação de versões (2026-09-05)

A [arquitetura de identificação](project-version-identification.md), governada pela [ADR-0030](../decisions/0030-identify-project-versions-from-snapshot-evidence.md), descreve o package reutilizável, coleta de metadados por SHA, cache DO por instalação/repositório, checkpoints e snapshot de auditoria no ledger. Conteúdo integral dos manifests não é persistido; versões são dados, nunca instruções de review.

## Artefato temporário de análise — 2026-09-08

A [ADR-0034](../decisions/0034-make-review-checkpoints-and-revalidation-durable.md)
autoriza persistir a saída agregada privada no SQLite do DO do PR em chunks de
64.000 bytes. O cleanup terminal a remove após o executor confirmar destruição,
inclusive em falha e obsolescência. Falha de cleanup mantém a obrigação e o
artefato até nova tentativa bem-sucedida. Essa exclusão não remove os resultados
individuais dos shards retidos pela plataforma Workflows nem comentários GitHub.
`analysis_usage` guarda apenas IDs e contadores de uso; não contém prompts,
patches ou respostas livres. O prazo geral do ledger permanece pendente.
