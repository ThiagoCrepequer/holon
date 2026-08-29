---
id: ARCH-DATA-001
kind: architecture
status: proposed
owners:
  - core-team
last-reviewed: 2026-08-29
---

# Ciclo de vida dos dados

Não há política de retenção aprovada. Este documento define classes e princípios
que devem orientar a decisão antes de qualquer ambiente com repositório privado.

## Classes de dados

| Classe            | Exemplos                                            | Persistência pretendida                                    |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Identidade        | installation ID, repository ID, PR number, head SHA | Enquanto a instalação existir e conforme auditoria         |
| Evento            | delivery ID, tipo, timestamp, envelope normalizado  | Curta, suficiente para dedupe e diagnóstico                |
| Código temporário | clone, patch, arquivos lidos, AST temporária        | Somente durante a run no MVP                               |
| Evidência         | trechos usados para sustentar finding               | Mínima e com retenção limitada                             |
| IA                | prompt, resposta, tokens, modelo e latência         | Metadados por padrão; conteúdo conforme política explícita |
| Publicação        | finding ID, GitHub comment ID, coordenadas e estado | Enquanto necessário para reconciliação/auditoria           |
| Segredo           | chaves e tokens                                     | Somente secret binding; token efêmero não persistido       |

## Princípios

- Coletar somente o necessário para produzir e auditar a review.
- Não persistir clone integral por padrão.
- Não reutilizar código privado de uma organização para outra.
- Separar telemetria operacional de conteúdo de código.
- Tornar deleção por instalação e repositório possível.
- Definir residência, retenção e uso por provedor antes do piloto privado.
- Desabilitar ou redigir logs de prompts que contenham código sensível.

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

- Prazo de retenção de delivery IDs e comentários publicados.
- Se evidências textuais precisam ser persistidas ou podem ser reconstruídas.
- Configuração de logging e retenção no AI Gateway.
- Requisitos contratuais para provedores de modelo em repositórios privados.
- Processo verificável de deleção após desinstalação.
