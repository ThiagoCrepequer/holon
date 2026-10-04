---
id: OPS-FINDING-CLARIFICATION
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Perguntas sobre findings na discussão do PR

A [ADR-0051](../decisions/0051-answer-finding-questions-in-pr-threads.md) define a
investigação posterior à publicação. A funcionalidade usa o evento já assinado
`pull_request_review_comment.created`, a Queue e a configuração da GitHub App.

## Uso

Responda ao comentário inline do finding, começando com:

```text
@holon Esta validação em validateInput() já impede esse cenário?
/holon ask Em qual cenário isso ocorre? Mostre o caminho de execução.
```

A menção ao slug real da App, com ou sem `[bot]`, também funciona. O autor do PR
pode perguntar; outros usuários precisam de permissão `write`, `maintain` ou
`admin`. Respostas de bots, comentários gerais de PR, citações e comandos de
feedback não iniciam esta investigação. Os comandos `/holon dismiss` e
`/holon helpful` continuam no fluxo de feedback próprio.

A resposta traz a conclusão, o cenário e referências a linhas de código no SHA
investigado. Uma refutação validada retira o finding e recalcula o Check Run;
uma delimitação fica documentada na discussão. A review GitHub original não é
apagada nem automaticamente dispensada. Quando falta evidência, o finding é
mantido e a resposta declara a limitação.

Perguntas seguintes recebem contexto das duas últimas trocas publicadas da
mesma discussão e head/base. O modelo deve reler código para sustentar uma nova
conclusão; respostas anteriores não contam como evidência.

## Limites e falhas

- Apenas findings ativos da última review concluída no head/base atual.
- Pergunta com até 4.000 caracteres; cinco perguntas por finding/head e 20 por
  PR/head. Limites acumulados não são renovados por redelivery.
  Depois dessas quotas, perguntas adicionais não iniciam investigação.
- Uma investigação ativa por PR/head, oito leituras de 200 linhas e 64 KiB de
  evidência no total. Arquivos maiores que 64 KiB, paths excluídos, symlinks,
  submodules e LFS não são lidos.
  Pergunta concorrente recebe um aviso para aguardar, sem chamar o modelo.
- Não há busca global. Para contestar com um guard em outro arquivo, forneça o
  caminho ou nome do módulo. Ausência de leitura vira limitação, não prova de
  ausência de validação.
- PR fechado, pergunta editada/deletada, thread de outro bot, head/base alterado
  e finding já resolvido/dispensado não concedem autoridade de investigação.
- A resposta é reconciliada por marcador antes de repetir publicação após
  timeout. Falha de modelo produz conclusão inconclusiva; reservas incertas
  continuam consumidas. O alarm remove leituras de investigações expiradas.
  Timers do Agent retomam publicação por até um dia se os retries do Workflow se esgotarem;
  o estado temporário do Agent é destruído um dia após publicação/obsolescência.

## Ativação e prova remota

O código e `wrangler.jsonc` incluem `FINDING_CLARIFICATION_AGENTS` e
`FINDING_CLARIFICATION_WORKFLOW`; a migração SQLite 20 é aditiva. Não editar
migrações já aplicadas. Nenhum secret novo ou permissão GitHub adicional é
necessário além de Contents read, Pull requests read/write e Checks read/write
já exigidos pelo fluxo de review. Verifique a instalação e configuração reais
antes do deploy; editar o manifest local não cria esses recursos.

Após deploy explicitamente autorizado, o smoke deve conferir: menção e comando,
resposta com links exatos; refutação do único bloqueador e resultado do Check;
redelivery sem segunda resposta; autor externo sem permissão; commit novo durante
investigação; timeout ambíguo; ausência de código/perguntas em logs. Smokes com
provider real consomem orçamento e exigem autorização própria.

## Evidência local — 2026-10-04

`pnpm verify` passou com Node.js 24.19.0 e pnpm 11.24.0: configuração,
formatação, lint, tipos, testes com cobertura, imagem Docker do Sandbox e
dry-runs dos dois Workers. Os 24 testes focados do control plane cobrem o
Workflow Think real com GitHub/modelo simulados, evidência e correção,
autorização, concorrência, redelivery, eviction, supersession, orçamento,
expiração e reconciliação de POST ambíguo. Testes puros verificam comandos,
contratos, apresentação e referências imutáveis.

O Workerd emitiu avisos de request cancelado nos testes Think, também presentes
na review existente; o gate terminou com código zero. Não houve deploy,
publicação GitHub ou inferência com provider real. A precisão das respostas e
as permissões/bindings remotos continuam sem prova nesta entrega local.
