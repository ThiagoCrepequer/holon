---
id: OPERATIONS-DEPLOYMENT
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-09-08
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
2. Crie as filas de revisão e as filas de projeção analítica com DLQs:

   ```bash
   pnpm exec wrangler queues create holon-review-jobs-dlq
   pnpm exec wrangler queues create holon-review-jobs
   pnpm exec wrangler queues create holon-admin-projections-dlq --delivery-delay-secs 0 --message-retention-period-secs 345600
   pnpm exec wrangler queues create holon-admin-projections --delivery-delay-secs 0 --message-retention-period-secs 345600
   ```

3. Crie o banco de dados Cloudflare D1 para o read model administrativo:

   ```bash
   pnpm exec wrangler d1 create holon-admin-d1
   ```

4. Configure o GitHub App conforme [github-app.md](github-app.md).
5. Configure no control plane os nomes externos listados em
   [desenvolvimento local](local-development.md#secrets-locais). Use
   `wrangler secret put` para credenciais (`GITHUB_APP_PRIVATE_KEY_CURRENT`,
   `GITHUB_APP_PRIVATE_KEY_PREVIOUS`, seguindo o
   [runbook de rotação de chave](github-app-key-rotation-runbook.md)); App, account e gateway IDs podem ser
   variáveis por ambiente. Configure o binding existente como
   `AI_MODEL_ID=dynamic/pr-review`; o token Cloudflare precisa de
   `AI Gateway Run`. A chave OpenRouter permanece exclusivamente no BYOK.
6. Somente em uma conta vazia, crie o alvo do binding com o executor bootstrap.
   Ele não possui broker e não deve receber tráfego de review:

   ```bash
   pnpm --filter @holon/repository-executor deploy:bootstrap
   ```

7. Faça deploy do control plane dual-stack. Em ambiente já provisionado, este é
   o primeiro deploy da atualização: ele oferece o broker e o `AdminReadEntrypoint`,
   mantendo producer desativado por flag até o consumidor estar ativo:

   ```bash
   pnpm --filter @holon/control-plane deploy
   ```

8. Execute as migrations D1 do read model e faça deploy do `apps/admin`:

   ```bash
   pnpm --filter @holon/admin d1:migrate:remote
   pnpm --filter @holon/admin deploy
   ```

9. Faça deploy do executor final com o binding para o entrypoint nomeado do
   broker:

   ```bash
   pnpm --filter @holon/repository-executor deploy
   ```

O Wrangler aplica as migrations do Durable Object SQLite e do D1, registrando Workflows,
Queue bindings e os service bindings definidos nos `wrangler.jsonc`. Não
abra tráfego no bootstrap; confirme os deploys finais antes do smoke.

## Deploy automático com Workers Builds

O repositório remoto é `ThiagoCrepequer/holon` e sua branch padrão é `main`.
Cada deployable pode manter uma conexão de build com o mesmo monorepo:

| Worker                      | Root | Branch | Build command                                        |
| --------------------------- | ---- | ------ | ---------------------------------------------------- |
| `holon-repository-executor` | `/`  | `main` | `pnpm --filter @holon/repository-executor typecheck` |
| `holon-control-plane`       | `/`  | `main` | `pnpm --filter @holon/control-plane typecheck`       |

O root permanece no topo porque ambos os apps dependem do workspace e do
lockfile do monorepo. Deploy automático independente dos dois Workers fica
desabilitado: os bindings são bidirecionais e a ordem control plane -> executor
é parte do contrato de rollout. Uma pipeline futura pode automatizar exatamente
essa sequência com aprovação. O executor final usa `wrangler deploy`, pois
`wrangler versions upload` não atualiza imagens de Containers. Mantenha o
include watch path `*` para validar mudanças compartilhadas.

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
- [Service bindings: ordem de primeiro deploy](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/#deployment)

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
16. Publique executor, control-plane e admin da mesma revisão, admitindo indisponibilidade
    durante a atualização. Preparação, contexto e detalhe admin exigem os contratos atuais; não há downgrade. Confirme uso do broker sem token
    em parâmetros do executor. Não retome Workflows antigos como forma de validar
    o novo contrato; inicie uma execução nova após concluir os deploys.
17. Entregue eventos sintéticos B e depois A para o mesmo PR, com `updatedAt`
    de B mais novo; confirme que A fica obsoleto. Repita com `updatedAt`
    empatado e `receivedAt` distinto para confirmar o desempate causal.
18. Faça force-push entre um comentário inline e a review-resumo; confirme que
    a segunda mutação é bloqueada pela nova leitura de head e pela autorização
    do ledger.
19. Induza falha transitória na destruição do Sandbox; confirme tarefa de
    cleanup pendente, nova tentativa por alarm e remoção do credential scope
    somente depois da destruição confirmada.
20. Use um rename de caminho potencialmente sensível para caminho comum e uma
    `.sgconfig.yml` hostil no repositório; confirme que nenhum lado aparece em
    leitura/busca e que ast-grep continua usando `/opt/holon/sgconfig.yml`.

Evidência em 2026-08-31: os itens 3 e 4 foram observados em PRs públicos, e o
encerramento parcial de um PR grande também foi exercitado. Isso não marca os
demais itens como concluídos e não substitui a repetição do checklist para cada
rollout. Consulte o
[snapshot do smoke remoto](../research/2026-08-31-live-github-app-review-smoke.md).

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

## Identificação de versões (2026-09-05)

Consulte o [runbook de identificação](project-version-identification.md) para configuração, deploy coordenado, corpus offline/live e invalidação por perfil. A identificação faz parte do workflow padrão; `observe` registra os resultados sem enriquecer a investigação.

## Transição dos checkpoints do core — ADR-0034

Esta alteração tem validação local, sem deploy ou smoke remoto nesta entrega.
Não exige novos secrets, bindings ou recursos remotos. A migration 13 do SQLite
é automática no DO e aditiva; isso não torna compatíveis os históricos antigos
do Workflow com a nova sequência de steps.

Antes de um deploy autorizado, suspenda novas admissões e drene as instâncias
antigas. Se for necessário interrompê-las, use o fluxo operacional de
terminalização/cancelamento com cleanup e confirme que as obrigações foram
concluídas antes de substituir o código. Não retome instâncias antigas sob o
novo código, nem instâncias novas sob rollback para o código anterior. Reabra
admissões somente depois de confirmar a transição. Não apagar ledger para
forçar compatibilidade.

No smoke posterior, verificar uma run nova, retomada entre shards, preservação
de uso/versões, feedback durante publicação e cleanup de artefatos em sucesso,
falha e obsolescência. A prova local não substitui esse smoke. Referência:
[ADR-0034](../decisions/0034-make-review-checkpoints-and-revalidation-durable.md).

## Contratos únicos de desenvolvimento — ADR-0036

Antes de um deploy autorizado, parar a admissão e concluir ou terminalizar as
runs existentes, confirmando cleanup dos containers com o código que as criou.
Atualizar control-plane, executor e admin para a mesma revisão. Não retomar
checkpoints, artefatos de análise ou mensagens de fila do formato anterior.

A política YAML passa a omitir o campo de versão. O único nome aceito para a
chave principal do App é `GITHUB_APP_PRIVATE_KEY_CURRENT`. Contextos, jobs,
projeções e detalhes admin seguem os schemas atuais, sem aliases ou conversão.
Findings persistidos exigem identidade de evidência e confiança; runs exigem
relógio causal explícito. Marcadores/event IDs novos não reconciliam publicações
no formato antigo: validar com novas runs/PRs sintéticos.

Se o estado de desenvolvimento foi criado sob os contratos anteriores, preparar
um reset explícito de ledger, cache, filas e read model D1 antes da validação.
O schema inicial D1 remove colunas de versão de formato. Não aplicar o seed
atual sobre um schema antigo nem assumir que reaplicar uma migration já marcada
refará o banco. A decisão entre preservar uma cópia de diagnóstico e descartar
o estado, e a execução desse reset, exigem autorização específica. Esta mudança
não apaga bancos, caches, filas ou namespaces automaticamente.

Após a atualização e eventual reset autorizado, validar uma nova run completa,
incluindo policy, credencial JIT, contexto, publicação, projeção e cleanup.
Ver [ADR-0036](../decisions/0036-use-single-current-development-contracts.md).
