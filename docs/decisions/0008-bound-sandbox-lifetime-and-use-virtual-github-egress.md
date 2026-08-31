---
id: ADR-0008
kind: decision
status: accepted
date: 2026-08-30
owners:
  - core-team
supersedes: []
related:
  - 0004-adopt-workflows-do-ledger-and-sandbox-executor.md
  - 0006-use-granular-workflow-checkpoints.md
  - ../research/2026-08-30-sandbox-egress-and-retry-incident.md
---

# Limitar a vida do Sandbox e usar egress GitHub por host virtual

## Contexto

O primeiro review real ficou seis minutos na preparação do repositório. O
`git fetch` terminou por timeout ou sinal 143 em quatro tentativas, e o container
permaneceu ativo entre elas. A configuração usava `enableInternet = false`,
`allowedHosts = ["github.com"]` e um outbound handler para injetar o token fora
do processo.

Em 2026-08-30, o comportamento observado coincidiu com o issue aberto
`cloudflare/sandbox-sdk#844`: com internet desabilitada, um host em
`allowedHosts` pode terminar em timeout sem alcançar o handler. A documentação
do Sandbox também permite mapear um hostname virtual diretamente para um
outbound handler, mantendo a chamada dentro da rede da Cloudflare.

Fontes primárias:

- [Outbound traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)
- [Sandbox lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/)
- [Sandbox SDK issue 844](https://github.com/cloudflare/sandbox-sdk/issues/844)
- [Workflows retries](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)

## Decisão

O processo Git usa `http://github.holon.internal/<owner>/<repo>.git`. Esse nome
não é público: o Sandbox o encaminha ao handler `authenticatedGithub`, que
valida método e caminho, substitui a URL por `https://github.com`, remove
credenciais fornecidas pelo processo e injeta o token de instalação. Redirects
continuam manuais. `enableInternet` permanece `false` e não há `allowedHosts`
público.

A preparação aplica estes limites:

- `git init`: 10 segundos;
- `git fetch`: 60 segundos;
- `git checkout`: 20 segundos;
- etapa durável: 2 minutos;
- somente uma repetição, e apenas para falha classificada como transitória.

Exit code 143 e erros conhecidos de timeout ou indisponibilidade da plataforma
são transitórios. Exit codes determinísticos, validação, autenticação e demais
falhas não são repetidos. Toda falha de preparação destrói o Sandbox antes de o
Workflow aguardar um backoff.

O `sleepAfter` passa de 15 minutos para 30 segundos. Antes da leitura inicial e antes de
cada ferramenta do modelo, o control-plane verifica o contexto; se o container
hibernou, refaz o checkout idempotente com os SHAs assinados.

## Alternativas rejeitadas

### Habilitar internet no container

Rejeitada porque ampliaria o egress de código não confiável e o workaround
reportado no issue não garante que um allowlist de runtime seja aplicado.

### Manter o container por todo o timeout do modelo

Rejeitada porque o modelo pode passar minutos sem usar o filesystem. Reconstruir
sob demanda é uma troca controlada entre cold start e tempo ativo ocioso.

### Não repetir nenhuma preparação

Rejeitada porque uma falha transitória curta de container ou transporte não
deve descartar um review válido.

## Consequências

- O token continua fora do container e só alcança o repositório autorizado.
- Uma falha persistente de fetch consome no máximo duas tentativas curtas.
- Não há container vivo durante o backoff após falha de preparação.
- Reviews lentos podem exigir um segundo checkout antes de uma tool call; isso
  reduz tempo ocioso cobrado ao custo de trabalho repetido mensurável.
- O host virtual é um workaround a remover ou revalidar quando o issue 844 for
  resolvido e a versão do Sandbox SDK for atualizada.

## Critérios de confirmação

- Um PR privado conclui `git fetch`, análise e publicação usando o host virtual.
- Acesso direto do container a `github.com` ou outro host continua bloqueado.
- Uma falha permanente executa uma tentativa e destrói o Sandbox.
- Uma falha transitória executa no máximo duas tentativas, cada uma com Sandbox
  novo.
- Nenhum container permanece ativo 30 segundos após o último uso bem-sucedido.
- Uma tool call após hibernação reconstrói o contexto e mantém o review válido.
