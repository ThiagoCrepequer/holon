---
id: ADR-0005
kind: decision
status: accepted
date: 2026-08-29
owners:
  - core-team
supersedes: []
related:
  - 0003-adopt-initial-typescript-application-stack.md
  - ../research/2026-08-29-typescript-monorepo-toolchain.md
---

# Usar a API REST atual do AI Gateway com AI SDK

## Contexto

ADR-0003 selecionou `ai-gateway-provider`. Durante o bootstrap, a versão atual
`4.0.0` declarou AI SDK 7 como peer, mas instalou opcionalmente
`@openrouter/ai-sdk-provider@2`, que exige AI SDK 6. Com peer dependencies
estritos, o grafo publicado não é instalável sem ignorar o conflito ou forçar
uma major não declarada.

Desde maio de 2026, o AI Gateway também oferece uma API REST oficial em
`api.cloudflare.com`, com endpoint OpenAI-compatible, Unified Billing e seleção
do gateway por header. Essa API é compatível com providers OpenAI-compatible.

## Decisão

Não relaxaremos peers nem aplicaremos override transiente. O adapter
`@holon/model` usará AI SDK 7 com `@ai-sdk/openai-compatible` sobre:

```text
https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1
```

O token Cloudflare será secret binding, o modelo usará o formato
`author/model`, e `cf-aig-gateway-id` selecionará o gateway. O adapter continuará
atrás de `ModelClient`, portanto uma integração oficial futura pode substituí-lo
sem alterar a aplicação.

Esta decisão substitui apenas a escolha de `ai-gateway-provider` em ADR-0003;
as demais decisões daquele ADR permanecem vigentes.

## Consequências

- O grafo mantém peer dependencies estritos e instaláveis.
- O MVP usa a API REST mais recente, sem a Universal API depreciada.
- Fallback será configurado por Dynamic Routing ou política do gateway, não por
  um array específico do pacote removido.
- O adapter precisa testar URL, headers, structured output, timeout e telemetria.

## Evidência

Verificada em 2026-08-29:

- [AI Gateway REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [AI Gateway changelog](https://developers.cloudflare.com/changelog/post/2026-05-21-rest-api/)
- Metadados npm publicados de `ai-gateway-provider@4.0.0` e
  `@openrouter/ai-sdk-provider@2.10.0`.
