---
id: ADR-0006
kind: decision
status: accepted
date: 2026-08-29
owners:
  - core-team
supersedes: []
related:
  - 0004-adopt-workflows-do-ledger-and-sandbox-executor.md
  - ../architecture/review-runtime-flow.md
  - ../architecture/state-and-idempotency.md
---

# Usar checkpoints granulares e manter o contexto grande no Sandbox

## Contexto

ADR-0004 escolheu Workflows, Durable Object SQLite e Sandbox, mas não definiu a
fronteira exata de cada checkpoint. Uma única etapa envolvendo clone, modelo e
publicação seria reiniciável apenas como bloco, ampliaria efeitos repetidos e
tentaria persistir o `ReviewContext` completo no histórico do Workflow.

Em 2026-08-29, a documentação atual foi verificada novamente. Workflows recomenda
etapas granulares, determinísticas e idempotentes. Resultados não transmitidos de
uma etapa têm limite de 1 MiB. O filesystem do Sandbox é efêmero e desaparece
quando o container para; `sleepAfter` controla o intervalo ocioso antes disso.

Fontes primárias:

- [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Sandbox lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/)
- [Sandbox options](https://developers.cloudflare.com/sandbox/configuration/sandbox-options/)

## Decisão

`ReviewWorkflow` usa checkpoints separados para claim, início, preparação do
repositório, análise, início de publicação, releitura do head, cada comentário,
resumo, conclusão e cleanup. Cada chamada externa fica dentro de `step.do` com
timeout e retry delimitados.

O executor grava o `ReviewContext` validado em
`/workspace/holon-review-context.json`. A etapa de preparação retorna somente
metadados pequenos e tipados. A análise relê o contexto por RPC dentro de sua
própria etapa; o schema do resultado do modelo limita a saída bem abaixo de 1
MiB. Antes da leitura, ela consulta a existência do artefato; se o Sandbox tiver
sido substituído entre checkpoints, repete a preparação idempotente com os
mesmos SHAs assinados e um novo token de instalação. O Sandbox usa
`sleepAfter: "15m"`, superior ao timeout de dez minutos da etapa de modelo, e é
destruído por uma etapa explícita em sucesso, obsolescência ou falha.

O ledger associa a run ao `WorkflowEvent.instanceId`. Transições possuem
`operationId` determinístico e uma tabela de operações, de modo que repetir um
callback depois do commit é no-op apenas quando run, estado anterior e estado
seguinte coincidem. Publicações continuam reconciliadas pelo marcador antes de
um novo `POST`; retries automáticos do Octokit ficam desativados nas mutações.

## Alternativas rejeitadas

### Uma etapa para toda a review

Rejeitada porque mistura efeitos independentes, repete trabalho caro e não
oferece checkpoint seguro entre análise e publicações.

### Retornar o contexto completo da etapa de preparação

Rejeitada porque patches e coordenadas podem exceder o limite de resultado do
Workflow e duplicariam código no histórico durável.

### R2 para o contexto temporário do MVP

Adiada. R2 acrescentaria retenção, política de exclusão e custo sem necessidade
demonstrada enquanto o contexto cabe no ciclo ativo do Sandbox.

### `keepAlive: true`

Rejeitada para o MVP porque um cleanup definitivamente perdido poderia manter o
container ativo. O intervalo ocioso limitado cobre a maior etapa individual sem
retirar o timeout automático de segurança.

## Consequências

- Retomadas repetem no máximo a unidade durável que falhou.
- Código privado grande não é persistido como output normal do Workflow.
- O contexto continua efêmero e não sobrevive a uma parada inesperada do
  container; a análise detecta sua ausência e executa a preparação idempotente
  antes de chamar o modelo.
- Alterar timeout do modelo exige revisar `sleepAfter` e o runbook.
- A prova local cobre replay de transições, obsolescência, terminalização,
  cleanup e publicação idempotente; retomada real na plataforma ainda pertence
  ao piloto.

## Critérios de confirmação

- Nenhuma etapa normal retorna mais de 1 MiB.
- Repetir callbacks de transição não incrementa tentativa nem muda estado duas
  vezes.
- Uma instância diferente não assume uma run ativa.
- Falha após preparação terminaliza a run e tenta destruir o Sandbox.
- O fluxo obsoleto não publica e também destrói o Sandbox.
- A perda do contexto entre preparação e análise provoca reconstrução e não uma
  leitura cega de estado inexistente.
- O gate local e um smoke da imagem provam `rg` e `ast-grep run` reais.
