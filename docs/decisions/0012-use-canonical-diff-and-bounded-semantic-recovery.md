---
id: ADR-0012
kind: decision
status: accepted
date: 2026-08-30
owners:
  - core-team
supersedes:
  - 0011-centralize-model-fallback-in-dynamic-route.md
related:
  - ../architecture/review-runtime-flow.md
  - ../research/2026-08-30-canonical-diff-and-semantic-output-incident.md
---

# Usar diff canônico e recuperação semântica limitada

## Contexto e problema

Uma run real recebeu um PR com um arquivo e 651 bytes de diff, mas o executor
calculou `git diff baseSha headSha` e enviou aproximadamente 109 kB ao modelo.
O GitHub apresenta Pull Requests com comparação de três pontos, baseada no
merge-base. A comparação direta das pontas incluiu mudanças que chegaram à
base depois da criação da branch.

O modelo recebeu 37.453 tokens, consumiu os 4.000 tokens de output em reasoning
e respondeu HTTP 200 com `finish_reason=length` e sem conteúdo final. A Dynamic
Route encerrou em sucesso de transporte e não acionou outro fallback.

## Decisão

- O GitHub App obtém o diff canônico do endpoint de Pull Request com media type
  `diff`. O executor não recalcula o diff a partir das pontas das branches.
- O Sandbox faz somente checkout exato do head e investigação direcionada.
- A entrada inicial aceita no máximo 50 arquivos suportados, 120 kB de patches
  completos e 5.000 coordenadas. Um arquivo nunca é cortado no meio de um hunk.
- Contexto excedente gera review explicitamente parcial; PR sem alteração
  TypeScript/JavaScript não chama o modelo.
- A Dynamic Route continua responsável por falhas de transporte e provider.
- Uma resposta HTTP bem-sucedida sem objeto utilizável pode executar exatamente
  uma recuperação local sem tools. O Workflow e o AI SDK não repetem a sessão.
- Requests pedem provider com os parâmetros requeridos, negam coleta de dados
  no OpenRouter e limitam reasoning a `low`.
- O schema final permite no máximo três findings e é compatível com o budget de
  4.000 tokens.
- O AI Gateway não persiste request/response. Somente metadados seguros de run,
  contagens, tokens e finish reason permanecem observáveis.

## Consequências

### Positivas

- O modelo analisa a mesma superfície exibida e comentável no GitHub.
- O custo deixa de depender do avanço posterior da branch base.
- Falha semântica recebe uma recuperação barata sem reconstruir checkout,
  histórico de tools ou Workflow.
- PRs fora do budget permanecem honestos: o resumo informa parcialidade.
- Código privado não fica armazenado nos logs do AI Gateway.

### Negativas

- O endpoint de diff impõe uma chamada GitHub adicional antes do Sandbox.
- PRs acima do limite não recebem cobertura integral no MVP.
- A recuperação usa a mesma Dynamic Route; ela melhora o contrato de saída, mas
  não garante diversidade de modelo quando a primeira resposta foi HTTP 200.
- `require_parameters` pode reduzir o conjunto de endpoints OpenRouter aptos.

## Critérios de confirmação

- Fixture com base avançada prova que o executor usa somente o diff entregue
  pelo GitHub e não executa `git diff`.
- Prompt inicial permanece abaixo de 100 kB e compacta linhas consecutivas em
  ranges.
- Resposta sem output executa uma recuperação sem tools; uma segunda falha
  encerra a run.
- Queue reconhece payload inválido sem redelivery e repete somente falha ao
  criar Workflow.
- Falha terminal publica uma notificação idempotente e limpa o Sandbox antes.
- Smoke remoto confirma tool call, structured output, payload logging desligado
  e publicação no PR.

## Evidência

Verificada em 2026-08-30:

- [GitHub: three-dot and two-dot diffs](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/viewing-and-comparing-commits/about-comparing-branches-in-pull-requests)
- [GitHub REST pull requests](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
- [AI Gateway fallbacks](https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/)
- [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)
- [OpenRouter reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
