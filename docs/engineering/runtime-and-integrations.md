---
id: ENGINEERING-RUNTIME-INTEGRATIONS
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
---

# Runtime e integrações do Holon

Este guia reúne as perguntas de engenharia comuns aos deployables e adapters.
O [fluxo de review](../architecture/review-runtime-flow.md) e o
[estado da run](../architecture/state-and-idempotency.md) detalham a execução;
os ADRs aceitos governam as escolhas. Confirme o comportamento em código,
`package.json`, Wrangler e testes antes de aplicar uma orientação.

## Entrada e identidade

O control plane recebe o webhook GitHub, valida assinatura e evento, normaliza
o envelope e o envia à Queue. O consumidor reconcilia entregas repetidas e
inicia ou encontra o Workflow da run. Consulte `apps/control-plane/src/ingress/webhook-handler.ts`,
`ingress/queue-consumer.ts` e `review/review-workflow.ts`.

- Trate body, headers, diff, arquivos, comentários, Queue e RPC como dados não
  confiáveis até validação na fronteira. Verifique tamanho, schema, instalação,
  repositório e escopo; não deixe texto do PR definir política ou privilégios.
- Diferencie delivery, PR, run, Workflow, shard, finding e publicação. Uma run
  fica ligada a head/base e configuração efetiva; chegada de commit novo não
  altera a identidade anterior.
- A Queue pode reenviar. A ordem de consumo não concede autoridade. O ledger
  por PR decide qual run é a mais recente e registra transições e obrigações
  duráveis. Verifique a autoridade de novo antes de cada efeito externo.

## Orquestração e estado

`ReviewWorkflow` coordena preparação, análise, agregação, publicação e
terminalização. `ReviewLedgerObject` guarda autoridade, checkpoints e claims.
O executor mantém o checkout e contexto efêmero no Sandbox da run. Consulte
`apps/control-plane/src/review/review-workflow.ts`, `ledger/ledger-object.ts`,
`ledger/review-analysis-store.ts`, `apps/repository-executor/src/executor-service.ts`
e [estado e idempotência](../architecture/state-and-idempotency.md).

- Para cada etapa durável, identifique input serializável, resultado persistido,
  efeito externo possível e repetição após timeout. Um retry pode ocorrer
  depois de o efeito ter acontecido; reconcilie antes de repeti-lo.
- Use transições condicionais, operation IDs e marcadores determinísticos onde
  o contrato exigir. Não troque checkpoint por variável em memória, log ou
  mensagem do modelo.
- Cancelamento de run antiga, falha terminal e conclusão devem fechar Check
  Run, impedir novas tools/publicações e executar cleanup durável do Sandbox.
- Mudanças em DO SQLite exigem migração aditiva e preservação de dados. Não
  edite migrações aplicadas como se ainda fossem novas.

## Snapshot, ferramentas e modelos

O executor prepara o snapshot no SHA exato e expõe operações de leitura
limitadas. `packages/repository-analysis` decide elegibilidade e planejamento;
`packages/project-identification` interpreta metadados permitidos;
`apps/control-plane/src/review/review-agent.ts` implementa a política de revisão sobre
Think; `packages/model` mantém prompt, tools tipadas e provider AI SDK/AI Gateway.
Consulte [fronteiras de confiança](../architecture/security-and-trust-boundaries.md),
[contratos](../contracts/README.md) e
[identificação de versões](../architecture/project-version-identification.md).

- Path normalizado, escopo, realpath, janela, bytes, prazo e autoridade da run
  devem ser verificados no executor, mesmo quando o caller já validou.
- O manifesto fixa `@cloudflare/sandbox` 0.x. A documentação atual da
  Cloudflare separa essa API da linha 1.0; consulte a seção 0.x para manter o
  executor e trate uma migração de versão como mudança de runtime própria.
- Não exponha shell arbitrário, instalação de dependências, escrita no checkout
  ou egress amplo ao código do PR ou ao modelo. O broker de credenciais fica no
  control plane; credenciais GitHub não entram no contexto do modelo.
- Separe fatos coletados, hipóteses do modelo e findings aceitos. Output de
  modelo passa por schema, verificação de evidência e política de cobertura no
  host antes de alterar estado ou publicar.
- Ao mudar provider, modelo, tools ou streaming, verifique a versão do AI SDK,
  middleware, limites e rota reais. Reserve orçamento antes de uma inferência
  quando o caso de uso possuir teto durável; contabilize timeout e resultado
  incerto sem renovar saldo por retry.

## Configuração, feedback e publicação

A configuração por repositório é compilada por run e mantém proveniência,
digests e escopo. O CLI usa o mesmo compilador para validação local e schema de
editor. Feedback permanece no código atual. Consulte `packages/repository-config`,
`tooling/config-cli`, `apps/control-plane/src/ingress/feedback-handler-service.ts`
e [configuração operacional](../operations/repository-configuration.md).

A publicação pertence ao host. Verifique head/base no GitHub, claim no ledger,
marcador determinístico e reconciliação após resposta ambígua. Não trate uma
resposta do modelo ou de tool como autorização para comentar, aprovar ou mudar
um Check Run. Consulte `packages/github/src/publisher.ts`,
`apps/control-plane/src/review/authorized-publication.ts` e a
[política de veredito](../decisions/0019-derive-deterministic-review-verdict-by-policy.md).
Publique veredito e achados inline novos em uma única review; depois recupere
os IDs dos comentários dessa review para manter o acompanhamento entre commits.
Em aprovações seguintes sem achados novos, o corpo curto reduz a repetição no PR;
o Check Run mantém o diagnóstico completo.

## Incerteza, capacidade e otimização

Busca limitada, timeout ou resposta truncada não provam ausência. Uma fronteira
que usa essa conclusão para autorizar efeito externo deve distinguir resultado
encontrado, ausência comprovada e investigação inconclusiva. Limitar paginação é
legítimo; retornar ausência ao atingir o limite pode repetir publicação aceita
com resposta perdida. Manter obrigação de reconciliação e atualizar porta,
adapter e consumidores juntos.

Tools devem alinhar schema, command builder, parser, escopo e capacidade real.
Recusar linguagem/operação indisponível explicitamente, sem transformar filtragem
em busca completa vazia. Reuso de contexto precisa de snapshot/escopo
identificados e revalidação de autoridade, inclusive em cache hit.

Medir provider, tools, DO/RPC, preparação, espera e cleanup antes de mudar
concorrência. Não retirar guards nem abandonar trabalho com `Promise.race` para
obter menor latência. Quotas, reservas e settlement continuam duráveis; bytes,
tokens, gerações, tools e tempo têm denominadores diferentes. Uma operação
composta deve preservar autorização causal e atomicidade, sem cache global de
permissão. Scheduling/cache novos precisam das provas e decisões aplicáveis.

O [guia de qualidade do core](review-core-quality.md) define os critérios;
o [plano](../planning/review-core-improvement-proposal.md) conserva alternativas
os gates de evoluções ainda experimentais. A implementação de cache/receipts/lanes
segue a [ADR-0056](../decisions/0056-preserve-review-evidence-and-schedule-stable-lanes.md).
Timings/contadores não devem acrescentar payload privado aos logs.

## Configuração de deploy e operação

Wrangler define DO migrations, Queue, Workflow, service bindings, container,
compatibilidade e observabilidade. Tipos gerados e testes Workerd devem refletir
essa configuração. `pnpm build` faz dry-run e constrói a imagem; deploy e smoke
remoto seguem [operação](../operations/README.md) e requerem autorização.
Não registre segredos nem payloads privados em logs. Antes de ajustar retenção
ou tracing, localize a decisão e a configuração vigentes. O Agent tracing com
mensagens e tools está habilitado temporariamente pela
[ADR-0049](../decisions/0049-use-cloudflare-think-for-pr-review.md); desligue
`AGENT_TRACE_PAYLOADS` quando o usuário solicitar.

## Fontes oficiais verificadas em 2026-10-03

- [Cloudflare: regras de Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Cloudflare: regras de Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Cloudflare: Sandbox SDK 0.x](https://developers.cloudflare.com/sandbox/sdk/)
- [Cloudflare: integração Vitest para Workers](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [AI SDK: tools](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK: middleware](https://ai-sdk.dev/docs/ai-sdk-core/middleware)
- [Cloudflare Think](https://developers.cloudflare.com/agents/harnesses/think/)
- [Cloudflare Agent tracing](https://developers.cloudflare.com/agents/runtime/operations/observability/tracing/)
