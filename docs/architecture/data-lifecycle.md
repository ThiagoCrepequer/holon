---
id: ARCH-DATA-001
kind: architecture
status: proposed
owners:
  - core-team
last-reviewed: 2026-09-03
related:
  - ../decisions/0013-use-tiered-structural-and-textual-review.md
  - ../decisions/0014-version-executor-rpc-and-broker-github-credentials.md
  - ../decisions/0015-use-causal-admission-and-durable-terminal-cleanup.md
  - ../decisions/0027-actively-supersede-obsolete-review-workflows.md
---

# Ciclo de vida dos dados

Não há política de retenção aprovada. Este documento define classes e princípios
que devem orientar a decisão antes de qualquer ambiente com repositório privado.

## Classes de dados

| Classe              | Exemplos                                            | Persistência pretendida                                                         |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Identidade          | installation ID, repository ID, PR number, head SHA | Enquanto a instalação existir e conforme auditoria                              |
| Evento              | delivery ID, tipo, timestamp, envelope normalizado  | Workflow: 1 dia sucesso, 3 dias erro; demais ainda aberta                       |
| Diff canônico bruto | Request temporário do executor, limitado a 2 MB     | Somente durante preparação; não vira checkpoint ou prompt                       |
| Contexto filtrado   | Patches elegíveis, arquivos lidos, AST temporária   | Somente durante a run no MVP                                                    |
| Evidência           | Trechos usados para sustentar finding               | Mínima e com retenção limitada                                                  |
| IA                  | Prompt, resposta, tokens, modelo e latência         | Metadados por padrão; conteúdo conforme política explícita                      |
| Publicação          | finding ID, GitHub comment ID, coordenadas e estado | Enquanto necessário para reconciliação/auditoria                                |
| Segredo             | Chaves e tokens                                     | Secret binding; token JIT não persistido e repo-scoped                          |
| Avaliação sintética | IDs, prompt derivado do corpus V3 e saída validada  | Workflow com retenção de 1 dia; Agent destruído por callback durável após 1 dia |

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
- Se evidências textuais precisam ser persistidas ou podem ser reconstruídas.
- Configuração de logging e retenção no AI Gateway.
- Requisitos contratuais para provedores de modelo em repositórios privados.
- Processo verificável de deleção após desinstalação.
