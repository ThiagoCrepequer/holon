---
id: DASHBOARD-M5-EVIDENCE
kind: evidence
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Dashboard 5 · Projeção e leitura privada

Milestone GitHub **#6**, issues **#154–#158**, base
`7ead18c84e4fb958b28c9df5f1d157b7912dfde4` após merge de PR #183.
Esta matriz separa código, prova local e operação remota. O
[runbook](../operations/dashboard-review-projection.md) define contratos,
limites, fronteiras e recuperação. Verificações finais estão em andamento;
nenhum gate abaixo representa deploy/benchmark/PITR remoto.

| Issue/critério               | Implementação e oráculo                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #154 Metadados causais       | Webhook assinado captura título/autor/estado/head/base e versão externa; events edited/closed atualizam metadata sem iniciar review. Schema strict, poison negado. `review-read-model.test.ts` testa repetição, atraso e conflito de versão igual.                                                                                                      |
| #154 Revisão e atividade     | Digest do agregado e cabeçalho; transação acopla mutação/snapshot/obrigação/alarm. Repetição não incrementa revisão/atividade, head diferente não herda findings. Teste injeta falha real de setAlarm e verifica rollback SQL.                                                                                                                          |
| #155 Agregado restrito       | Service binding dedicado, nenhuma rota HTTP de core. DTO allowlist, geração/revisão/run/head coerentes, dez achados por resposta. 200 achados longos percorrem todas as páginas, sem truncamento, abaixo de 1 MiB; antigo cursor falha após novo head. Evidência selecionada sobrevive à limpeza temporária.                                            |
| #155 Privacidade             | Core confere coordenadas e dashboard confere autoridade humana antes/depois. RPC inválido/indisponível/cursor alterado vira erro seguro. DTO e SSR não contêm Account/credenciais, prompts, custos ou payload bruto do modelo.                                                                                                                          |
| #156 Liveness e concorrência | Writer D1 produtivo empacotado em fixture separada; DO SQLite real. Sete falhas, eviction, cleanup independente, perda de ack e revisão nova durante I/O conservam obrigação/wake. Confirmação velha não apaga novo target. Deadline e backoff persistidos.                                                                                             |
| #156 Restore                 | Teste composto instala 100/g1, captura em voo, simula restore DO 60, muda geração D1, reconstrói g2 e reabre; entrega 100/g1 é fenced. CAS rejeita reabertura com linhas antigas. PITR remoto não executado.                                                                                                                                            |
| #157 Consulta e ACL          | Instalação/repo autorizada única, antes de LIMIT/count; sem IN de grants ou fan-out por linha. Ordenação keyset, cursor HMAC por filtro/escopo, total mesma observação D1, estado/revisão corrente. Revogação durante leitura nega entrega.                                                                                                             |
| #157 Busca/volume            | D1 local real, dois repos ×10.000 PRs. Contains NFD/lowercase/mark removal; `%/_` literais, união número/título e Unicode. Rare late, nenhum resultado, curto, cursor inválido/trocado e limite excessivo. EXPLAIN usa índice de atividade. Página inicial 52 rows_read; count e buscas raras/sem resultado 10.002; duração local 0–2 ms nesta amostra. |
| #157 Benchmark remoto/CPU    | **Pendente de bancada autorizada.** A medição D1 local não comprova CPU/latência/quotas/região remotas. Protocolo e critérios de registro no runbook; não afirmar preenchimento desse aceite remoto.                                                                                                                                                    |
| #158 Casos compartilhados    | SSR chama diretamente `readPrivateReviews`; Hono chama a mesma função. Admission/grants/geração antes e após I/O. QueryClient por request, cache por user/session/scope/filtro, dehydrate pelo framework com timestamp preservado.                                                                                                                      |
| #158 Requests e cache        | Query observers disabled; clientLoader não chama serverLoader; navegação/filtro/page/detail/refresh explícitos, AbortSignal, erro velho não revoga confirmação nova, session loss limpa cache. Browser usa build SSR + DO + writer + D1 + OAuth controlado, sem algoritmo de persistência falso.                                                        |
| #158 Segurança               | No-store, CSP/nonce existentes, strings hostis escapadas, erro sem conteúdo privado, handlers não introduzem mutation GET, queries/transport feature-owned e imports pelo public da feature.                                                                                                                                                            |

## Primeiros resultados e limites

Primeiro teste focado falhou em D1 real com `store.write is not a function`:
o adapter de projeção era somente `assertReady`. A primeira composição do alarm
revelou limite de compound SELECT ao acrescentar sexto termo; consulta foi
corrigida, preservando os cinco conjuntos existentes. Testes do ledger e da
entrada conservaram asserções; fixtures foram migradas para o contrato atual.

Smokes usam repositórios, identidade, metadados e evidências sintéticas, com
provedor GitHub controlado. Não provam grant privado real, deploy, rollout de
schema, recuperação Cloudflare ou performance remota. `setAlarm`/transação e
D1/RPC são APIs reais no Workerd local. Thresholds 90%/85% permanecem vigentes.
