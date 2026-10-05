---
id: RESEARCH-2026-10-04-DASHBOARD-ROBUSTNESS-REVIEW
kind: research
status: current
date: 2026-10-04
verified-at: 2026-10-04
owners:
  - core-team
related:
  - ../planning/dashboard-implementation-plan.md
  - ../planning/dashboard-engineering-decision-review.md
  - ../engineering/web-security-and-data-boundaries.md
  - ../operations/dashboard-environments-and-recovery.md
---

# Revisão de robustez do planejamento do dashboard

## Escopo e resultado

Em 2026-10-04 o responsável pediu revisão completa das pesquisas, plano e
referências derivadas de Q1–Q37, com segurança, usabilidade, performance,
organização e testes, sem workarounds para refatorar depois.

**A direção de produto permanece coerente; o planejamento tinha lacunas de
protocolo e prontidão.** Elas foram corrigidas nos documentos donos e consolidadas
no [plano de implementação](../planning/dashboard-implementation-plan.md).
Isso torna as condições explícitas; não prova um dashboard inexistente.
O candidato estável de auth continua com um bloqueio de viabilidade do cadastro
User/Account: um caminho suportado deve passar antes de implementar onboarding.

MVP limita funcionalidades, não enfraquece garantias dos fluxos incluídos.
Não reabrimos Q1–Q37, adicionamos polling, histórico de reviews, billing, outro
motor de animação ou restauração do admin. Não houve mudança no runtime.

## Cobertura da revisão

- Pesquisas de bibliotecas, referências visuais, descoberta auth, persistência
  auth, emails, leitura e artefatos SQLite.
- Registro Q1–Q37, organização frontend, identidade/workspaces, TypeScript/módulos
  e critérios de testes/evidência.
- Derivações de marca: motion, ícones, integração e referências de componentes;
  conferência de tokens/check vigente. Os vídeos são evidência visual anterior,
  não foram usados para inferir implementação, acessibilidade ou performance.
- Grafo/ADRs pertinentes, manifests, CI/checker de imports, ledger/ingresso e
  cobertura atual. Inventário de funcionalidades de PR e pesquisas antigas são
  radar/histórico; não ampliam a primeira fatia.

Método: leitura do checkout, fontes oficiais e código publicado, com três
explorações factuais independentes de auth, confiabilidade e frontend. Memória
serviu apenas para localizar convenções de skills; estado/convenções do projeto
foram conferidos no catálogo atual. Skills não substituíram ADRs ou autorização.

## Achados e ajustes

| ID  | Achado                                                                                                      | Ajuste documental e fonte dona                                                                                                                                                                                | Estado                                                      |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| R01 | Compatibilidade de peers confundida com prontidão; cadastro OAuth pode deixar User sem Account              | [Auth](2026-10-04-dashboard-auth-persistence-investigation.md#revisão-de-robustez--2026-10-04): no-go até atomicidade/recuperação suportada; sem patch/core copiado ou fusão por email                        | Condição bloqueante explícita; runtime não provado          |
| R02 | Handler auth completo pode expor tokens OAuth e segredo de sessão no JSON nativo                            | Auth + [segurança web](../engineering/web-security-and-data-boundaries.md): método/path/provider permitidos; DTO Holon de sessão/dispositivos; token secreto só no adapter/cookie HttpOnly                    | Desenho corrigido; respostas reais a testar                 |
| R03 | Zero rows numa guarda não desfaz inserts dependentes do batch                                               | Auth/segurança: todos os efeitos condicionados à mesma autoridade/estado/operation ID; constraints, replay e concorrência com oráculo independente                                                            | Protocolo exigido; SQL D1 a provar                          |
| R04 | Mutex/CAS local não recupera refresh GitHub consumido com resposta perdida                                  | Auth: uma porta de renovação, tentativa/revisão persistidas, resultado precisa reconectar, sem concessão privada ou retry cego                                                                                | Falha/UX definidos; integração a provar                     |
| R05 | CSRF/origens/reauth/sessão pública estavam só como lista genérica de pendências                             | Segurança web: cookies host-only, origens exatas, métodos seguros, CSRF próprio Hono, redirects e intenção de reauth                                                                                          | Requisitos explícitos; valores reais no preparo do ambiente |
| R06 | Convite/email verificado poderia depender de flag antiga ou bearer secret recuperável                       | Segurança/workspaces: ID opaco sem autoridade; POST por alvo confirmado atualmente no provider, account/estado/prazo fixados; replay por User                                                                 | Proposta técnica sem nova política de ingresso              |
| R07 | Publisher focava pending; job publicado podia desaparecer pela retenção sem conclusão                       | [Email](2026-10-04-dashboard-email-delivery-investigation.md#revisão-de-robustez--2026-10-04): vigília de todos não terminais, próxima ação, budget persistido e recuperação independente da request/Queue    | Liveness completada no desenho                              |
| R08 | Encaminhamento DLQ era tratado como falha de negócio persistida; lease antiga poderia descartar sucesso     | Email: budgets separados, reconciliador autoridade, registro por tentativa legítima, CAS de claim e evidência tardia                                                                                          | Estados/provas completados                                  |
| R09 | Claim válido parecia prometer impedir cancelamento antes do envio                                           | Email: revalidação reduz janela; D1/provider não são atômicos; cancelamento bloqueia ingresso e novas tentativas, sem recolher chamada concorrente                                                            | Garantia delimitada; Q37 preservada                         |
| R10 | Obrigação pendente e retries de alarm não garantiam retomada após outage longa                              | [Leitura](2026-10-04-dashboard-read-model-investigation.md#revisão-de-robustez--2026-10-04): rearmamento durável, próximo vencimento comum e trabalho limitado sem bloquear cleanup                           | Protocolo completado; atomicidade real a provar             |
| R11 | RPC agregado parecia garantir snapshot; revisão nova não prevenia metadado antigo                           | Leitura: captura consistente antes de I/O, mesma revisão/mesmo conteúdo e reconciliação causal antes de incrementar                                                                                           | Contrato explícito                                          |
| R12 | Experimento covering retornava só IDs/primeira página, sem DTO/paginação real                               | Leitura: limite da prova corrigido; DTO aprovado/cursor/busca/ACL pré-LIMIT e custo precisam de prova própria                                                                                                 | Evidência delimitada sem benchmark fictício                 |
| R13 | Router e Query podiam duplicar fetch por navegação; serialização simples não protegia HTML                  | [Frontend](../engineering/frontend-application-structure.md#dono-da-leitura-em-ssr-hidratação-e-navegação): ponte única, cache por request, transporte seguro, leitura explícita e zero request na hidratação | Candidato definido; spike bloqueante                        |
| R14 | Preservar dado em toda falha contradizia revogação; request antiga podia afetar escopo novo                 | Frontend/segurança/testes: fallback só com autoridade válida, 401/403/indisponibilidade após expiração fecham privado, geração isola respostas/erros                                                          | Regra corrigida                                             |
| R15 | Default reducedMotion de Motion não implementa duração zero para opacidade/cor                              | [Motion](../brand/motion.md#implementação-e-revisão): preferência observada, duração zero/stagger/loops desativados em todos os motores                                                                       | Guia corrigido; React futuro a provar                       |
| R16 | Checker TSX descrito genericamente como ausente; baseline/coverage frontend imprecisos                      | Frontend/testes: scanner reconhece TSX, mas resolução .js→.ts/escopo atual não prova ciclos novos; fixtures negativas e configs independentes                                                                 | Fato corrigido; não liberar novos imports agora             |
| R17 | Baseline sem objetivo podia legitimar performance ruim; rollback/restore não tinham protocolo               | Plano e [operação proposta](../operations/dashboard-environments-and-recovery.md): objetivos/budgets antes de promoção, restore coordenado sem reviver autoridade/efeitos ou travar revisão inferior          | Critérios operacionais explícitos                           |
| R18 | Histórico de rodadas misturava decisões já resolvidas com pendências atuais                                 | Índices e pesquisa apontam plano atual; histórico preservado e rotulado; skill curta direciona agentes às fontes donas                                                                                        | Navegação/documentação corrigidas                           |
| R19 | Login inicial ainda anônimo e reauth eram tratados como contexto idêntico; replay OAuth parecia recuperação | Segurança/auth/plano: browser/state/PKCE no primeiro login, identidade/intenção adicionais em reauth; novo OAuth recupera cadastro, code consumido é negado                                                   | Fluxos e provas separados                                   |
| R20 | Aceite idempotente poderia restaurar membership posteriormente removida                                     | Segurança/workspaces/testes: retorno histórico não reativa ingresso/acesso; regressão aceite → remoção → replay                                                                                               | Invariável explícita                                        |
| R21 | Reconstrução após restore não impedia snapshot antigo em trânsito voltar a gravar revisão alta              | Leitura/operação/plano: barreira em produtores/escritas e geração de recuperação capturada no snapshot, rejeição pós-retomada                                                                                 | Candidato/prova de recuperação completados                  |

“Corrigido” significa ajuste no planejamento. Os itens de suporte/execução
continuam sem comprovação e são gates, não dívida admitida na primeira publicação.

## Critério de robustez e limites da conclusão

Não há uma biblioteca que garanta sozinha segurança, usabilidade e recuperação.
O plano exige autoridade na mutação, estado/obrigação duráveis, tratamento de
efeito externo incerto, limites operacionais e testes na interface real.
Interfaces pequenas e localidade evitam espalhar o protocolo em rotas/hooks.
Novos packages e dependências precisam concentrar uma responsabilidade real.

As versões/baselines externas são evidência datada; revalidar ao fixar a composição.
Não declarar “mais performático” com um plano de índice ou benchmark de terceiro.
O candidato de dois D1 preserva fronteiras e reduz disputa esperada, mas requer
medição com grants/DTO/carga reais. Uma API de leitura coerente também precisa
ser legível sob erro/revogação, sem animação que esconda estado ou latência.

Validar cobertura automatizada por camada e matriz crítica de comportamento;
CI verde não substitui smokes de provider e evidência de operação. O
[plano](../planning/dashboard-implementation-plan.md#matriz-mínima-de-regressão)
liga cada garantia aos cenários mínimos. [Ambientes/recuperação](../operations/dashboard-environments-and-recovery.md)
liga cada autoridade ao seu operador e procedimento.

## Validações desta revisão

| Verificação executada                                         | Resultado e limite                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `oxfmt --check` nos documentos revisados                      | 20 Markdown passaram; skills são excluídas pela configuração vigente                                                |
| Links/âncoras locais e `related`                              | 29 arquivos, 373 links/âncoras e 41 referências, zero erros; não prova disponibilidade de URLs externas             |
| `pnpm brand:check`                                            | 46 pares de contraste e tokens passaram; check estático não é auditoria WCAG completa                               |
| `pnpm test:architecture`                                      | 3 testes passaram no grafo vigente; não comprova as extensões frontend propostas                                    |
| `sqlite-probe.py` e comparação com JSON registrado            | SQLite 3.53.1, 20 mil linhas sintéticas, output idêntico; somente semântica/índices exercitados no experimento      |
| Nova skill: frontmatter/nome/descrição/scaffold e referências | YAML validado por Ruby/Psych, regras básicas e links passaram; revisão independente de conteúdo sem achado restante |
| `git diff --check`                                            | Sem erro de whitespace nas mudanças rastreadas                                                                      |

Comandos pnpm usaram Node 24.19.0 e pnpm 11.24.0 disponíveis no runtime local,
com `--config.verify-deps-before-run=false`, sem alterar configuração ou instalar
dependências do projeto. O helper `quick_validate.py` de skill-creator foi
tentado, mas os Pythons disponíveis não contêm PyYAML; não declarou sucesso.
A validação YAML/básica da skill usou o parser existente Ruby/Psych. Não foram
rodados `verify`, suite completa/cobertura, build ou novos testes Workerd/browser:
o escopo desta revisão é documentação, não implementação de comportamento.

Não foram instaladas bibliotecas de dashboard, implementados auth/Workers novos,
alterados migrations/ADRs aceitos, criados recursos, enviados emails ou feito deploy.
Verificação documental e gate atual não provam os protocolos futuros descritos.
