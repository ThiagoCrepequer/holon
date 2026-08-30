---
id: RESEARCH-2026-08-30-AI-GATEWAY-PATH-INCIDENT
kind: research
status: current
date: 2026-08-30
owners:
  - core-team
related:
  - ../decisions/0009-use-provider-specific-ai-gateway-route.md
---

# Incidente de path e retries do AI Gateway

## Pergunta

Por que o review chegou ao AI Gateway, mas não produziu tokens nem publicou
resultado no PR?

## Evidência observada

- O Gateway `holon` registrou três chamadas ao modelo
  `custom-opencode-zen/deepseek-v4-flash`.
- O request tinha payload OpenAI-compatible, tools e JSON mode.
- Todas as respostas tinham zero tokens e status `404`.
- O corpo retornado era a página HTML `404 - Page Not Found` do OpenCode, não um
  erro JSON da Cloudflare.
- O Workflow executou `analyze-review` três vezes, conforme sua tentativa
  inicial mais `limit: 2`.

Esses dados confirmam conta, gateway, autenticação Cloudflare e seleção do
Custom Provider. Eles descartam erro de parsing do output porque o modelo não
chegou a processar tokens.

## Reprodução controlada

Em 2026-08-30, um `POST` mínimo e sem credencial diretamente para
`https://opencode.ai/zen/v1/chat/completions` respondeu `401 Missing API key` em
JSON. Isso confirma que o endpoint correto existe e que o HTML `404` observado
foi produzido por outro path.

A documentação do OpenCode associa `deepseek-v4-flash` a esse endpoint. A
documentação do Custom Provider define a composição
`{base_url}/{provider-path}` e recomenda o endpoint específico para paths não
padronizados.

## Conclusão

O `/compat` não preservou o prefixo `/zen/v1` como exigido por esse provider no
smoke observado. A rota específica elimina a ambiguidade:

```text
Gateway:  .../custom-opencode-zen/chat/completions
Base URL: https://opencode.ai/zen/v1
Upstream: https://opencode.ai/zen/v1/chat/completions
```

O AI SDK já classifica `401`, `403` e `404` como não retentáveis. As três
chamadas vieram do retry do Workflow, portanto a classificação precisa cruzar a
fronteira do adapter e produzir `NonRetryableError` no step.

## Fontes

Verificadas em 2026-08-30:

- [OpenCode Zen](https://dev.opencode.ai/docs/zen/)
- [AI Gateway Custom Providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
- [Workflows sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)

## Validação pendente

- Deploy do control plane com a rota específica.
- Smoke real confirmando tokens, resposta estruturada e publicação no PR.
- Inspeção de uma falha `401` induzida para confirmar uma única chamada remota.
