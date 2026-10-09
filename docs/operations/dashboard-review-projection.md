---
id: DASHBOARD-REVIEW-PROJECTION
kind: runbook
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Projeção e leitura privada de reviews

Este documento responde como operar a projeção atual de Dashboard 5, milestone
GitHub #6, sem transformar o derivado em autoridade de execução. Código e testes
locais implementam o protocolo; deploy, migrations remotas, PITR e benchmark
remoto exigem autorização e evidência próprias. Não foram executados nesta entrega.

## Autoridades e contratos

O ledger conserva a chave `github:<repositoryId>:pr:<number>`, sem workspace ou
nova chave por tenant. `review_read_metadata` guarda os campos permitidos do
webhook assinado. Versão externa `updated_at` precede ordem de chegada:
repetição idêntica não muda a revisão; versão inferior é ignorada; mesma versão
com conteúdo divergente produz `metadata_conflict`. Somente uma versão causal
posterior resolve essa ambiguidade. O detalhe fica indisponível nesse estado;
a lista identifica a necessidade de reconciliação. Não afirmar qual título/head
é o mais recente quando a fonte não permite determinar essa ordem.
Quarentena conserva a evidência selecionada, sem entregá-la até reconciliação.
Uma instalação substituta no mesmo repo/PR é aceita somente por sucessão causal:
a chave e revisão do PR permanecem, e o novo escopo começa sua geração em 1.
O detalhe exige a instalação vigente; capturas antigas conservam seu escopo e
geração originais. Eventos anteriores não reinstalam o vínculo antigo.

`review_read_snapshot` guarda revisão monotônica por PR, geração de recuperação,
digest do agregado e cabeçalho mínimo. Mudança observável acopla estado, revisão,
obrigação coalescida e `setAlarm` na mesma transação suportada do storage.
O digest elimina revisões de retries idênticos. Atividade é o máximo dos relógios
causais significativos; operações idempotentes, entrega de projeção, cleanup,
checks e publicação de respostas não promovem um PR na lista. Estado de retry
pode mudar a revisão, preservando a atividade anterior.

Evidência selecionada do resultado atual permanece em `private_review_detail`,
uma linha limitada por achado, mesmo após limpeza dos artefatos temporários de
análise. Novo head remove o agregado anterior; runs de outro head não são
apresentadas como atuais. Não há importação de histórico/backfill. Um repositório
vinculado pode legitimamente ter lista vazia até ingressos posteriores.

Service bindings privados:

- Core → `ReviewProjectionWriter.write`: `{generation,snapshot}` strict; sem
  sessão, prompts, diffs, custos internos, credenciais ou handles SQL.
- Dashboard → `DashboardReviewReader.detail`: coordenadas de instalação/repo/PR
  e cursor. Retorna geração capturada, cabeçalho, resumo, até dez achados e cursor
  ligado à mesma revisão. Mudança entre páginas exige começar novamente.
- `beginRecovery`, `activateRecovery` e `resumeProjection` são capacidades
  operacionais privadas. Nenhuma possui handler HTTP público.

Sessão, membership, conexão, credencial e grant GitHub atuais continuam sendo
política M3. O caso compartilhado autoriza a instalação/repo selecionada antes
de ler D1/core e revalida após I/O, inclusive a identidade da sessão. A geração
D1 também é conferida antes/depois. Contagens, LIMIT e cursor nunca ampliam ACL.
IDs/cursor enviados pelo browser não concedem acesso.

## Entrega, limites e sinais

O único alarm do ledger conserva os prazos de cleanup/checks/supersession e
projeção. A consulta respeita o limite de cinco termos de compound SELECT do
SQLite do DO. Cada tentativa captura geração/revisão/agregado antes de I/O,
persiste tentativa e próximo wake antes de chamar o writer, e tem deadline de
10 s. Backoff: 5 s, exponencial, limitado a 1 h. Não há limite de seis tentativas
produtivas: enquanto storage/alarm funcionarem, a obrigação permanece recuperável.
Os retries nativos do alarm não substituem esse estado.

D1 aceita revisão maior dentro da geração vigente. Revisão igual com payload
idêntico é replay; payload diferente é conflito; revisão inferior ou geração
antiga não recebe confirmação de sucesso. O ack exige geração, revisão e
número de tentativa correspondentes; ack antigo não apaga obrigação nova.
Timeout não cancela nem comprova falha do efeito remoto.

Eventos `dashboard.projection_retry` e `dashboard.projection_blocked` registram
somente tentativa, classe de erro, geração/revisão e resultado. Investigue
obrigações antigas, conflitos, geração divergente e lag; não registrar payloads,
títulos, paths, texto dos achados ou mensagens arbitrárias de exceção.

A lista tem até 50 itens, ordenados por atividade e número de PR descendentes.
Busca é `contains` literal após NFD, lowercase e remoção de marcas Unicode,
no writer e na query. `%` e `_` são literais (`instr`); número exato e título
formam uma união sem duplicatas. `Straße` e `STRASSE` continuam distintos:
não é um case-fold linguístico completo. Cursor HMAC liga posição ao workspace,
instalação, repo, filtro e tamanho de página, usando a chave de servidor.
Rotação da chave invalida cursores, exigindo atualização explícita.

Cada página é uma observação atual, não um snapshot histórico. A atividade pode
mover PRs entre páginas. A identidade canônica impede duplicação no dataset;
consumidores que acumularem páginas devem deduplicar por instalação/repo/PR e
atualização manual reinicia o cursor. M5 renderiza uma página por vez.

SSR usa caso de uso direto e QueryClient por request; serialização do framework
preserva timestamp e escapa conteúdo hostil. Hidratação não faz leitura. O
clientLoader e refresh fazem uma leitura explícita pela API, com AbortSignal e
posse causal de cache. Mount/focus/reconnect não buscam dados. Revogação remove
cache privado; erro atrasado de um filtro não remove confirmação mais recente.

## Recuperação de DO e D1 divergentes

Exige plano autorizado com ambiente, installation/repository IDs, inventário
completo dos PRs observados e pontos de restauração. Preserve snapshots de
rollback e suspenda ingress/consumers do escopo; não criar outra run, mudar
checkout/head, zerar ledger de efeitos nem relançar workflows para reconstruir
somente leitura.

1. Registre geração atual `g` e revisão de DO/D1 de cada PR, sem conteúdo privado.
2. Pause produtores do escopo e invoque `beginRecovery` com geração esperada
   `g`. D1 muda para `rebuilding` e `g+1` atomicamente: leituras ficam fechadas e
   qualquer entrega capturada com `g` é rejeitada, inclusive depois da retomada.
3. Restaure a autoridade pelo procedimento Cloudflare autorizado. Confirme o
   inventário completo e estado dos efeitos; a revisão pode cair de 100 para 60.
4. Leia a geração efetivamente restaurada em cada ledger. Invoque
   `resumeProjection` com essa geração como expectativa e `g+1` da cerca D1
   como destino. O backup pode preceder outra recuperação e restaurar geração
   menor que `g`; não presumir que a geração foi conservada. Isso só instala a
   geração e obrigação/wake da projeção atual;
   não muda revisão de produto nem ressuscita runs. Nunca anexar `g+1` a uma
   captura antiga retida em memória; a captura deve vir da autoridade restaurada.
5. Aguarde confirmação de todos os PRs inventariados. Conferir que não restam
   linhas D1 da geração anterior. PR ausente da restauração é incidente a
   reconciliar explicitamente; não excluir silenciosamente para abrir o gate.
6. Invoque `activateRecovery` com `g+1`: o CAS rejeita ativação se houver linhas
   antigas. Verifique novamente geração, revisão, alarm e contagem do escopo;
   só então retome produtores/tráfego. Entregas antigas continuam fenced.

Falha intermediária conserva leitura fechada. Não decrementar geração, trocar
payload de mesma revisão, reiniciar contador ou aceitar revisão antiga para
obter sucesso aparente. O teste local simula a mudança de SQL 100→60, mantendo
entrega 100/g antiga em voo e restaura também uma geração anterior; isso não
constitui um ensaio de PITR remoto.

## Promoção e evidência remota

Antes de deploy coordenado: aplicar migration aditiva de projeção `0002`,
publicar writer privado, atualizar core (migration DO 24, ingress e producer)
e então confirmar reader/dashboard. Drenar mensagens/workflows do contrato
anterior de webhook antes da troca coordenada: esta entrega mantém um contrato
atual, sem fallback de payload antigo. Nenhuma alteração de secrets é necessária
para os bindings internos. Não executar estas etapas como teste local.

O benchmark local usa D1/Workerd real com 10.000 PRs em cada um de dois repos,
EXPLAIN e `meta.rows_read`/`duration`. Para completar o gate remoto de #157,
a bancada autorizada deve usar um D1 temporário isolado e fixtures sintéticas,
as migrations/adapter atuais, queries de primeira/próxima página, número+título,
filtro de estado, busca curta/longa/Unicode, rara tardia e sem resultado.
Registrar região, build, amostra fria/quente, bytes, linhas lidas/escritas,
latência p50/p95 e CPU do Worker por métrica suportada do ambiente. Duração D1,
tempo de parede do cliente e CPU são denominadores diferentes. Se CPU não estiver
disponível, registrar ausência e manter esse gate pendente. Remover recursos
apenas conforme a autorização e preservar resultados sem PII. Esta entrega
não substitui essas medições por SQLite host nem por estatística inventada.
O budget local de consulta limita cada statement a menos de 40.000 linhas lidas
na amostra de 10.000 PRs por repo; o teste exige metadados reais finitos e
EXPLAIN por índice escopado. Esse teto conservador não é um SLO de latência/CPU
remotas. Para CPU, a API GraphQL `workersInvocationsAdaptive` fornece quantis
do Worker isolado; registrar a janela/amostragem e separar requests de seed dos
requests de consulta. Ausência de amostra não equivale a CPU zero.

Fontes Cloudflare verificadas em 2026-10-09: [transações e cursores DO SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[limites D1](https://developers.cloudflare.com/d1/platform/limits/)
e [metadados de resultado D1](https://developers.cloudflare.com/d1/worker-api/return-object/).
Para CPU: [métricas de Workers via GraphQL](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/).
A evidência local e os gates pendentes estão na
[matriz M5](../planning/dashboard-milestone-five-evidence.md).
