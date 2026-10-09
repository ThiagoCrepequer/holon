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
limites, fronteiras e recuperação. Os gates locais finais passaram em
2026-10-09; nenhum gate abaixo representa deploy/benchmark/PITR remoto.
As condições locais de #154–#156 e #158 foram preenchidas. A implementação
de #157 está presente, mas seu aceite remoto permanece pendente; o milestone
não deve ser declarado encerrado com base somente nesta evidência.

| Issue/critério               | Implementação e oráculo                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #154 Metadados causais       | Webhook assinado captura título/autor/estado/head/base e versão externa; events edited/closed atualizam metadata sem iniciar review. Schema strict, poison negado. `review-read-model.test.ts` testa repetição, atraso e conflito de versão igual.                                                                                                      |
| #154 Revisão e atividade     | Digest do agregado e cabeçalho; transação acopla mutação/snapshot/obrigação/alarm. Repetição não incrementa revisão/atividade, head diferente não herda findings. Teste injeta falha real de setAlarm e verifica rollback SQL.                                                                                                                          |
| #155 Agregado restrito       | Service binding dedicado, nenhuma rota HTTP de core. DTO allowlist, geração/revisão/run/head coerentes, dez achados por resposta. 200 achados longos percorrem todas as páginas, sem truncamento, abaixo de 1 MiB; antigo cursor falha após novo head. Evidência selecionada sobrevive à limpeza temporária.                                            |
| #155 Privacidade             | Core confere coordenadas e dashboard confere autoridade humana antes/depois. RPC inválido/indisponível/cursor alterado vira erro seguro. DTO e SSR não contêm Account/credenciais, prompts, custos ou payload bruto do modelo.                                                                                                                          |
| #156 Liveness e concorrência | Writer D1 produtivo empacotado em fixture separada; DO SQLite real. Sete falhas, eviction, cleanup independente, perda de ack e revisão nova durante I/O conservam obrigação/wake. Confirmação velha não apaga novo target. Deadline e backoff persistidos.                                                                                             |
| #156 Restore                 | Teste composto instala 100/g2 e captura em voo; restaura DO 60/g1, reconstrói g3 e reabre. Entrega antiga 100/g2 é fenced. CAS rejeita reabertura com linhas antigas; reconstrução não relança runs. PITR remoto não executado.                                                                                                                         |
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

## Revisão de Standards

A revisão independente encontrou uma janela de revogação após a última
checagem de ACL, porque ainda havia I/O de geração. O teste composto reproduziu
HTTP 200 quando esperava 403. A revalidação final agora termina na autoridade
humana; o teste passa com negação e sem payload privado.

O runbook também presumira que restore conservava a geração. Foi corrigido
para usar a geração efetivamente restaurada como expectativa do CAS. O ensaio
local cobre 100/g2 → 60/g1 → reconstrução g3, mantendo a captura antiga em voo.
A segunda revisão não encontrou achado material de implementação pendente.

## Revisão de Spec

A revisão independente reproduziu rejeição de uma instalação substituta no
mesmo PR. Uma versão causal superior agora pode mudar esse vínculo, mantendo
a chave do ledger; a instalação antiga perde acesso e eventos atrasados não
restauram o vínculo. A fixture anterior falhava com `review_scope_mismatch`.

Refresh cancelado por navegação deixava o botão desabilitado. O teste browser
falhou na asserção de botão habilitado após trocar filtro; o estado agora segue
a intenção/controlador atual. A segunda revisão confirmou as correções e
mantém o benchmark remoto da #157 como pendência de aceite.

## Regressões adicionais e integridade da prova

O teste com trigger SQL que aborta cleanup terminal mostrou que a transição
legada podia permanecer `completed`. O caminho sem metadados conserva a
transação síncrona original; com metadados, estado/snapshot/obrigação/alarm
usam a transação composta. Quarentena de versão igual divergente conserva a
evidência selecionada para reconciliação, sem servi-la durante o conflito.

Retries internos preservam atividade; falha definitiva volta a registrar a
atividade significativa. O teste terminal primeiro observou 00:00 quando
esperava 05:00, e passou após limitar a preservação ao retry recuperável.

O bootstrap real conserva CSP estrita. A dependência de schemas novos é
inicializada após a configuração Zod sem JIT vigente; o teste de execução
dinâmica negada continua passando nos três navegadores.

A fixture OAuth de M5 usa subjects próprios, evitando colisão com M2 quando
ambos rodam contra o mesmo D1 local. A prova de hidratação M3 usa contexto
novo com a sessão persistida e exige observar a interceptação de scripts,
antes de comprovar o bloqueio do primeiro clique.

O dashboard continua com cache Turbo de testes desabilitado. No control-plane,
os inputs de `test`/`test:coverage` incluem writer produtivo e fontes/migrations
D1 usados pela fixture entre Workers. Uma alteração temporária no writer mudou
o hash do plano; restaurar o arquivo restaurou o hash, preservando inputs e
dependências anteriores. Referência verificada em 2026-10-09:
[inputs do Turbo](https://turborepo.dev/docs/reference/configuration#inputs).

## Verificação final — 2026-10-09

Node 24.11.0 e pnpm 11.24.0. Base verificada novamente em `origin/main`:
`7ead18c84e4fb958b28c9df5f1d157b7912dfde4`. Implementação e correções nos
commits `f76c8a3`, `a55294c`, `6c9f809` e `ca3bb19`.

| Comando/prova                                                    | Resultado                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm verify`                                                    | Passou: marca, schema/config atual, formatação, lint, tipos, arquitetura, gates deploy/evidence, cobertura e builds/dry-runs.                                            |
| `CLOUDFLARE_ENV=production pnpm --filter @holon/dashboard build` | Passou com os bindings identity/projection/core/email de produção; upload calculado 3024,41 KiB, gzip 637,89 KiB. `--dry-run`, sem publicação.                           |
| Core Workerd                                                     | 409 testes, incluindo 11 cenários de read-model; cobertura statements/branches/functions/lines: 92,42% / 86,99% / 94,23% / 93,59%.                                       |
| D1 Workerd                                                       | 164 testes; 94,84% / 87,29% / 99,21% / 95,59%. Dois repos com 10 mil PRs cada; métricas reais locais e consultas de orçamento preservadas.                               |
| Application                                                      | 162 testes; 96,18% / 90,02% / 98,14% / 97,33%. ACL compartilhada, entrega após I/O e falhas do reader.                                                                   |
| Contracts                                                        | 178 testes; 96,44% / 92,85% / 96,66% / 97,48%. Limites de entradas, envelopes e DTOs atuais.                                                                             |
| Dashboard Node / Workerd                                         | 154 / 97 testes. Node: 95,56% / 91,08% / 94,91% / 96,30%; Workerd: 95,61% / 89,80% / 98,73% / 96,40%.                                                                    |
| Dashboard browser                                                | 12 cenários de fundação + 54 autenticados, incluindo 4 de M5 × 3 navegadores. Chromium, Firefox e WebKit passaram. Workspace de prova da fundação: 60 cenários passaram. |
| `git diff <base> --check`                                        | Passou; alterações do milestone isoladas, sem alteração local preexistente no início.                                                                                    |

O gate completo reutiliza o cache permitido das tarefas inalteradas; core e
dashboard foram revalidados após as correções finais. A publicação do PR não
confirma CI remoto. GitHub real, rollout de schemas, PITR e benchmark remoto
não foram executados. A autorização da bancada sintética para #157 foi
solicitada separadamente, conforme AGENTS.md e a própria issue, e não foi
inferida do pedido de PR.
