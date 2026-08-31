---
id: RESEARCH-LIVE-GITHUB-APP-REVIEW-SMOKE-2026-08-31
kind: research
status: current
owners:
  - core-team
verified-at: 2026-08-31
evidence-level: primary-sources-and-live-observation
related:
  - ../product/mvp-scope.md
  - ../architecture/review-runtime-flow.md
  - ../decisions/0013-use-tiered-structural-and-textual-review.md
  - ../decisions/0016-require-complete-patches-and-host-verifiable-evidence.md
  - ../planning/mvp-delivery-plan.md
  - ../planning/review-core-evolution-roadmap.md
  - 2026-08-30-agentic-review-completion-incident.md
  - 2026-08-30-model-output-and-retry-incident.md
---

# Smoke remoto do fluxo de review do GitHub App

## Conclusão executiva

O caminho remoto do Holon foi **parcialmente comprovado** em 2026-08-31. Três
casos públicos demonstraram admissão pelo GitHub App, execução do Workflow,
preparação do repositório, análise e publicação de um Pull Request Review. Um
caso pequeno sem defeito terminou sem finding; um caso com regressão intencional
publicou um finding na linha e no head SHA esperados; e um PR grande terminou
explicitamente como parcial por orçamento.

Isso não equivale a piloto concluído nem comprova todos os componentes e modos
de falha. Redelivery, force-push concorrente, múltiplos findings, repositório
privado, rate limits, retenção operacional e identidade efetiva do
provedor/modelo permanecem sem prova suficiente.

## Pergunta investigada

Quais partes do vertical slice GitHub App → Workflow → Sandbox → modelo →
publicação foram observadas diretamente em ambiente remoto, e quais afirmações
continuam pendentes?

## Escopo e método

A investigação correlacionou somente metadados sanitizados de:

- Pull Requests e Pull Request Reviews públicos consultados pelas APIs do
  GitHub;
- comentário inline público consultado pela API de review comments;
- listagem e descrição de instâncias concluídas do Cloudflare Workflows pelo
  Wrangler 4.127.1;
- commits, SHAs, tamanhos e resultados de CI expostos pelo GitHub.

Não foram persistidos payloads de webhook, prompts, patches privados, respostas
integrais de modelo, credenciais, headers, account IDs ou installation IDs. Os
horários do Wrangler foram exibidos no timezone local America/Sao_Paulo; os
horários do GitHub foram registrados em UTC.

## Registro de afirmações

| ID       | Afirmação                                                        | Resultado                               | Evidência                                                                                                 | Impacto                                                                    |
| -------- | ---------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| LIVE-001 | O GitHub App recebe eventos e inicia o review remoto             | `confirmed` para os casos observados    | PRs #16, #17 e #18 possuem reviews do App e instâncias correlatas concluídas                              | remove a afirmação ampla de que GitHub real está totalmente pendente       |
| LIVE-002 | O Workflow remoto percorre preparação, análise e terminalização  | `confirmed` para os casos observados    | instâncias `review-aabd…`, `review-ac35…` e `review-0324…`, versão `cc2c8a59-5753-4014-8eff-9c5b5eff95e2` | comprova a coordenação remota nesses três caminhos                         |
| LIVE-003 | A preparação remota do repositório via executor/Sandbox funciona | `confirmed` para os casos observados    | `prepare-repository-1` concluiu em 9 s, 9 s e 6 s                                                         | supera as falhas de preparação anteriores, sem generalizar disponibilidade |
| LIVE-004 | O sistema termina sem finding em mudança textual sem defeito     | `confirmed` para um caso                | PR #17, head `1247443de8532c0e0f45fae8d4a47297ab6a0446`, review às `2026-08-31T14:39:46Z`                 | prova o caminho textual negativo, não sua precisão estatística             |
| LIVE-005 | O sistema encontra e publica uma regressão conhecida             | `confirmed` para um caso                | PR #18, head `3789a7a78dd293523373751ef355e6b37046f821`, comentário `3895506722`, linha 114 `RIGHT`       | prova detecção, validação de coordenada e publicação inline nesse caso     |
| LIVE-006 | O head é revalidado antes da publicação                          | `confirmed` para as execuções descritas | etapas `revalidate-initial-head-1` e `revalidate-current-head-1` retornaram `true`                        | confirma o gate, mas não o comportamento quando o head muda                |
| LIVE-007 | PR grande termina de forma bounded e explícita                   | `confirmed` para um caso                | PR #16, 113 arquivos, 11.214 adições e 2.522 remoções; resumo declarou review parcial                     | comprova encerramento; não aprova cobertura ou utilidade do resumo         |
| LIVE-008 | O modelo produziu conteúdo durante a etapa de análise            | `partially-confirmed`                   | `analyze-review-1` concluiu e os reviews contêm saída contextual                                          | não identifica independentemente provedor, modelo ou rota efetiva          |
| LIVE-009 | A publicação é idempotente sob redelivery                        | `unknown`                               | nenhum redelivery controlado foi executado nesta amostra                                                  | permanece requisito de smoke                                               |
| LIVE-010 | Force-push concorrente impede publicação obsoleta                | `unknown`                               | somente revalidações com resultado `true` foram observadas                                                | permanece requisito de smoke                                               |
| LIVE-011 | O fluxo suporta múltiplos findings no mesmo review               | `unknown`                               | os casos observados tiveram zero ou um finding                                                            | requer caso dedicado                                                       |
| LIVE-012 | O fluxo está pronto para repositório privado e piloto            | `unknown`                               | os casos documentados são públicos e não medem retenção, acesso ou distribuição real                      | fase 6 continua não iniciada                                               |

## Casos observados

### PR #17 — controle negativo textual

- URL: [ThiagoCrepequer/holon#17](https://github.com/ThiagoCrepequer/holon/pull/17)
- base: `94026a08d87c18a6e0582221697e3884823e9550`
- head: `1247443de8532c0e0f45fae8d4a47297ab6a0446`
- superfície: um arquivo e duas linhas adicionadas de documentação;
- Workflow: `review-ac35760d31977ba77216f04ccd07e85eeb6bca0c5ccb48f2bdd46f8c2de7fe23`;
- duração observada: 19 segundos, sem retry exibido;
- publicação: um review-resumo, sem comentário inline;
- limitação: um caso negativo não mede taxa de falsos positivos.

O check de CI mais próximo terminou com falha, mas é um sistema independente do
Workflow do Holon e não interrompeu a review. O snapshot não usa esse check como
evidência de sucesso ou falha do Holon.

### PR #18 — regressão TypeScript intencional

- URL: [ThiagoCrepequer/holon#18](https://github.com/ThiagoCrepequer/holon/pull/18)
- base: `94026a08d87c18a6e0582221697e3884823e9550`
- head: `3789a7a78dd293523373751ef355e6b37046f821`;
- superfície: alteração de `0.8` para `0.08` em
  `packages/domain/src/finding.ts`;
- Workflow: `review-032488011b3527836404e8eae7567ba41712feba7dffe28c35677d956f046b1a`;
- duração observada: 46 segundos, sem retry exibido;
- publicação inline: review `5067803583`, comentário `3895506722`, linha 114,
  lado `RIGHT`, commit igual ao head;
- publicação de conclusão: review-resumo separado;
- CI: check `verify` concluído com sucesso.

O finding identificou corretamente a redução do limiar. A expressão de que o
resultado causaria “flooding” e a sugestão de `0.5` não foram demonstradas pelo
patch; essas frases são exemplos para o futuro corpus de acionabilidade e
linguagem especulativa.

### PR #16 — encerramento parcial de PR grande

- URL: [ThiagoCrepequer/holon#16](https://github.com/ThiagoCrepequer/holon/pull/16)
- head: `94026a08d87c18a6e0582221697e3884823e9550`;
- superfície: 113 arquivos, 11.214 adições e 2.522 remoções;
- Workflow: `review-aabd89c5ab5f80756c41f391ab4f02a18750fab5a4233754e05ddf25196aba61`;
- duração observada: 56 segundos, sem retry exibido;
- publicação: resumo `placeholder` acompanhado do aviso determinístico de
  review parcial.

A execução comprova bounded completion, não cobertura adequada. O texto
`placeholder` é uma falha de qualidade e deve virar caso de regressão antes da
correção.

## Achados

1. O vertical slice não é mais apenas uma prova local. Há evidência pública e
   metadados do Workflow para zero finding, um finding inline e review parcial.
2. O host preservou o head SHA e as coordenadas no caso positivo observado.
3. A separação entre review inline vazio e review-resumo no PR #18 é funcional,
   mas pouco coesa para o usuário e deve ser avaliada antes de mudar.
4. A conclusão de PR grande é segura quanto ao limite, mas insuficiente quanto à
   utilidade do resumo.
5. O resultado do modelo precisa ser medido por corpus; smokes isolados não
   fornecem precisão, recall, estabilidade ou custo representativos.

## Riscos e incógnitas

- A listagem de Workflows não prova por si só a identidade do container, digest
  implantado ou provedor/modelo usado na inferência.
- Nenhuma execução observada exerceu o ramo obsoleto após mudança de head.
- A amostra é pequena, pública e concentrada no próprio repositório do Holon.
- O GitHub mantém detalhes de entregas recentes de webhook por três dias e não
  faz redelivery automático de falhas; a coleta futura precisa ser tempestiva e
  explícita.
- O estado concluído de Workflows tem retenção limitada por plano; o snapshot
  versionado preserva somente metadados mínimos, não outputs sensíveis.

## Impacto nas decisões

Nenhum ADR precisa ser alterado. As evidências são compatíveis com os ADRs
0013 e 0016 e apenas atualizam o estado de execução do planejamento.

Persistir conteúdo real para avaliação, mudar logging do AI Gateway, ampliar
egress/permissões ou converter findings em veredito automático continua
exigindo decisão específica.

## Fontes

Fontes verificadas em 2026-08-31:

- [GitHub — Viewing webhook deliveries](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries)
- [GitHub — Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)
- [GitHub — Pull request reviews REST API](https://docs.github.com/en/rest/pulls/reviews)
- [Cloudflare — Workflows observability](https://developers.cloudflare.com/workflows/observability/)
- [Cloudflare — Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)

## Erratas

Nenhuma até 2026-08-31.
