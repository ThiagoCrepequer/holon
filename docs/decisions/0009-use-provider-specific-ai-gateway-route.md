---
id: ADR-0009
kind: decision
status: superseded
date: 2026-08-30
owners:
  - core-team
supersedes:
  - 0007-use-ai-gateway-compat-with-byok.md
related:
  - 0010-use-dynamic-route-for-pr-review.md
  - ../operations/deployment.md
  - ../research/2026-08-30-ai-gateway-provider-path-incident.md
---

# Usar rota específica do Custom Provider e uma camada de retries

> Substituída por
> [ADR-0010](0010-use-dynamic-route-for-pr-review.md) após os smokes mostrarem
> que o prefixo não padrão do OpenCode Zen também não era representado pelo
> Dynamic Route, enquanto a rota `dynamic/pr-review` com OpenRouter usa o
> contrato `/compat` esperado pela Cloudflare.

## Contexto e problema

O primeiro smoke real do modelo chegou ao AI Gateway, mas as três tentativas
receberam uma página HTML `404 - Page Not Found` do OpenCode. O request usava
`/compat/chat/completions`, o identificador
`custom-opencode-zen/deepseek-v4-flash` e um Custom Provider com base URL
`https://opencode.ai/zen/v1`.

Um `POST` sem credencial diretamente para
`https://opencode.ai/zen/v1/chat/completions` respondeu `401 Missing API key`,
confirmando que o endpoint existe. A documentação do AI Gateway recomenda a
rota específica quando o provider exige caminho não padrão e define que o
caminho após `custom-{slug}/` é anexado à base URL.

O mesmo smoke mostrou outra ineficiência: o AI SDK não repetiu o `404`, mas o
step `analyze-review` do Workflow executou uma tentativa inicial e duas
repetições. `401`, `403` e `404` são falhas determinísticas para o mesmo request
e não devem consumir novas chamadas.

## Direcionadores

- Preservar BYOK sem expor a chave OpenCode ao Worker.
- Construir deterministicamente o endpoint upstream documentado pelo OpenCode.
- Manter retry para falhas transitórias sem multiplicar tentativas entre SDK e
  Workflow.
- Não propagar prompt, diff ou resposta do provider em mensagens de erro.

## Opções consideradas

### Manter `/compat` e alterar a base URL no dashboard

- Prós: nenhuma mudança no adapter.
- Contras: não representa diretamente o prefixo não padrão `/zen/v1` e não
  corrige a política de retries do Workflow.

### Usar a rota específica e manter retries no SDK e no Workflow

- Prós: corrige o path com mudança pequena.
- Contras: uma falha transitória poderia multiplicar tentativas nas duas
  camadas e ampliar custo e latência.

### Usar a rota específica e centralizar retries no Workflow

- Prós: path explícito, checkpoints observáveis e limite único de tentativas.
- Contras: o adapter precisa separar provider e modelo no valor configurado.

## Decisão

O adapter interpreta `AI_MODEL_ID` no formato
`custom-{slug}/{upstream-model}`. O primeiro segmento seleciona a rota do AI
Gateway e é removido antes de enviar o campo `model` ao provider:

```text
AI_MODEL_ID=custom-opencode-zen/deepseek-v4-flash
AI SDK baseURL=https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-opencode-zen
upstream model=deepseek-v4-flash
```

Com a base URL `https://opencode.ai/zen/v1`, o AI SDK acrescenta
`/chat/completions` e o Gateway encaminha para o endpoint esperado do OpenCode.
O Worker continua enviando apenas `cf-aig-authorization`; o Gateway injeta a
chave de provider armazenada no alias BYOK `default`.

O AI SDK usa `maxRetries: 0`. `APICallError` é convertido em erro sanitizado que
preserva somente `statusCode` e `isRetryable`. Falhas não retentáveis são
convertidas em `NonRetryableError` dentro de `analyze-review`; falhas
transitórias permanecem sujeitas ao limite de duas repetições do Workflow.

## Consequências

### Positivas

- A URL upstream passa a ser determinística e compatível com `/zen/v1`.
- `400`, `401`, `403`, `404` e outras falhas marcadas como permanentes não são
  repetidas pelo Workflow.
- Uma falha transitória gera no máximo três chamadas totais no step, não nove.
- Erros que atravessam o limite do modelo não carregam prompt ou resposta.

### Negativas

- `AI_MODEL_ID` passa a ter um formato obrigatório de Custom Provider.
- Trocar para um provider nativo exigirá outra estratégia ou evolução explícita
  da configuração.

## Critérios de confirmação

- Teste unitário prova rota específica, modelo upstream e ausência de chave do
  provider.
- Testes provam uma tentativa para `401`, `403` e `404`, preservando três para
  `500` retentável.
- Smoke real produz tokens no AI Gateway e conclui a publicação no PR.
- O log do Gateway mostra o endpoint e o modelo sem resposta HTML `404`.

## Gatilhos para revisitar

- AI Gateway corrigir e documentar `/compat` com prefixos fixos de Custom
  Providers.
- OpenCode Zen tornar-se provider nativo ou alterar seu endpoint.
- O Workflow passar a oferecer política de retry por status sem
  `NonRetryableError` explícito.

## Evidência

Verificada em 2026-08-30:

- [OpenCode Zen endpoints](https://dev.opencode.ai/docs/zen/)
- [AI Gateway Custom Providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
- [Workflows sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
