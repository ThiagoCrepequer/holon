---
id: RESEARCH-2026-10-04-DASHBOARD-READ-MODEL
kind: research
status: current
date: 2026-10-04
verified-at: 2026-10-04
owners:
  - core-team
related:
  - ../planning/dashboard-engineering-decision-review.md
  - ../engineering/dashboard-identity-and-workspaces.md
  - 2026-10-04-dashboard-authentication-discovery.md
---

# Leitura, autorização e busca do dashboard

## Pergunta e conclusão

Como implementar lista D1 e detalhe autoritativo do core com isolamento por
workspace, ordenação durável e busca por título conforme Q5/Q21/Q22?

**Proposta técnica:** índice funcional canônico por repo/PR separado da base
crítica de identidade; revisão monotônica por PR; obrigação coalescida no ledger
com recuperação por alarm; detalhe agregado via entrypoint restrito do control
plane. Busca candidata por `instr()` em coluna normalizada, com índice de escopo/
ordenação, mantendo número exato como caminho próprio.

Um experimento SQLite local reproduzível confirma semântica limitada e planos;
não é benchmark D1 nem demonstra acesso privado, atomicidade de alarms ou
integração real. Não há read model/dashboard de usuário materializado no runtime.

A [revisão de robustez](#revisão-de-robustez--2026-10-04) qualifica consistência
do agregado, causalidade dos metadados, rearmamento de alarm e limites do SQL.

## Autoridades verificadas no código

[Identity](../../packages/domain/src/identity.ts) compõe
`github:<repositoryId>:pr:<pullRequestNumber>`; [review services](../../apps/control-plane/src/review/review-services.ts)
resolve ledger por esse PR key. Workspace não faz parte dessa identidade.
[Ledger](../../apps/control-plane/src/ledger/ledger-object.ts) mantém findings e
estados mutáveis na mesma run; `runId`/`causalVersion` não ordenam todas as
mutações observáveis. Não atribuir uma revisão de execução a toda mudança de UI.

[Check Run reconciliation](../../apps/control-plane/src/ledger/check-run-reconciliation.ts)
já possui obrigação coalescida, revisão e confirmação. A revisão é dessa tarefa,
não revisão global do snapshot de review. Maintenance alarm existente é padrão
reutilizável, não prova de projeção já implementada.

Envelope atual não captura título/autor. `runs` não retém instalação como vínculo
SaaS e credential scopes são limpos ao terminalizar. Não usar tarefa de publicação
ou credencial efêmera como autoridade de workspace. Metadados exigem ingresso
validado/enriquecimento; atualização de título/estado não dispara review só para UI.

## Autorização GitHub candidata

Usar user access token GitHub App para a interseção App/usuário, evitando scope
OAuth amplo `repo` apenas para login. Modo do provider, renovação e email verificado
precisam de prova Better Auth/Workers; OAuth App token não é equivalente.
[GitHub user access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

| Capacidade                  | Caminho documentado / validação                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Grant de leitura privado    | `/user/installations/{installation_id}/repositories`, com token do usuário; Metadata read, páginas percorridas e ID de repo correspondente |
| Owner de org para Q31       | `/user/memberships/orgs`, paginado: org ID da instalação, state active e role admin; token GitHub App documentado sem permissão adicional  |
| Instalação da conta pessoal | Instalação consultada pelo servidor para o App correto; installation account ID igual à identidade GitHub autenticada                      |
| Acesso local                | Sessão e membership/role atuais no D1 autoritativo, instalação vinculada/ativa e grant humano; escopo antes de paginação/contagem e DTO    |

Lista `/user/installations` inclui leitores e não comprova gestão. Setup
`installation_id` é entrada forjável, não prova. GET pontual de membership tem
requisitos diferentes da lista; não ampliar Members read sem necessidade.
Provar organizações privadas/SSO/acesso bloqueado e refresh real. Q30 limita
cache de grants a 60 s; indisponibilidade após expiração não concede leitura.
[Installations](https://docs.github.com/en/rest/apps/installations),
[memberships](https://docs.github.com/en/rest/orgs/members#list-organization-memberships-for-the-authenticated-user),
[setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url).

## Snapshot, projeção e recuperação

1. Cada mutação observável incrementa revisão monotônica por PR e persiste
   obrigação de projetar latest snapshot na mesma transação do ledger.
2. Wake-up da obrigação também precisa ser durável/atômico. `transactionSync`
   não permite await de `setAlarm`; `storage.transaction(async ...)` SQLite é
   candidato documentado para combinar SQL/storage. Provar o caminho real;
   não confiar em alarm após commit ou construtor que só roda quando chamado.
3. Alarm entrega snapshot mínimo por interface estreita; UPSERT aplica somente
   `incoming_revision > stored_revision`, tolerando repetição/reordenação.
4. Confirmação cobre a revisão entregue. Se uma nova revisão aparecer durante
   I/O, ela continua pendente; sucesso antigo não apaga a obrigação nova.
5. Erro antes/depois da escrita D1 conserva tarefa; recuperação reenvia snapshot
   determinístico. Projeção é dado derivado, não fonte de autorização.

[SQLite DO transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction),
[alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).

Não adicionar outra Queue à projeção por disponibilidade: o ledger já tem
maintenance alarm e o volume ainda não demonstra necessidade de outro canal.
Queue foi acordada para emails por Q36; não é inferência para todo efeito.
Detalhe agregado no próprio ledger fornece um snapshot consistente por RPC;
não montar N leituras separadas nem consultar DO/GitHub por linha da lista.

Manter projeção canônica por `(repository_id, pull_request_number)` e conferir
workspace→instalação→repo/grant antes de devolver resultado. Vínculo com workspace
não modifica a chave funcional do core; índices/query keys não substituem ACL.
Índice começa vazio sem backfill, conforme Q6.

## Bancos propostos e consistência

**Dois D1 iniciais recomendados:** identidade/tenancy/convites/intenção de envio
juntos, projeção funcional separada. Cada D1 processa queries sequencialmente;
isolar busca/projeções evita disputar a autoridade crítica de sessão/membership.
É inferência de contenda/fronteiras, não prova de latência ou throughput superior.
`packages/db` pode conter ambos sem misturar schemas/owners de migrations.
[Limites/concurrency D1](https://developers.cloudflare.com/d1/platform/limits/).

Não habilitar read replicas na autoridade local inicialmente. A próxima request
precisa reconhecer revogação conforme Q30; bookmarks do próprio usuário não
provam que leu revogação feita por outro. Se adotada replicação depois, revisar
rota de leitura primária/`first-primary`, adapter e cobertura de request.
Replicação D1 também não fecha o atraso ledger→projeção.
[D1 replication](https://developers.cloudflare.com/d1/best-practices/read-replication/).

## Busca literal e experimento reproduzível

Candidato: título original para exibição, coluna `title_search` normalizada no
ingresso e termo normalizado pela mesma política. Usar
`instr(title_search, :term) > 0`, repo autorizado como escopo e atividade recente
com desempate estável. `%`/`_` são literais, não wildcards. `LIKE/GLOB` no D1
possuem limite documentado de 50 bytes de padrão; não truncar texto silenciosamente.
Número exato usa índice próprio. B-tree restringe repo/ordem, não substring.
[Limites D1](https://developers.cloudflare.com/d1/platform/limits/),
[índices](https://developers.cloudflare.com/d1/best-practices/use-indexes/).

FTS tokenizado mudaria contains; trigram tem condições para termos curtos,
acentos e sua otimização de LIKE. Não adotado antes da comparação semântica.
[FTS5](https://www.sqlite.org/fts5.html#the_trigram_tokenizer).

Executado em **2026-10-04**, Python/SQLite **3.53.1**, em memória, 20 mil rows
sintéticas (10 mil por repo), páginas 50. Artefatos:
[script](experiments/2026-10-04-dashboard-read-model/sqlite-probe.py),
[saída](experiments/2026-10-04-dashboard-read-model/sqlite-probe.json).
Comando na raiz: `python3 docs/research/experiments/2026-10-04-dashboard-read-model/sqlite-probe.py`.

| Caso                                     | Evidência local                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Repo/atividade                           | SEARCH por covering index `(repo_id, activity DESC, pr_no DESC)`        |
| Repo/estado/atividade                    | SEARCH por covering index `(repo_id, state, activity DESC, pr_no DESC)` |
| Repo/número exato                        | SEARCH pela PK composta                                                 |
| Contains normalizado                     | Índice restringe repo e ordem; substring examina candidatos             |
| `FÉ` em título `CAFÉ`                    | Encontrou PRs 9007/777/7; NFC/NFD com equivalência testada              |
| Literal `100%_` / termo de 80 caracteres | Correspondências esperadas sem LIKE                                     |
| UPSERT rev 3/4/6/5 sobre rev 4           | Manteve conteúdo e revisão 6                                            |

Normalização do experimento: NFD + lowercase Unicode + remoção de categorias M.
**Não é casefold Unicode completo:** `ß` e `SS` não ficaram equivalentes. Ainda
não há normalizador TypeScript provado. Definir/cobrir política consistente de
caixa/acentos, NFC/NFD, sigma/ligaturas, emojis e termos curtos antes de prometer
suporte irrestrito. Não usar normalização de busca para identidade/autorização.

A página rara ou sem resultado pode examinar todo o repo; este experimento não
mede rows_read do D1, rede, lag ou carga. Cursor composto deve ser validado com
mudanças concorrentes de atividade/filtros; ordenação estável não oferece uma
visão congelada entre requests por si.

## Próximas provas e limites

Fontes verificadas em **2026-10-04**. O experimento confirma apenas semântica
limitada/planos e rejeição local de reordenação. Sem testes do Holon, Workerd/D1,
auth, benchmark remoto ou produção. Não alterou schema/binding/runtime atual.

Provar agregado consistente, erro/reordenação/revisão nova durante envio,
atomicidade de alarm com obrigação, lag/recuperação e persistência de instalação
como autoridade separada. Repetir SQL/normalização em Workers e D1 autorizado,
medindo plano/rows_read/rows_written, latência, payload e lag conforme fixture
Q14/Q15. Validar revogação em leituras, paginação/contagem após ACL e resposta
atrasada após troca de workspace/logout. Não importar histórico real.

## Revisão de robustez — 2026-10-04

### Snapshot e causalidade são contratos

RPC agregado por si não garante consistência. Capturar revisão, run/head,
metadados e findings numa leitura síncrona/transação consistente do ledger,
materializar DTO antes de I/O externo e projetar exatamente esse snapshot.
Mesma revisão identifica o mesmo conteúdo. Se o conteúdo divergir na mesma
revisão, rejeitar/sinalizar violação, não aceitar silenciosamente novo payload.

Deduplicação/reconciliação de eventos deve anteceder revisão nova. Webhook antigo
não pode virar título/estado/head atual só por chegar depois. Atividade representa
mudança válida do domínio, nunca horário de retry/projeção. Detalhe mostra SHA e
instante observado; ausência de resultado para head observado não autoriza
apresentar findings anteriores como atuais nem prometer head GitHub em tempo real.

### Um alarm para várias obrigações

DO tem um agendamento de alarm e até seis retries automáticos. Só conservar
tarefa não garante despertar depois da falha prolongada. Handler precisa
persistir próxima tentativa e rearmar duravelmente, usando o menor vencimento
entre projeção, cleanup, checks e supersession. Trabalho limitado por execução;
falha de projeção não bloqueia limpeza/publicação nem dispara loop sem backoff.

Atomicidade obrigação/revisão/wake-up precisa ser comprovada no storage real;
o core atual registra obrigação e agenda manutenção em passos separados.
Não copiar essa janela como garantia nova. Provar outage do destino além dos
retries nativos, interrupção no rearmamento e revisão nova durante envio. Falha
do próprio storage que impeça persistir/rearmar deve ser detectável como incidente;
não prometer recuperação infinita por retries finitos da plataforma.
[Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[transações](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction).

### Paginação, autorização e limites do experimento

O SQL executado retorna somente `pr_no`, primeira página de um repo. Portanto
os índices covering da tabela experimental não provam custo do DTO real com
título/autor/estado/datas, nem cursor, paginação ou lista global. Provar queries
com esses campos e termos raros/curtos/sem resultado. Número exato e título
literal precisam ter composição/deduplicação explicitada no contrato de busca.

Primeira lista é por repo selecionado e autorizado; grants paginados precisam
de conjunto completo antes de filtros/contagem/limite. Não inferir que página
parcial GitHub prova ausência de grant. Se houver vista de todos os repos depois,
ela exige query/plano global com repo no desempate, não concatenação de páginas
independentes ou ACL pós-LIMIT. D1 documenta até 100 parâmetros por query;
lista arbitrária de IDs em `IN (...)` não é solução sem limite/plano.

Cursor candidato usa atividade + identidade estável, validado contra repo,
filtros e ordenação; mudar filtro reinicia cursor. A lista é uma observação
atual por página, **não snapshot histórico congelado entre requests**. Mudança
de atividade concorrente pode mover item entre páginas; UI deduplica identidade
e refresh explícito reinicia navegação. Não criar histórico para resolver Q6.

Restauração do ledger para revisão inferior à projeção D1 faz UPSERT rejeitar
a autoridade recuperada. Recuperação exige reconciliar/reconstruir a projeção
afetada explicitamente, com recursos/artefatos confirmados e autorização; não
resetar contador silenciosamente nem chamar backfill de histórico no MVP.
Suspender produtores e escritas da projeção; barrar snapshots pré-restore ainda
em trânsito inclusive após retomar. Geração de recuperação persistida/capturada
no snapshot é candidata a essa barreira: retry lê autoridade recuperada, não
anexa geração nova a payload antigo. Provar corrida revisão 100 em trânsito →
restore/reconstrução em 60 → entrega tardia negada, conforme o roteiro operacional.
O [guia de ambientes/recuperação](../operations/dashboard-environments-and-recovery.md)
delimita essa operação.

Fontes reconsultadas em **2026-10-04**: [limites D1](https://developers.cloudflare.com/d1/platform/limits/)
e [PITR DO](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api).
Correções são propostas do protocolo; o experimento continua limitado ao SQLite
local e não prova esses novos cenários, DTO, autorização ou performance D1.
