---
id: OPERATIONS-DEPLOYMENT
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-08-30
---

# Provisionamento e deploy

O primeiro deploy remoto foi executado em 2026-08-29. Os comandos abaixo são
um runbook e causam efeitos externos; confirme conta e ambiente antes de usá-los.

## Recursos

1. No AI Gateway `holon`, adicione a chave OpenRouter em Provider Keys/BYOK,
   habilite Authenticated Gateway e publique a versão desejada do Dynamic Route
   `pr-review`. Confirme no editor que todos os modelos ativos selecionam
   OpenRouter e suportam tool calling e structured outputs. Modelos sem esses
   dois contratos não devem permanecer nem como último fallback.
2. Crie a DLQ e a Queue principal:

   ```bash
   pnpm exec wrangler queues create holon-review-jobs-dlq
   pnpm exec wrangler queues create holon-review-jobs
   ```

3. Configure o GitHub App conforme [github-app.md](github-app.md).
4. Faça deploy primeiro do executor, porque o control plane possui um service
   binding para ele:

   ```bash
   pnpm --filter @holon/repository-executor deploy
   ```

5. Configure no control plane os nomes externos listados em
   [desenvolvimento local](local-development.md#secrets-locais). Use
   `wrangler secret put` para credenciais; App, account e gateway IDs podem ser
   variáveis por ambiente. Configure o binding existente como
   `AI_MODEL_ID=dynamic/pr-review`; o token Cloudflare precisa de
   `AI Gateway Run`. A chave OpenRouter permanece exclusivamente no BYOK.
6. Faça deploy do control plane:

   ```bash
   pnpm --filter @holon/control-plane deploy
   ```

O Wrangler aplica a migration v1 do Durable Object SQLite e registra Workflow,
Queue bindings e service binding definidos nos respectivos `wrangler.jsonc`.

## Deploy automático com Workers Builds

O repositório remoto é `ThiagoCrepequer/holon` e sua branch padrão é `main`.
Cada deployable precisa de uma conexão própria com o mesmo monorepo:

| Worker                      | Root | Branch | Build command                                        | Deploy command                                    |
| --------------------------- | ---- | ------ | ---------------------------------------------------- | ------------------------------------------------- |
| `holon-repository-executor` | `/`  | `main` | `pnpm --filter @holon/repository-executor typecheck` | `pnpm --filter @holon/repository-executor deploy` |
| `holon-control-plane`       | `/`  | `main` | `pnpm --filter @holon/control-plane typecheck`       | `pnpm --filter @holon/control-plane deploy`       |

O root permanece no topo porque ambos os apps dependem do workspace e do
lockfile do monorepo. O executor deve manter `wrangler deploy` na branch de
produção: `wrangler versions upload` não atualiza imagens de Containers.
Na configuração inicial, desabilite builds de branches não produtivas nos dois
Workers e mantenha o include watch path `*`, para que mudanças em pacotes
compartilhados ou arquivos raiz também disparem os deploys.

A autorização inicial do Cloudflare GitHub App é interativa no dashboard. Após
essa autorização única, as conexões, triggers e variáveis de build também podem
ser administradas pela Workers Builds API com um token de usuário que tenha
`Workers Builds Configuration: Edit`. Runtime secrets continuam nas
configurações do Worker; build variables não os substituem.

Fontes verificadas em 2026-08-30:

- [Using a dynamic route](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Configuração de builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Monorepos](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
- [Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)

## Smoke test controlado

1. Confirme `GET /health` com status 200.
2. Use um repositório sintético privado instalado explicitamente no App.
3. Abra um PR sem bug e confirme uma única review-resumo.
4. Abra um PR com regressão conhecida e confirme coordenada `line`/`side`.
5. Reentregue o mesmo webhook e confirme ausência de novos comentários.
6. Force-push durante uma análise e confirme outcome `obsolete` sem publicação.
7. Revogue/desinstale o App e confirme que novas runs falham sem expor segredo.
8. Nos logs do AI Gateway, confirme `response_format` com JSON Schema, ausência
   de payload armazenado e presença apenas dos cinco metadados seguros. Confirme
   em Workers Logs `finishReason`, tokens, tentativa e contagem de tools. Cache
   de prompt do provider é independente.
9. Induza uma resposta estruturada inválida em ambiente de teste e confirme um
   único `analyze-review`, com no máximo uma inferência adicional marcada como
   `recovery` e sem tools. O Workflow não pode repetir a sessão.
10. Abra um PR cuja base avançou depois da criação da branch e compare a
    contagem de linhas do GitHub com `repository.prepared`.
11. Abra um PR somente de documentação e confirme uma chamada de modelo em modo
    textual; tente uma tool estrutural e confirme rejeição no host.
12. Abra um PR contendo somente lockfile ou artefato gerado e confirme zero
    tokens de modelo. Repita com um caminho potencialmente sensível reconhecido
    pela política e confirme que `read_file` e buscas não conseguem recuperá-lo.
13. Abra um PR somente com rename, metadata ou remoções sem linha adicionada
    comentável e confirme uma chamada de modelo, zero finding inline e risco
    comprovado limitado ao resumo.
14. Em um PR misto, confirme que ambos os modos recebem oportunidade inicial,
    a seleção seguinte favorece structural em 3:1, arquivos ignorados não
    aparecem em tools e o resumo declara truncamento quando algum limite for
    atingido.
15. Solicite duas páginas consecutivas de um arquivo grande e confirme que cada
    `read_file` retorna no máximo 500 linhas/100 kB, sem carregar o arquivo
    inteiro, e que páginas de paths ignorados são rejeitadas.

## Observabilidade e rollback

O código emite JSON estruturado para `review.started`, `repository.prepared`,
`model.input`, `model.usage`,
`review.completed`, `review.failed` e falhas secundárias de cleanup ou
terminalização. Os campos incluem run, IDs não secretos, duração, outcome,
tokens, contagens de arquivos estruturais/textuais e quantidade publicada; não
incluem prompt, diff, nome de arquivo ou mensagem
arbitrária de erro. Antes do piloto, configure retenção e acesso aos logs e ao
AI Gateway. O header `cf-aig-collect-log-payload=false` é obrigatório; removê-lo
expõe código do repositório nos logs do Gateway.

Uma versão anterior pode ser reimplantada, mas migrations de Durable Objects não
devem ser removidas ou reutilizadas. O executor é efêmero; runs em andamento
podem ser repetidas e serão reconciliadas pelo ledger e pelos marcadores GitHub.
