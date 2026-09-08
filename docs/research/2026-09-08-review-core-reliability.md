---
id: RESEARCH-REVIEW-CORE-RELIABILITY-2026-09-08
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-09-08
---

# Evidência da revisão de confiabilidade do core

## Fontes verificadas em 2026-09-08

- [Cloudflare Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/):
  o retorno não streaming de um step tem limite de 1 MiB.
- [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/):
  efeitos devem ficar em etapas idempotentes; estado de closures não substitui
  resultados duráveis em uma retomada.
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/):
  alarmes são ao menos uma vez, exigindo trabalho idempotente.
- AI SDK instalado, `generateText` e seus tipos de `timeout`: aceita `totalMs` e
  `stepMs`. A consulta web à [referência](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)
  falhou; a validação desta API usou o código/tipos da dependência instalada e
  compilação local, sem inferir funcionamento de um provider remoto.

## Observações locais

O output agregado anterior repetia findings e incluía o histórico sem limite
por run. A regressão usa 40 findings, quatro evidências e caracteres multibyte:
mais de 1 MiB no resultado integral e menos de 64 kB no manifesto. O SQLite do
runtime local preserva o artefato após eviction e o remove no cleanup terminal.

Testes de retomada pulam callbacks já concluídos, avançam o relógio além da
janela de identificação e verificam versões, uso e início original. Isso prova
as decisões do host nesse modelo de replay; não é teste de hibernação remoto.

A validação cobre também feedback entre análise e publicação, reserva durável
de tools, respostas de resolução com confirmação perdida, paráfrase, correção
com alteração real de patch e reintrodução. Silêncio, evidência inventada,
confiança insuficiente e evidência inalterada não autorizam resolução.

## Inferências e limites

Checkpoints menores e por shard reduzem trabalho repetido e pressão no limite
de resultado. A melhora de custo/latência não foi medida com tráfego real.
O hash secundário é uma heurística conservadora de identidade; o gate comprova
proveniência textual, não a semântica de uma correção. Contadores persistidos
não substituem a fatura do provider após interrupções sem resposta.

As decisões correspondentes estão na
[ADR-0034](../decisions/0034-make-review-checkpoints-and-revalidation-durable.md).
