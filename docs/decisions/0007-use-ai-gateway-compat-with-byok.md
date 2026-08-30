---
id: ADR-0007
kind: decision
status: superseded
date: 2026-08-30
owners:
  - core-team
supersedes:
  - 0005-use-ai-gateway-rest-api-with-ai-sdk.md
related:
  - 0003-adopt-initial-typescript-application-stack.md
  - 0009-use-provider-specific-ai-gateway-route.md
  - ../operations/deployment.md
---

# Usar AI Gateway Compat com Custom Provider e BYOK

> Substituída por
> [ADR-0009](0009-use-provider-specific-ai-gateway-route.md) após o smoke real
> demonstrar que `/compat` não preservou o prefixo `/zen/v1` do OpenCode Zen.

## Contexto e problema

O MVP selecionou OpenCode Zen e DeepSeek V4 Flash. O OpenCode expõe esse
modelo pelo contrato OpenAI-compatible em
`https://opencode.ai/zen/v1/chat/completions`. No AI Gateway, OpenCode Zen não
é um provider nativo: precisa ser cadastrado como Custom Provider.

A API REST escolhida no ADR-0005 usa `api.cloudflare.com`, mas a documentação
atual de Custom Providers descreve seu consumo pelo endpoint unificado
`/compat` ou pelo endpoint específico do provider em
`gateway.ai.cloudflare.com`. BYOK também exige que a aplicação não envie a
chave do provider e autentique o gateway com `cf-aig-authorization`.

## Direcionadores

- Não expor a chave OpenCode ao Worker quando o AI Gateway pode injetá-la.
- Preservar AI SDK 7 e `@ai-sdk/openai-compatible`.
- Manter a seleção de modelo configurável sem acoplar a aplicação ao SDK do
  OpenCode.
- Usar uma rota oficialmente documentada para Custom Providers.

## Opções consideradas

### Continuar na API REST de `api.cloudflare.com`

- Prós: mantém o endpoint anterior e autenticação no header padrão.
- Contras: o consumo de Custom Providers não está documentado nessa rota.

### Usar o endpoint específico do Custom Provider

- Prós: controle integral do caminho encaminhado ao upstream.
- Contras: acopla a URL do adapter ao slug e ao prefixo fixo do OpenCode Zen.

### Usar o endpoint unificado `/compat`

- Prós: é a opção recomendada para APIs OpenAI-compatible e mantém o provider
  selecionável no identificador do modelo.
- Contras: exige o formato `custom-{slug}/{model}` e usa
  `gateway.ai.cloudflare.com`.

## Decisão

O adapter `@holon/model` usará:

```text
https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat
```

O token com permissão `AI Gateway Run` será enviado exclusivamente como
`cf-aig-authorization: Bearer ...`. Nenhum header `Authorization` de provider
será produzido pela aplicação; o AI Gateway injetará a chave OpenCode
armazenada por BYOK.

Para o provider com slug `opencode-zen`, o modelo inicial será configurado como:

```text
custom-opencode-zen/deepseek-v4-flash
```

O adapter continuará usando `@ai-sdk/openai-compatible`. O suporte nativo a
JSON Schema não será presumido: a saída continuará em JSON mode, seguida da
validação local estrita já existente.

## Consequências

### Positivas

- A chave OpenCode fica centralizada no Secrets Store administrado pelo BYOK.
- A aplicação usa a integração documentada para Custom Providers.
- Trocar para outro provider OpenAI-compatible não muda a porta da aplicação.

### Negativas

- Custom Providers e BYOK ainda aparecem como beta na documentação atual.
- O valor de `AI_MODEL_ID` depende do slug configurado na conta Cloudflare.
- Um teste local não prova tool calls e saída estruturada no modelo real.

## Critérios de confirmação

- Teste unitário prova URL e header Cloudflare sem `apiKey` do provider.
- Chamada real ao DeepSeek V4 Flash conclui uma resposta simples.
- Smoke real prova as três tools, múltiplos passos e validação por
  `modelReviewOutputSchema`.
- Logs do AI Gateway identificam gateway, provider e modelo sem expor chaves.

## Gatilhos para revisitar

- OpenCode Zen tornar-se provider nativo do AI Gateway.
- A API REST de `api.cloudflare.com` documentar Custom Providers com BYOK.
- O modelo deixar de suportar tool calling ou JSON mode pelo endpoint atual.

## Evidência

Verificada em 2026-08-30:

- [OpenCode Zen endpoints](https://opencode.ai/docs/zen/)
- [AI Gateway Custom Providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
- [AI Gateway BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)
- [Authenticated Gateway](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)
