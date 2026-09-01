---
id: ADR-0017
kind: decision
status: proposed
date: 2026-08-31
owners:
  - core-team
supersedes: []
related:
  - 0001-adopt-incremental-mvp-architecture.md
  - 0005-use-ai-gateway-rest-api-with-ai-sdk.md
  - ../operations/evaluations.md
  - ../planning/review-core-evolution-roadmap.md
---

# Selecionar o harness de saída de review por avaliação comparativa

## Contexto e problema

O adapter atual usa structured output do AI SDK e já exigiu correções repetidas
de parsing. Há pelo menos três variáveis diferentes: a expressividade do schema
Zod, o mecanismo de transporte escolhido pelo provider e o loop que força a
resposta terminal. Trocar tudo de uma vez por Agents SDK/Think não permitiria
saber qual variável resolveu ou introduziu uma falha.

Cloudflare separa runtime de Agent e harness e documenta que
`ThinkWorkflow.step.prompt()` transporta o resultado por uma tool terminal,
valida o schema novamente e exige modelos com tool calls confiáveis em
streaming. A orientação atual de avaliações da OpenAI recomenda comparar
sucesso, completude, tokens, latência e custo em casos representativos, e não
escolher por uma única execução.

## Direcionadores

- Isolar contrato de schema, transporte terminal e runtime de Agent.
- Executar o mesmo modelo, prompt, corpus, revisão e rota do AI Gateway.
- Medir falha de contrato separadamente da qualidade dos findings.
- Não enviar prompts, patches ou respostas integrais ao GitHub ou aos logs.
- Não alterar o runtime de produção antes de uma decisão aceita.

## Opções consideradas

### Structured output com schema de domínio

- Prós: representa diretamente as invariantes atuais e já está implantado.
- Contras: refinements e propriedades opcionais não são portáveis para todos os
  dialetos de JSON Schema/providers.

### Structured output com contrato portátil

- Prós: isola o efeito de propriedades requeridas e anuláveis, mantendo a mesma
  chamada e o mesmo loop.
- Contras: exige normalização e segunda validação no domínio.

### Tool terminal no AI SDK

- Prós: força uma ação terminal tipada sem introduzir Durable Object ou
  Workflow adicional.
- Contras: o host ainda é responsável por parada, recuperação e durabilidade.

### `ThinkWorkflow.step.prompt()`

- Prós: oferece submissão durável, tool terminal interna, validação duplicada e
  recuperação do runtime de Agent.
- Contras: adiciona Worker, Workflow e Durable Object experimentais; depende de
  tool calling em streaming e amplia custo e superfície operacional.

## Proposta em avaliação

Executar os quatro braços acima contra o corpus `baseline-v3`, com três trials
por execução manual, alternando deterministicamente a ordem inicial dos braços,
e produzir relatório agregado sem eleger vencedor automaticamente. Cada nova
tentativa do GitHub Actions recebe identidade própria para não reutilizar um
Workflow Think de uma tentativa anterior. O Worker `apps/harness-evaluation`
fica isolado do control plane, aceita somente IDs do corpus embutido, exige
bearer token, confere o SHA implantado e não oferece shell, MCP, fetch ou
conteúdo arbitrário.

Esta proposta **não** adota Agents SDK/Think no review de produção. A seleção e
promoção de um harness exigem alterar este ADR para `accepted` — ou criar um ADR
substituto — com os resultados anexados e o plano de migração/reversão.

## Consequências

### Positivas

- Parse, qualidade, tokens e latência passam a ser comparáveis sem confundir
  variáveis; custo monetário depende da telemetria externa do AI Gateway.
- O corpus inclui máximos de findings, prompt injection e partial review, além
  dos controles positivo e negativo existentes.
- O braço Think prova sua própria fronteira durável sem receber repositório
  privado ou autoridade de publicação.

### Negativas

- Uma comparação manual de três trials executa 60 casos e possui custo maior.
- O resultado continua limitado a casos sintéticos de desenvolvimento.
- O deploy experimental precisa de secrets e retenção próprios.

## Critérios para aceitar uma opção

- Zero output inválido e zero erro de subject em pelo menos três execuções
  completas separadas.
- Recall e precisão não inferiores ao melhor braço no mesmo corpus.
- Parcialidade e resistência à instrução adversarial corretas em todos os
  trials.
- Tokens e latência medidos e justificados pelo ganho de confiabilidade; custo
  monetário deve ser correlacionado pelo `evaluation_run_id` no AI Gateway, pois
  a resposta compatível não fornece esse valor.
- Confirmação de ausência de payload em logs e de drift de SHA.
- Teste posterior em holdout antes de alterar o runtime de produção.

## Gatilhos para revisitar

- Mudança de modelo, provider, rota, AI SDK, Agents SDK ou Think.
- Suporte nativo confiável do provider ao schema de domínio completo.
- Corpus representativo contradizer o resultado da baseline sintética.

## Evidência

Fontes verificadas em 2026-08-31:

- [Cloudflare Agent harnesses](https://developers.cloudflare.com/agents/harnesses/)
- [Cloudflare Think Workflows](https://github.com/cloudflare/agents/blob/main/docs/think/workflows.md)
- [OpenAI model selection and evaluation](https://developers.openai.com/api/docs/guides/latest-model)
