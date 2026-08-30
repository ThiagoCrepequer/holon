---
id: RESEARCH-2026-08-30-SANDBOX-INCIDENT
kind: research
status: current
date: 2026-08-30
owners:
  - core-team
related:
  - ../decisions/0008-bound-sandbox-lifetime-and-use-virtual-github-egress.md
---

# Incidente de egress e retries do Sandbox

## Pergunta

Por que o primeiro review real não passou da preparação e manteve um container
ativo por vários minutos?

## Evidência observada

- O Workflow chegou a `prepare-repository`, mas não chamou modelo nem publisher.
- Houve quatro execuções de checkout ao longo de aproximadamente seis minutos.
- As falhas foram `ProcessWaitTimeoutError` ou exit code 143.
- O comando interno tinha timeout de 120 segundos e o step aceitava três
  retries além da tentativa inicial.
- O operador destruiu manualmente o container na última tentativa.

Esses dados localizam a falha no fetch; não demonstram erro da chave privada, do
AI Gateway ou da publicação GitHub.

## Validação nas fontes

A documentação atual descreve `enableInternet = false` como deny-by-default e
permite exceções por outbound handlers. Ela também documenta hosts virtuais, por
exemplo `http://my.worker`, cujo tráfego é atendido pelo handler dentro da
plataforma.

O issue aberto [cloudflare/sandbox-sdk#844](https://github.com/cloudflare/sandbox-sdk/issues/844)
reproduz timeout para `github.com` com `enableInternet = false` e
`allowedHosts = ["github.com"]`, inclusive sem o outbound handler ser chamado.
O Holon usava o mesmo desenho na versão preview `0.13.0-next.751.1`. A
correspondência é forte, mas continua sendo diagnóstico por evidências até o
smoke real do novo deploy.

Workflows documenta retries por step. O run real mostrou que `limit: 3` resultou
em uma tentativa inicial e três repetições; a política operacional do Holon deve
usar a semântica observada ao estimar custo.

Fontes consultadas em 2026-08-30:

- [Sandbox outbound traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)
- [Sandbox lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/)
- [Workflows sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Sandbox SDK issue 844](https://github.com/cloudflare/sandbox-sdk/issues/844)

## Conclusão

O fix seguro é evitar o caminho público afetado sem habilitar internet: Git usa
um host virtual, e o handler confiável reescreve a requisição para GitHub com o
token. Timeouts menores, classificação conservadora de erros e destruição
imediata em falha limitam o custo. `sleepAfter` curto é compatível com qualidade
se o contexto for verificado também antes de cada tool call.

## Validação pendente

- Deploy controlado dos dois Workers.
- PR privado que prove fetch, modelo e publicação.
- Inspeção do número de tentativas e do estado do container após sucesso e
  falha induzida.
