---
id: ADR-0010
kind: decision
status: accepted
date: 2026-08-30
owners:
  - core-team
supersedes:
  - 0009-use-provider-specific-ai-gateway-route.md
related:
  - ../operations/deployment.md
  - ../research/2026-08-30-ai-gateway-provider-path-incident.md
  - ../research/2026-08-30-agentic-review-completion-incident.md
---

# Usar Dynamic Route para selecionar o modelo de PR review

## Contexto e problema

O OpenCode Zen exige o endpoint não padrão `/zen/v1/chat/completions`. Smokes
reais mostraram que o Custom Provider e o Dynamic Route selecionavam o
OpenCode, mas não preservavam esse prefixo e recebiam HTML `404` sem tokens.

O AI Gateway exige que Dynamic Routes sejam chamadas pelo endpoint OpenAI
compatible `/compat/chat/completions`. Uma chave OpenRouter já está disponível
no BYOK do gateway e a rota publicada `dynamic/pr-review` seleciona esse
provider sem exigir um prefixo de path específico.

## Direcionadores

- Manter chaves de provider fora do Worker e do repositório.
- Permitir trocar modelo e fallback sem novo deploy do Holon.
- Preservar AI SDK 7, tool calls, saída estruturada e validação local.
- Manter uma única camada explícita de retries no Workflow.
- Validar explicitamente o identificador da rota na fronteira de configuração.

## Opções consideradas

### Continuar com a rota específica do OpenCode Zen

- Prós: mantém o modelo inicialmente escolhido.
- Contras: o path não padrão permaneceu incompatível com o comportamento
  observado e exigiria acoplamento adicional ou um proxy.

### Chamar o OpenRouter diretamente pela aplicação

- Prós: contrato OpenAI-compatible conhecido e controle integral no adapter.
- Contras: duplica no código a seleção que o AI Gateway pode administrar e
  reduz a utilidade do Dynamic Route.

### Usar `dynamic/pr-review` pelo endpoint `/compat`

- Prós: segue o contrato documentado de Dynamic Routes, centraliza provider,
  modelo e fallback no Gateway e mantém BYOK.
- Contras: Dynamic Routing ainda é beta e parte da configuração publicada vive
  no estado remoto da conta Cloudflare.

## Decisão

O adapter `@holon/model` aceitará `AI_MODEL_ID` somente no formato
`dynamic/{route}`. A configuração inicial do binding será:

```text
AI_MODEL_ID=dynamic/pr-review
AI SDK baseURL=https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat
upstream model=dynamic/pr-review
```

O Worker enviará `cf-aig-authorization` e a política `cf-aig-skip-cache` ao AI
Gateway, mas nenhuma chave do provider. A chave OpenRouter permanecerá no BYOK
e a rota publicada decidirá o provider e o modelo concretos. O AI SDK
continuará com `maxRetries: 0`; a política de repetição e a classificação de
erros permanecem no Workflow.

## Adendo operacional de 2026-08-30

O primeiro review agentivo via OpenRouter demonstrou quatro requisitos do
adapter que não são responsabilidade da Dynamic Route:

- declarar `supportsStructuredOutputs: true`, para que o AI SDK envie JSON
  Schema estrito em vez de apenas JSON mode;
- ignorar o cache exato do Gateway durante o loop agentivo, pois tool results e
  o estado efêmero do repositório fazem parte da execução corrente;
- disponibilizar tools por no máximo seis passos e reservar o sétimo para a
  resposta final estruturada, sem tools;
- tratar ausência de output, objeto inválido, schema inválido e budget de tools
  esgotado como falhas determinísticas, sem retry do Workflow.

Retries duráveis continuam válidos para falhas transitórias classificadas do
provider. A sequência de modelos da Dynamic Route precisa conter apenas modelos
compatíveis com tool calling e structured outputs; essa configuração permanece
um binding remoto validado por smoke.

## Consequências

### Positivas

- Provider, modelo e fallback podem evoluir no Gateway sem alterar o Worker.
- O código deixa de conhecer slugs e paths específicos de providers.
- A chave OpenRouter não atravessa o control plane.

### Negativas

- A definição interna da rota não está representada neste repositório e pode
  sofrer drift no painel.
- O nome da rota é um binding remoto e precisa ser reconciliado no deploy.
- Um route/model publicado sem suporte adequado a tools ou saída estruturada
  só será detectado por smoke remoto.
- Dynamic Routing permanece beta e exige monitoramento de mudanças de contrato.

## Critérios de confirmação

- Teste unitário prova base URL `/compat`, modelo `dynamic/pr-review`, JSON
  Schema estrito, bypass do cache e ausência de chave do provider.
- Teste unitário prova que o último passo não expõe tools e que erros
  determinísticos fazem uma única tentativa.
- O binding remoto `AI_MODEL_ID` contém `dynamic/pr-review` após o deploy.
- Smoke real registra `cf-aig-provider` como OpenRouter, produz tokens e conclui
  uma review estruturada.
- Falhas permanentes continuam com uma tentativa; falhas transitórias respeitam
  o limite do Workflow.

## Gatilhos para revisitar

- A Cloudflare disponibilizar exportação declarativa estável da rota publicada.
- Dynamic Routing sair de beta ou alterar o endpoint obrigatório.
- O modelo selecionado deixar de atender tools, contexto ou saída estruturada.
- Uma política de fallback no Gateway conflitar com o budget de custo do Holon.

## Evidência

Verificada em 2026-08-30:

- [Using a dynamic route](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/)
- [Dynamic routing](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/)
- [OpenRouter provider](https://developers.cloudflare.com/ai-gateway/usage/providers/openrouter/)
- [AI Gateway BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)
- [AI Gateway caching](https://developers.cloudflare.com/ai-gateway/features/caching/)
- [AI SDK OpenAI-compatible providers](https://ai-sdk.dev/providers/openai-compatible-providers)
- [AI SDK tools with structured outputs](https://ai-sdk.dev/docs/troubleshooting/tool-calling-with-structured-outputs)
