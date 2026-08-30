---
id: RESEARCH-2026-08-30-AGENTIC-REVIEW-COMPLETION-INCIDENT
kind: research
status: current
date: 2026-08-30
owners:
  - core-team
related:
  - ../decisions/0010-use-dynamic-route-for-pr-review.md
  - ../architecture/review-runtime-flow.md
---

# Incidente de conclusão do review agentivo

## Errata após validação em produção

A política descrita abaixo impediu retries para erros determinísticos nos
testes locais, mas não no runtime publicado: uma resposta truncada e inválida
foi executada três vezes pelo step. A investigação posterior está em
[Incidente de output truncado e replay da sessão agentiva](2026-08-30-model-output-and-retry-incident.md),
e a política de retry foi substituída pela
[ADR-0011](../decisions/0011-centralize-model-fallback-in-dynamic-route.md).

## Pergunta

Por que o review alcançou o modelo correto no OpenRouter, executou ferramentas
do repositório, mas não produziu a review estruturada nem publicou no GitHub?

## Evidência observada

- A Dynamic Route `dynamic/pr-review` selecionou OpenRouter e produziu tokens.
- O modelo retornou tool calls válidas para `read_file` e `search_text`.
- Requests posteriores ultrapassaram 34 mil tokens de entrada. Entradas
  separadas apareceram em 9 a 163 ms com indicador de cache do Gateway e sem
  tokens, enquanto respostas upstream também informaram tokens de prompt em
  cache do provider; são mecanismos distintos.
- Após 12 tool calls, os resultados passaram a carregar
  `RepositoryToolBudgetExceededError`.
- O último passo ainda podia solicitar tools, então o AI SDK terminou sem um
  objeto final e lançou `AI_NoOutputGeneratedError` ou
  `AI_NoObjectGeneratedError`.
- O Workflow repetiu `analyze-review` três vezes porque essas falhas ainda eram
  tratadas como desconhecidas e retentáveis.
- O request usava `response_format: {"type":"json_object"}` em vez de JSON
  Schema estrito.

## Diagnóstico

Não houve uma única falha do modelo ou do Gateway. Quatro contratos locais se
combinaram:

1. O adapter OpenAI-compatible não declarava suporte a structured outputs e,
   por isso, degradava `Output.object` para JSON mode.
2. O limite de passos interrompia o loop sem reservar uma inferência final na
   qual tools estivessem indisponíveis.
3. O cache exato do AI Gateway podia reproduzir respostas de uma execução
   agentiva cujo estado de tools já havia avançado.
4. O Workflow diferenciava status permanentes do provider, mas não saídas
   ausentes, JSON/schema inválido ou budget local esgotado.

Trocar ou reordenar modelos na Dynamic Route melhora compatibilidade, mas não
corrige esses quatro contratos da aplicação.

## Correção adotada

- Declarar `supportsStructuredOutputs: true` no provider OpenAI-compatible.
- Enviar `cf-aig-skip-cache: true` nas inferências agentivas.
- Permitir seis passos de investigação e retirar todas as tools no sétimo passo,
  reservado à resposta estruturada.
- Manter `maxRetries: 0` no AI SDK.
- Converter erros determinísticos de output/schema/budget em
  `NonRetryableError` no Workflow; status transitórios classificados continuam
  sujeitos ao retry durável existente.

O budget global de 12 tool calls continua como defesa independente. A retirada
de tools por passo garante conclusão normal antes que o limite de inferências
seja atingido; o budget protege respostas com múltiplas tool calls paralelas.

## Limites da validação

Testes locais cobrem headers, JSON Schema estrito, reserva do passo final e a
política de uma tentativa para falhas determinísticas. Eles não provam que a
versão publicada da Dynamic Route mantém a ordem esperada nem que cada modelo
remoto honra os dois recursos. Isso exige smoke após o deploy.

## Fontes

Verificadas em 2026-08-30:

- [AI Gateway caching](https://developers.cloudflare.com/ai-gateway/features/caching/)
- [Using a dynamic route](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/)
- [AI SDK OpenAI-compatible providers](https://ai-sdk.dev/providers/openai-compatible-providers)
- [AI SDK tools with structured outputs](https://ai-sdk.dev/docs/troubleshooting/tool-calling-with-structured-outputs)
- [Cloudflare Workflows retries](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
