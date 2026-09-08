---
id: ADR-0014
kind: decision
superseded-by: 0036-use-single-current-development-contracts.md
status: superseded
date: 2026-08-30
owners:
  - core-team
supersedes: []
related:
  - 0004-adopt-workflows-do-ledger-and-sandbox-executor.md
  - 0008-bound-sandbox-lifetime-and-use-virtual-github-egress.md
  - ../architecture/security-and-trust-boundaries.md
  - ../contracts/README.md
---

# Versionar o RPC do executor e emitir credenciais GitHub por broker

## Contexto e problema

O contrato V1 entregava o token de instalação ao método de preparação. Vincular
esse token aos parâmetros persistidos do outbound handler faria uma credencial
atravessar a fronteira do Sandbox e sobreviver ao frame RPC que a recebeu. Uma
troca direta de assinatura também quebraria mensagens e instâncias de Workflow
criadas pela versão anterior.

## Decisão

- Contratos incompatíveis recebem schemas e métodos nomeados explícitos. V1
  mantém `prepare` e `loadContext`; V2 usa `prepareRepositoryV2` e
  `loadContextV2`.
- O request V2 transporta installation ID e identidade do repositório, nunca
  token. O contexto V2 transporta patches completos por arquivo.
- O outbound handler obtém `containerId` do contexto confiável fornecido pela
  plataforma. Seus parâmetros contêm somente run, instalação e repositório.
- Um entrypoint RPC nomeado do control plane atua como credential broker. Ele
  valida o container determinístico, a run mais recente e ativa e o scope
  registrado no ledger antes de emitir credencial.
- Para drenar V1, um pedido sem installation ID pode inicializar o scope uma
  única vez: o broker resolve a instalação pela identidade do repositório,
  registra o scope completo atomicamente e reautoriza antes da emissão. O token
  legado recebido por `prepare` é validado por compatibilidade, mas ignorado.
- Tokens de instalação são restritos ao repository ID solicitado por meio de
  `repositoryIds`. Eles existem somente no broker/outbound handler e nunca em
  Queue, SQLite, filesystem, parâmetros do Sandbox ou logs.
- O control plane tenta V2 e só recorre ao V1 quando o método V2 não existe.
  Erro funcional ou de segurança em V2 nunca ativa fallback.

- O rollout é ordenado: primeiro control plane dual-stack com broker e fallback;
  depois executor dual-stack; por fim observação e drenagem de V1. Remover V1
  exige uma decisão posterior e prova de que nenhuma versão retida o usa.
- Em conta vazia, onde nenhum alvo existe, um config bootstrap cria primeiro o
  executor sem binding de broker. Ele não está apto a clonar; serve apenas para
  permitir o deploy do control plane. O executor final é implantado logo depois.

### Correção de implementação — 2026-08-31

O nome determinístico usado em `idFromName` e o `containerId` exposto pela
plataforma são identidades diferentes. O executor resolve o Durable Object ID
opaco a partir do nome e o control plane registra esse ID no scope antes de
preparar o repositório. O outbound handler continua obtendo `containerId` do
contexto confiável e o broker continua exigindo igualdade exata com o scope.
Essa correção preserva a decisão de autorização por container; relaxar ou
remover essa verificação exigiria uma decisão que supersedesse este ADR.

## Alternativas rejeitadas

### Persistir token nos parâmetros do outbound handler

Rejeitada porque amplia a vida e a superfície de leitura da credencial.

### Guardar token V1 em variável global do Worker

Rejeitada porque memória de isolate não é armazenamento confiável nem garante
que a invocação posterior do outbound handler execute no mesmo isolate.

### Trocar V1 por V2 em um único deploy

Rejeitada porque Workflows e service bindings preservam versões em execução e
uma atualização parcial criaria indisponibilidade ou fallback inseguro.

## Consequências

### Positivas

- O Sandbox nunca recebe material de autenticação.
- A autoridade do token fica limitada a uma run ativa e a um repositório.
- O rollout aceita N-1 sem transformar qualquer falha V2 em downgrade.

### Negativas

- Há dois métodos RPC durante a janela de migração.
- O binding reverso executor -> broker exige ordem de deploy e smoke específico.
- O drain V1 faz uma leitura adicional da instalação no GitHub.

## Critérios de confirmação

- Teste Workerd prova que token V1 não aparece nos parâmetros do outbound.
- V2 clona usando credencial JIT e falha fechado para container, run ou repo
  divergente.
- Fallback acontece somente para método V2 ausente.
- Um token emitido contém `repositoryIds` com exatamente o repository ID da run.
- O smoke de rollout executa control plane novo com executor N-1 e depois ambos
  novos sem duplicar publicação.

## Evidência

Verificada em 2026-08-30:

- [Cloudflare service bindings e RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [Cloudflare Sandbox: controle de tráfego de saída](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)
- [GitHub: autenticação como instalação](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
