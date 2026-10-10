---
id: OPERATIONS-DEPLOYMENT
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
---

# Provisionamento e deploy

O primeiro deploy remoto foi executado em 2026-08-29. Os comandos abaixo são
um runbook e causam efeitos externos; confirme conta e ambiente antes de usá-los.

## Deploy automático atual

Os Workers Builds mantêm os comandos não interativos existentes, executados a
partir da raiz do repositório:

```sh
pnpm --filter @holon/control-plane run deploy
pnpm --filter @holon/repository-executor run deploy
```

Ambos executam `wrangler deploy`, como antes do PR #108. O bootstrap do executor
continua disponível via `pnpm --filter @holon/repository-executor run deploy:bootstrap`
e usa `wrangler.bootstrap.jsonc` somente no primeiro provisionamento.

A [ADR-0048](../decisions/0048-restore-automatic-worker-deployments.md) restaura esse
fluxo sem mudança de configuração remota ou novas credenciais. Não há proteção
contra deploys durante análises ativas: a coordenação segura fica adiada.
`pnpm run deploy:guarded` preserva a [ferramenta manual opcional](guarded-deployment.md),
com terminal e janela exclusiva; não deve ser usado nos Workers Builds.

## Recursos

1. No AI Gateway `holon`, adicione a chave OpenRouter em Provider Keys/BYOK,
   habilite Authenticated Gateway e publique a versão desejada do Dynamic Route
   `pr-review`. Confirme no editor que todos os modelos ativos selecionam
   OpenRouter e suportam tool calling forçado durante streaming. Um modelo que
   devolve apenas texto nessa condição não pode finalizar o `step.prompt` do
   Think e não deve permanecer como fallback.
2. Crie as filas de revisão com sua DLQ:

   ```bash
   pnpm exec wrangler queues create holon-review-jobs-dlq
   pnpm exec wrangler queues create holon-review-jobs
   ```

3. O admin e seu D1 analítico foram retirados; para ambientes existentes, seguir
   a [retirada operacional](admin-retirement.md) antes desta atualização.

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
   pnpm --filter @holon/repository-executor exec wrangler deploy --config wrangler.bootstrap.jsonc
   ```

7. Faça deploy do control plane, que oferece o broker:

   ```bash
   pnpm --filter @holon/control-plane exec wrangler deploy
   ```

8. Faça deploy do executor final com o binding para o entrypoint nomeado do
   broker:

   ```bash
   pnpm --filter @holon/repository-executor exec wrangler deploy
   ```

O Wrangler aplica as migrations de classes Durable Object, registrando Workflows,
Queue bindings e os service bindings definidos nos `wrangler.jsonc`. Não
abra tráfego no bootstrap; confirme os deploys finais antes do smoke.

O control plane inclui `ReviewAgent` (`REVIEW_AGENTS`) e
`ReviewShardWorkflow` (`REVIEW_SHARD_WORKFLOW`). Antes de ativar reviews, faça
um smoke de `step.prompt` com tool call e saída `think_final_answer` usando a
rota dinâmica e o modelo configurados. Confirme bloqueio de tools de escrita,
obsolescência de run, orçamento compartilhado e cleanup. Build/dry-run local
não demonstra compatibilidade do modelo com a chamada forçada de tool.

`AGENT_TRACE_PAYLOADS=enabled` está definido em `wrangler.jsonc` durante o
beta. O Agent tracing pode armazenar mensagens e outputs de tools com trechos
de código. **Desabilitar quando o usuário solicitar**, mudando a variável para
`disabled` e fazendo rollout controlado. Consulte a
[ADR-0049](../decisions/0049-use-cloudflare-think-for-pr-review.md).

## Deploy automático com Workers Builds

O repositório remoto é `ThiagoCrepequer/holon` e sua branch padrão é `main`.
Cada deployable pode manter uma conexão de build com o mesmo monorepo:

| Worker                      | Root | Branch | Build command                                        | Deploy command                                        |
| --------------------------- | ---- | ------ | ---------------------------------------------------- | ----------------------------------------------------- |
| `holon-repository-executor` | `/`  | `main` | `pnpm --filter @holon/repository-executor typecheck` | `pnpm --filter @holon/repository-executor run deploy` |
| `holon-control-plane`       | `/`  | `main` | `pnpm --filter @holon/control-plane typecheck`       | `pnpm --filter @holon/control-plane run deploy`       |

O root permanece no topo porque ambos os apps dependem do workspace e do
lockfile do monorepo. Os deploy commands são os dois comandos da última coluna;
eles não exigem terminal ou confirmação da guarda. A atualização
independente não garante ordem nem drenagem das análises. A ferramenta opcional
`pnpm run deploy:guarded` é reservada a uma janela manual exclusiva e não substitui
os comandos de CI. O executor usa `wrangler deploy`, pois `wrangler versions upload`
não atualiza imagens de Containers. Mantenha o include watch path `*` para validar
mudanças compartilhadas.

O manifest produtivo do executor fixa a imagem já publicada por digest imutável,
conferido na conta Holon em 2026-10-09. Um deploy de TypeScript reutiliza essa
imagem; não reconstrói o Dockerfile implicitamente. Mudanças no Sandbox exigem
build/publicação autorizados da imagem, validação do novo digest e atualização
explícita do manifest antes do rollout coordenado. Preview mantém Dockerfile
local e só pode ser promovido depois de qualificar sua própria imagem por digest.

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
8. No AI Gateway, confirme ausência de payload armazenado, metadados seguros,
   rota/modelo esperados e uma chamada para cada turno realmente executado pelo
   Think. Confira o Agent tracing e os estados de `ReviewShardWorkflow`; o cache
   de prompt do provider é independente.
9. Induza uma resposta final estruturada inválida em ambiente de teste. O shard
   deve terminar como incompleto, sem publicar achados não verificados. Confirme
   que o orçamento agregado não é reiniciado por retry do Workflow.
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
14. Em um PR misto, confirme cobertura dos arquivos elegíveis por shard, acesso
    somente às três tools de leitura e busca, recusa de tools de escrita e
    exclusão de arquivos ignorados. O resumo deve declarar truncamento quando
    algum limite for atingido.
15. Solicite duas páginas consecutivas de um arquivo grande e confirme que cada
    `read_file` retorna no máximo 500 linhas/100 kB, sem carregar o arquivo
    inteiro, e que páginas de paths ignorados são rejeitadas.
16. Publique executor e control-plane da mesma revisão, admitindo indisponibilidade
    durante a atualização. Preparação e contexto exigem os contratos atuais; não há downgrade. Confirme uso do broker sem token
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
`model.input`, `review.coverage_planned`, `review.completed`, `review.failed` e
falhas secundárias de cleanup ou terminalização. O ledger mantém reservas de
chamadas, bytes de entrada, tokens de saída e tools por run. O Agent tracing
fornece a sequência de turnos e tools; com `AGENT_TRACE_PAYLOADS=enabled`, pode
conter trechos do repositório. Antes do piloto, configure acesso e retenção de
Workers Logs, tracing e AI Gateway. O header
`cf-aig-collect-log-payload=false` é obrigatório.

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
Atualizar control-plane e executor para a mesma revisão. Não retomar
checkpoints, artefatos de análise ou mensagens de fila do formato anterior.

A política YAML passa a omitir o campo de versão. O único nome aceito para a
chave principal do App é `GITHUB_APP_PRIVATE_KEY_CURRENT`. Contextos, jobs,
e contratos do core seguem os schemas atuais, sem aliases ou conversão.
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

## Mudança de identidade e configuração — ADR-0037

Siga o [rollout coordenado](repository-configuration.md#rollout-coordenado):
drene runs e confirme cleanup antes de atualizar componentes. O contrato incorpora
base SHA na identidade e exige novos campos persistidos; não há leitor legado.
Confirme `/schemas/holon.schema.json` contra o build implantado. Reset de estado
de desenvolvimento, migrações remotas e smoke live exigem autorização específica.

## Admissão e rollout do Sandbox após o incidente do PR #99

Procedimento verificado na documentação oficial em 2026-09-28. Os comandos abaixo
alteram produção e só devem ser executados pelo operador em um deploy autorizado.
Este PR não os executa. Executor e control-plane precisam compartilhar o contrato
atual `RepositoryToolOutcome`; não retomar instâncias antigas com código novo.

1. Conferir conta/ambiente, revisão Git, imagem e configurações dos dois Workers.
2. Pausar entrega da fila: `pnpm exec wrangler queues pause-delivery holon-review-jobs`.
   Webhooks continuam sendo armazenados. Não purgar a fila; observar o prazo de
   retenção. Pausar entrega não cancela batches já entregues nem Workflows ativos.
3. Aguardar os batches em trânsito e todas as runs não terminais, inclusive em
   espera/retry, além de cleanup pendente. Consultar a lista paginada de instâncias
   do Workflow e seus estados no painel/API. Repetir a consulta até não haver novas
   admissões nem instâncias ativas. Se não for possível comprovar drenagem, não
   substituir o executor. Uma interrupção manual requer o fluxo de terminalização
   e cleanup; somente terminar a instância na Cloudflare não prova limpeza.
4. Implantar os dois Workers da mesma revisão. Confirmar o resultado do rollout
   da aplicação de Containers e a imagem efetiva antes de liberar a fila. Sucesso
   de `wrangler deploy` confirma início do rollout, não seu término. Um período de
   graça não protege indefinidamente uma análise; keepAlive também não impede rollout.
5. Só então retomar: `pnpm exec wrangler queues resume-delivery holon-review-jobs`.
   Monitorar uma execução controlada de smoke: check inicial, conclusão, inline
   esperado e cleanup. Se ela falhar, pausar novas entregas para investigar antes
   de consumir mais recursos com PRs grandes. Mensagens de follow-up também ficam
   pausadas; não confundir essa pausa com perda de eventos.

A [guarda manual opcional](guarded-deployment.md) implementa essa sequência
somente quando invocada explicitamente. Os Workers Builds não passam por ela.
Não há bloqueio distribuído da API de criação manual de Workflows. Operações
diretas e outros administradores também devem respeitar a janela exclusiva.

### Aceitação remota da correção

Executar primeiro PR pequeno sem defeito e PR pequeno com defeito isolado. Depois,
uma revisão com mais de três shards e o PR grande. Conferir reservas de modelo e tools no
ledger, cobertura, estados do `ReviewShardWorkflow`, tracing e cleanup por runId.
Injetar perda do container apenas em ambiente de teste: após a primeira falha
fatal não devem surgir novas chamadas ao provider, embora chamadas já em trânsito
possam terminar e ser cobradas. Nenhum teste local comprova interrupção imediata
do faturamento pelo provider. A run deve falhar e agendar limpeza, sem renovar
orçamento automaticamente.

Fontes: [pausa de Queues](https://developers.cloudflare.com/queues/configuration/pause-purge/),
[rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/),
[ciclo do Sandbox preview](https://developers.cloudflare.com/sandbox/1-0-preview/lifecycle/)
e [cancelamento e erros de ferramentas no AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling).
