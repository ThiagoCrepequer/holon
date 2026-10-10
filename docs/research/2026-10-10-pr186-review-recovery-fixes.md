---
id: RESEARCH-PR186-REVIEW-RECOVERY-FIXES
kind: report
status: current
owners: [core-team]
last-reviewed: 2026-10-10
related:
  - 2026-10-10-pr186-review-failures.md
  - ../decisions/0062-recover-review-evidence-and-isolate-invalid-items.md
---

# Correções após a auditoria das revisões do PR #186

Este documento acompanha a [auditoria datada](2026-10-10-pr186-review-failures.md),
sem reclassificar os seus resultados históricos. A implementação está no mesmo
PR do Dashboard 7. Política atual: [ADR-0062](../decisions/0062-recover-review-evidence-and-isolate-invalid-items.md).

## Mudanças e provas

| Incidente ou limite                                        | Ajuste                                                                                                                    | Evidência local e limite                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leitura de evidência após o modelo cancelou todas as lanes | Coleta durável no filho, até três leituras, deadline por operação e código de esgotamento                                 | Workerd: duas falhas seguidas de sucesso e três falhas terminais, ambas com uma única geração; coordenador conserva seis de sete partes e continua as posteriores                                                                                                      |
| Item inválido derrubava a resposta inteira                 | Isolamento de candidatos/resoluções/observações admitidos pelo schema do prompt; resultado degradado                      | Contratos e Think reais com transporte sintético: observação curta não elimina a resposta; candidato impossível e resolução inválida não eliminam seus pares válidos                                                                                                   |
| Inventário limitado a 100 candidatos                       | 256 candidatos, com os mesmos limites de arquivo e bytes totais                                                           | 128 módulos pequenos retidos; overflow, arquivo acima de 64 KB, UTF-8, symlink e metadados inválidos continuam parciais                                                                                                                                                |
| Máximo oito checks extras                                  | Usar slots restantes até 64 partes totais                                                                                 | Nove relações não colocalizadas recebem nove checks; teto total reduzido para 24 conserva três omissões por capacidade                                                                                                                                                 |
| Símbolo movido descrito como removido                      | AST de exports compartilhada pelo extrator e detector; instrução causal de reexports                                      | Valor/alias preservados são modificados; export somente de tipo e alias diferente conservam remoção. Fixtures positiva/negativa compilam e seu oracle confirma perda/preservação do valor. Isso reduz uma pista incorreta, sem comprovar melhora estatística do modelo |
| Notificação após término continuava em retry               | Descartar envio somente após status terminal comprovado                                                                   | Entrega em `running`/`waiting`, descarte em três estados terminais, erro de status continua recuperável                                                                                                                                                                |
| Avisos de recursos RPC não liberados                       | Descartar resultados de arquivo, escrita, existência, output, processo e pacote de evidências; descartar recursos tardios | Workerd verifica liberação em sucesso, falha de output, cancelamento e perda de autoridade. Não prova que esses avisos causaram o timeout histórico                                                                                                                    |
| HTTP 200 com falha de protocolo de tools                   | Código durável `model_tool_protocol_invalid` para `other`/`error` sem chamadas                                            | Stream sintético atravessa AI SDK/Think e conserva a causa após eviction; não demonstra que o provedor real passou a suportar a chamada                                                                                                                                |
| Deadline com duas causas sob o mesmo erro                  | `deadline_expired`/`deadline_out_of_range`, com saldo e limite numéricos                                                  | Política de 90 s preservada; testes distinguem as causas. O ramo histórico continua desconhecido                                                                                                                                                                       |
| Projeção/RPC sem resposta                                  | Promise RPC mantém dono após timeout; motivo seguro por estágio e outbox durável preservado                               | D1/Workerd: sete falhas do writer, cleanup independente e recuperação. A causa dos 22 requests históricos continua não determinada                                                                                                                                     |

## Verificação

As regressões comportamentais começaram com falhas reproduzidas antes das
correções. Contratos, planner, coordenador, AI SDK, Think, Workflows locais,
ledger SQLite e projeção D1 foram exercitados. Sandbox/provedor externos foram
substituídos nas suas fronteiras; nenhuma resposta sintética demonstra detecção
pelo modelo real.

Em 2026-10-10, `pnpm verify` completo passou com Node 24.19.0 e pnpm 11.24.0:
marca/configuração, formatação, lint, tipos, arquitetura, cobertura e build com
dry-runs. Passaram 431 testes do core em 53 arquivos, 137 do executor, 182 de
contratos, 231 de análise de repositórios e 48 de modelo, acima dos mínimos de
cobertura. Os 24 testes do harness incluem oracles executáveis; não fazem
inferência paga. Passaram também 131 jornadas autenticadas e 12 de fundação do
dashboard; os dois labs sem CDP foram ignorados nos engines não Chromium.

O build conservou 231.131 bytes de JavaScript e 7.197 de CSS gzip, além de
159.732 bytes de fontes, dentro dos tetos aprovados. A CI do novo commit é uma
verificação independente e seu estado fica registrado no PR.

Os testes locais não acessam a conta Cloudflare de produção nem enviam emails.
O harness pago usa o resultado atual `{ output, evidence }`, sem uma leitura
pós-modelo independente que pudesse reproduzir o problema original; ele não
foi executado nesta iteração.

## Falha de integração observada após o push

O push de `37a7c08` acionou outra execução do Holon. O Check Run
`114273722345` falhou entre `2026-10-10T17:43:19Z` e
`2026-10-10T17:43:23Z`. O Workflow falhou em `prepare-repository`, com
`HOLON_GITHUB_NON_RETRYABLE:upstream_permanent`, antes de qualquer análise do
modelo. Cleanup foi concluído. A coleta focada retornou 12 eventos, com
`abr_level=1`; o core ativo era `0837989c-47f8-405b-8451-828d7fc3b5b5`,
tag `b7dd6b4`, anterior às correções deste PR.

A leitura independente do endpoint usado por `pullRequestDiff` retornou
HTTP 406, `resource:PullRequest`, `field:diff`, `code:too_large`, informando
limite de 300 arquivos. O diff local passou de 279 arquivos em `4001031`
para 323 em `37a7c08`. Essa falha é de admissão pela integração GitHub;
não demonstra incapacidade do modelo nem testa a coleta de evidências.

Para recuperar a admissão sem ocultar código ou descartar evidências, 30
capturas históricas foram compactadas com o leitor já existente. Manifesto,
tamanhos e SHA-256 preservam os bytes originais; o replay foi comparado com os
blobs de `37a7c08`. As duas prévias principais, capturas atuais e previews de
email permanecem diretos. A [galeria](../planning/dashboard-seven-assets/README.md#arquivo-das-capturas-anteriores)
mantém acesso às outras imagens pelo commit imutável e pelo arquivo. Essa etapa
reduziu o diff a 295 arquivos, mas a API passou a informar outro teto:
20.000 linhas, ainda com HTTP 406/`too_large` no HEAD `f86a628`.

O arquivo foi ampliado para 36 entradas: as mesmas 30 capturas e seis
documentos/resultados datados. M6, M7, auditoria, método, JSON sanitizado e lab
foram comparados byte a byte com `f86a628`; índices legíveis apontam ao relatório
integral no commit imutável e ao replay local. Código, testes, ADRs e runbooks
continuam diretamente no diff. O manifesto e o leitor validam integridade e
expansão; `pnpm test:evidence`, formatação e replay passaram. A descrição do PR
registra a confirmação independente da leitura do diff após o push final.

## Pendências de evidência remota

- A promoção deve seguir o runbook e exigir Workflows/cleanup drenados. Não houve
  deploy nesta iteração de correções.
- Uma nova run real precisa comprovar os retries, a ausência de loops tardios,
  as contagens do inventário e o estado da projeção na versão publicada.
- O gate causal permanece obrigatório. A mudança de instrução e a correção da
  pista estrutural não comprovam precisão, recall, custo ou latência do modelo.
  Trocar modelo/provedor ou alterar a rota exige qualificação própria.
- Falta de janela canônica, inventário acima de 1 MB, limite de 64 partes,
  evidência rejeitada e orçamento insuficiente ainda produzem incompletude.
  Nenhum contador foi ocultado para conseguir aprovação.
