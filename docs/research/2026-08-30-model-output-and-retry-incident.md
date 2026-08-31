---
id: RESEARCH-2026-08-30-MODEL-OUTPUT-AND-RETRY-INCIDENT
kind: research
status: current
date: 2026-08-30
owners:
  - core-team
related:
  - ../decisions/0012-use-canonical-diff-and-bounded-semantic-recovery.md
  - ../architecture/review-runtime-flow.md
---

# Incidente de output truncado e replay da sessão agentiva

## Pergunta

Por que uma run com `ModelNonRetryableError` durou quatro minutos, fez três
inferências completas e não alcançou os modelos seguintes da Dynamic Route?

## Evidência observada

Os metadados abaixo foram consultados pela API de Workflows e pela API de logs
do AI Gateway. Nenhum prompt, diff ou conteúdo da resposta foi incluído nesta
documentação.

- `prepare-repository` concluiu em nove segundos.
- `analyze-review` executou três tentativas: aproximadamente 136, 45 e 37
  segundos, com backoffs de 10 e 20 segundos.
- Cada tentativa enviou 37.695 tokens de prompt e recebeu 4.000 tokens de
  completion.
- Todas as respostas vieram de
  `nvidia/nemotron-3-super-120b-a12b:free`, provider NVIDIA via OpenRouter, com
  HTTP 200 e `finish_reason: length`.
- Nenhuma tentativa chamou tools ou produziu JSON válido.
- A requisição continha `response_format: json_schema`, `strict: true`, schema
  `holon_review`, as três tools esperadas e `tool_choice: auto`.
- A versão ativa da rota tinha GLM 5.2 como primeiro modelo, Nemotron como
  primeiro fallback e outros modelos depois dele. O HTTP 200 do Nemotron
  encerrou a rota antes dos fallbacks seguintes.
- O Workflow persistiu as três falhas como um `Error` comum contendo
  `ModelNonRetryableError: HOLON_MODEL_NON_RETRYABLE`.
- `mark-review-terminal` e `cleanup-failed-repository` concluíram sem atraso;
  nenhuma instância do container permaneceu viva.

## Diagnóstico

O adapter enviou corretamente tools e JSON Schema. O modelo consumiu todo o
budget de output sem satisfazer o contrato. Isso é uma falha semântica depois de
uma resposta HTTP bem-sucedida; o Gateway não a interpreta como condição de
fallback.

O retry do Workflow operava em uma granularidade maior que o fallback do
Gateway: repetia `generateText` inteiro, não apenas a requisição que falhou. O
nome customizado do `NonRetryableError` também não foi reconhecido como terminal
na execução observada. Mesmo que esse comportamento do runtime seja corrigido,
um teto de custo não deve depender exclusivamente dessa classificação especial.

## Conclusão original e revisão posterior

Fallback de transporte entre provider/modelo pertence à Dynamic Route. O step
agentivo deve ter uma única tentativa, enquanto steps menores e idempotentes
podem manter retries próprios. Investigação posterior provou que HTTP 200 com
output inválido exige uma recuperação semântica local, limitada a uma chamada
sem tools; ver ADR-0012. Erros conhecidos recebem códigos seguros sem registrar
conteúdo do repositório ou do modelo.

## Limites da validação

- O catálogo de modelos declara suporte a tools e structured outputs, mas isso
  não prova conformidade para todo provider ou prompt.
- O log não preservou o nome exato do erro original do AI SDK; a combinação de
  `finish_reason: length` e JSON inválido prova a causa funcional, mas não
  distingue `AI_NoOutputGeneratedError` de `AI_NoObjectGeneratedError`.
- A nova política precisa de smoke real após deploy para confirmar uma única
  sessão e a publicação com o modelo escolhido.

## Fontes

Verificadas em 2026-08-30:

- [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)
- [AI Gateway fallbacks](https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/)
- [Dynamic routing](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/)
- [Workflows retries](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
