---
id: RESEARCH-2026-08-30-CANONICAL-DIFF-AND-SEMANTIC-OUTPUT
kind: research
status: current
date: 2026-08-30
owners:
  - core-team
related:
  - ../decisions/0012-use-canonical-diff-and-bounded-semantic-recovery.md
  - ../architecture/review-runtime-flow.md
---

# Incidente de diff divergente e output semântico ausente

## Evidência observada

- O PR observado tinha um arquivo, 13 linhas e 651 bytes no diff canônico.
- O prompt enviado pelo Holon tinha 144.295 caracteres; o bloco de diff tinha
  aproximadamente 109.512 caracteres e o provider recebeu 37.453 input tokens.
- O executor usava `git diff baseSha headSha --unified=80`.
- A branch base havia avançado depois da criação da branch do PR.
- A resposta veio de `deepseek/deepseek-v4-flash-0731`, provider Wafer, com
  HTTP 200, `finish_reason=length`, 4.000 completion tokens, conteúdo nulo e
  nenhum tool call.
- `analyze-review` executou uma vez; terminalização e cleanup concluíram.

## Diagnóstico

O diff de duas pontas atribuiu ao PR alterações da base que não pertenciam à
branch. Isso inflou a superfície em aproximadamente 168 vezes. O modelo, cujo
reasoning estava habilitado por padrão, consumiu o output inteiro antes de
produzir o objeto final. A Dynamic Route não considera validade do schema da
aplicação ao decidir fallback depois de HTTP 200.

## Correções resultantes

- diff canônico obtido do GitHub e transportado como contrato validado;
- patches completos e budgets menores;
- ranges compactos em vez de coordenadas repetidas;
- reasoning `low`, até três findings e uma recuperação sem tools;
- payload logging desligado, mantendo metadados seguros;
- feedback explícito no PR em falha terminal.

## Limites

Os testes locais provam contratos e comportamento. A compatibilidade real da
Dynamic Route, o header de privacidade e a publicação ainda exigem um smoke
após deploy.

## Fontes

Verificadas em 2026-08-30:

- [GitHub comparing branches](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/viewing-and-comparing-commits/about-comparing-branches-in-pull-requests)
- [GitHub REST pull requests](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
- [Cloudflare Dynamic Routes](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/json-configuration/)
- [Cloudflare AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)
- [OpenRouter reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
