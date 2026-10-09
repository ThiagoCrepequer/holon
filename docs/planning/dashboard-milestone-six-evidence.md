---
id: DASHBOARD-MILESTONE-SIX-EVIDENCE
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Evidência de Dashboard 6

## O milestone está encerrado?

Ainda não. O código implementa a experiência e preparação de promoção do
milestone GitHub #7, **Dashboard 6 · Experiência e promoção do MVP**. #163 exige
duas versões estáveis reais e aparelhos físicos; #164/#157 exigem benchmark D1
remoto; #165–#167 exigem ensaio/monitor/promoção operacional autorizados. O PR
deve permanecer draft até esses gates; seu merge sozinho não fecha #127 nem
autoriza operação. SSE #168 continua fora deste escopo.

Em 2026-10-09, o responsável autorizou ajuste da #165, deploys e testes em
produção, dispensando preview separado. O escopo operacional passa a usar os
Workers produtivos existentes com contas/repositórios de teste e destinatários
autorizados. A autorização não é evidência de execução nem encerra outras issues.

Base de implementação: PR #184 aceito, merge
`929ed5b8eaed671f7c6d5da3e8cdb1a117ba5ce0`. Os comandos abaixo são locais, com
Node 24.11.0 / pnpm 11.24.0 e dependências fixadas. Os testes não usam usuários,
conteúdo de repositórios ou destinatários produtivos.

## Matriz de requisitos

| Issue | Implementação/prova local                                                                                                                                                                                   | Condição restante para encerramento                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| #159  | `/account`, onboarding/workspaces/repositórios, membros/owners, governança OAuth, convites, sessões e preferências bilíngues; mesma intenção após resposta perdida; último owner; retorno/reauth no detalhe | Critérios locais cobertos pelo gate completo; encerrável                                                      |
| #160  | lista/status/search/order=activity na URL; cursor scoped, reset de filtro/refresh, back/forward, uma leitura por intenção, Query disabled; 50 por página e dois repos de 10k no D1 local                    | Critérios locais cobertos; benchmark remoto pertence à #164/#157                                              |
| #161  | rota de detalhe/painel comum, Markdown restrito, severidade/estado/evidência/sugestão, dez achados por payload/DOM; 200 achados, source original, Escape/foco/scroll, URL profunda                          | Critérios locais cobertos; matriz física/integração real pertence à #163/#167                                 |
| #162  | Dialog/painel usam CSS/tokens compartilhados; reduced motion instantâneo/live, close/reopen sem timer de foco nem evento close antigo                                                                       | Critérios locais cobertos; matriz física pertence à #163                                                      |
| #163  | matriz pt-BR/en × Chromium/Firefox/WebKit, keyboard, axe WCAG 2.2 AA, 320px/zoom200, CSP/HTML/tracking, retorno/expiry/reauth; retries=0, provas CI sete dias                                               | Últimas duas versões estáveis reais, Safari real e dispositivo físico; emulação não encerra issue             |
| #164  | bytes comprimidos reais por rota, fontes, cold/warm desktop/mobile CPU4x, SSR/filter/refresh p50/p95, SDK Web Vitals de teste, DOM limitado, budget negativo; D1 local 10k/2repos/raro/vazio/combinado      | Região/CPU/rows_read/D1 remoto, lag/publicação real e CWV de campo; não há p75 de campo local                 |
| #165  | quatro manifests por ambiente, preview opcional fechado, sender off, grafo estrito, artefato SHA/hash/schema/rollback, preflight negativo e CI sem deploy; gate de acesso do próprio ambiente               | Inventário real de produção, imagem por digest, acesso/escopo de teste e ensaio de deploy/rollback autorizado |
| #166  | hold independente, email/projeção/identidade integrados em D1, DO/alarm/core em testes reais locais, sinais numéricos e runbook/limites/owners                                                              | PITR coordenado das quatro autoridades e alertas remotos com disparo/recuperação e owner nominal              |
| #167  | sequência/gates de promoção explícitos, recusa de placeholders, schema divergente, imagem reconstruível e prova ausente/stale                                                                               | Publicação real do mesmo artefato, OAuth/GitHub privado/org/revoke e email/Queue real sob autorização         |
| #127  | experiência/core/admissão/efeitos integrados no código; evidência das issues específicas                                                                                                                    | Todos os gates operacionais acima; tracker não pode fechar por código local                                   |

Após o gate completo, #159–#162 podem usar `Closes`: os gates reais pertencem
às issues #163–#167, que permanecem abertas junto de #127. Não usar `Closes`
para issue com condição operacional restante. O
[runbook de promoção](../operations/dashboard-promotion.md) é dono do inventário,
sequência, recuperação e sinais. As matrizes M4/M5 continuam registrando os
limites das etapas anteriores, inclusive #157.

## Contrato de experiência

A conta agrupa identidade, preferências, dispositivos, equipes e conexões.
Instalação e repositório vêm de autoridade explícita; ID não é permissão. Um
novo refresh de repositórios limpa a coleção antes do I/O; 401/503 não conserva
links antigos como se estivessem autorizados. Membros paginam em 100, com nomes
e roles mínimos e ownerCount atual; SQL admite sessão/account/membership junto
dos dados na mesma batch, com relógio SQLite. Não há I/O depois desse snapshot
antes da resposta HTTP.

O formulário da lista acompanha a URL inclusive no back/forward. A ordenação
atual única é atividade descendente (Q13); valor explícito desconhecido é
rejeitado, sem contrato de versões/fallback. Refresh reinicia cursor da lista;
navegação/hidratação/foco não cria refresh extra. Cada observação mostra seu
timestamp e avisa que projeção pode atrasar o core. Nenhuma UI promete remoção
instantânea de dados de uma aba parada.

Detalhe usa rota profunda e painel com tokens da marca. Cada resposta contém até
dez findings. 200 findings longos percorrem vinte páginas, sem perdas/duplicatas
e com source original independente do locale. O retorno conserva cursor/filtro,
foco no trigger e scroll; reauth conserva destino completo. A conta recebe
`returnTo` somente relativo e validado como rota de review scoped, sem redirect
externo. Negação/expiração remove o dataset e oferece conexão/conta, inclusive
no error boundary SSR. O foco no título do detalhe não depende de animação.

Markdown usa apenas o lexer Marked 18.1.0 e elementos React fixos: headings,
parágrafos, emphasis, listas/tasks, links absolutos HTTP(S), blockquotes e código.
HTML é literal; images viram alt text sem request; URLs relativas/javascript/
data/mailto/credenciais não geram links. Tabelas/tokens desconhecidos ficam como
source em bloco, sem atributos dinâmicos. Limites de 768 tokens/depth16 fazem
fallback para source escapado. Não há `dangerouslySetInnerHTML`, plugin ou mídia
remota. Código/evidência permanece byte-preservado em `pre` focável e scroll
interno; o texto literal longo faz reflow sem esconder conteúdo.

## Provas e primeira execução

- Navegação nativa: teste vermelho encontrou input `2` depois de back para URL
  `search=1`; chave do formulário corrige o estado observado.
- Dialog DOM: close antigo após controlled reopen chamava onOpenChange(false);
  guarda baseada no estado nativo do diálogo corrige a corrida. WebKit depois
  expôs retorno de foco perdido após pointer/reopen; regressão DOM confirmou
  e `returnFocusRef` explícito corrige close/unmount sem timer. Seis testes UI.
- Membros D1: primeira execução falhou por método ausente; implementação e
  regressões cobrem permissão mínima, foreign workspace, sessão removida/expirada,
  revogação durante a entrada da batch e 105 membros sem duplicatas.
- Browser: Chromium/Firefox expuseram bugs de chaves duplicadas nas seções,
  reflow de resumo e acessibilidade de título/scrollable code; WebKit expôs
  quebra de texto literal. Os oráculos foram preservados e o produto corrigido.
- Recuperação: composição válida respondia 200 com modo ausente/closed;
  primeiro teste significativo ficou vermelho. Config independente passa a
  fechar serviço. Drill D1 integrado registrou 17 ms em 2026-10-09: índice
  100/g→60/g+1, replay fenced, revogação de sessão/membership, claim/start fechado,
  resultado tardio aceito e budget/deadline preservados. Não é duração de PITR.
- Artefato: exclusão genérica de pasta `projection` também excluía schema e
  falhou `missing_projection_schema`; restrição ao nível dist corrige a causa.
  Unit tests filesystem/bytes/config/rollback são negativos além do caminho feliz.
- Markdown: primeiro teste foi executado após implementar e passou; não é
  evidência de red-green. Limites e payload hostil são regressões adicionais.
- Alarm/grants: regressões nativas/persistidas ficaram vermelhas pela ausência
  dos sinais numéricos. Falha de agendamento conserva rollback e sinaliza code 1;
  agendamento seguinte sinaliza recuperação. Grants distingue denied/reconnect/
  outage e admissão atual sem IDs privados nem mensagens de erro do provider.
- Budgets: teste negativo encontrou amostra inválida mascarada por `Math.max`
  do outro perfil/interação. Cada medida é validada antes da agregação; os
  ceilings permanecem inalterados.
- Promoção: regressão vermelha provou que um grafo avulso por digest podia
  acompanhar artefato com Dockerfile. O preflight passa a derivar o grafo dos
  bytes reconferidos e comparar a configuração compilada; alteração de binding,
  DB, modo ou imagem depois do congelamento é recusada.
- Onboarding bilíngue: revisão encontrou helper fixando login/pessoal/link em
  inglês; assert nativo de `html lang=pt-BR` ficou vermelho. Helper acompanha
  locale desde login, aceite usa o mesmo idioma e a matriz cobre instalação
  permitida/negada e ausência de controles owner para o membro.
- Primeira interação: browser com JS bloqueado confirmou login habilitado antes
  dos handlers. Login, preferências, dispositivos e logout agora aguardam
  hidratação; liberar os assets habilita os controles e a primeira ação funciona.

- Comando de workspace: o gate nativo encontrou clique descartado durante
  GET pendente. A regressão com resposta retida ficou vermelha nos seis pares
  locale/engine; personal e confirmação agora ficam desabilitados durante a
  leitura. A variante cancelada também ficou vermelha pela ausência do POST; considerar
  somente o controller ativo libera o próximo comando e conserva os fences de
  geração. O teste de retorno à conta aguarda URL e título da nova rota antes
  de acionar seu link, evitando clicar no link homônimo da tela anterior.

Comandos de reprodução:

```sh
pnpm --filter @holon/db test
pnpm --filter @holon/ui test
pnpm --filter @holon/dashboard test:browser
pnpm --filter @holon/dashboard test:coverage
pnpm test:deploy:coverage
pnpm verify
```

Usar scripts reais com Docker para build do Sandbox. A matriz nativa inicia
provider controlado, D1 real, core DO/alarm e RPCs por Miniflare; as fixtures de
controle estão em test/support e não são bundles de produção. Artefatos browser,
JUnit/coverage e `performance-lab.json` são anexados pela CI por sete dias. A
primeira falha é visível, sem retries. Um resultado local não prova CI remota.

## Resultado local executado em 2026-10-09

O main `cf914e8f6762e766409c3b98b54fa46ff329f6a9` foi incorporado por merge
`fd4ffbb`, preservando os ADRs-0060/0061 e ambos os históricos. O único conflito,
na identidade gerada do compilador, foi resolvido por
`pnpm config:schema:generate` sobre o lockfile combinado. A instalação
`pnpm install --frozen-lockfile` passou a política de supply-chain; a tentativa
offline anterior não possuía toda a metadata exigida e não qualificou instalação.

| Comando/composição                   | Resultado local                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `pnpm verify`                        | aprovado: brand/schema/config, formato/lint, tipos, cobertura e build/dry-runs |
| `pnpm typecheck` dentro do gate      | 21/21 tasks; três reaproveitadas pelo Turbo                                    |
| Arquitetura / deploy                 | 14/14 e 72/72 testes; inclui filesystem, bytes e gates negativos de promoção   |
| UI / D1                              | seis testes UI e 169 testes D1; nenhum threshold alterado                      |
| Dashboard DOM / Workers              | 163 testes em 16 arquivos e 101 testes em oito arquivos                        |
| Browser proof / browser do dashboard | 60/60 e 12/12                                                                  |
| Jornadas nativas                     | 97 aprovadas, zero falhas; dois labs CDP ignorados somente em Firefox/WebKit   |
| Core integrado                       | 417 testes em 51 arquivos; cobertura aprovada                                  |
| `pnpm build` dentro do gate          | 17/17 tasks; Docker/Sandbox e dry-run, sem publicação                          |

A fase de cobertura completou 32/32 tasks em 7m28s, com 14 resultados
reaproveitados pelo Turbo. A matriz browser usa cache bypass e retries=0. Esses
números descrevem esta execução local e não afirmam resultado de CI remota.
As capturas de conta/lista/detalhe e 320px/zoom200 foram inspecionadas em
Chromium/WebKit; as asserções de reflow, teclado, foco e axe abrangem os três
engines. As fontes originais privadas do produto foram substituídas por fixtures
sintéticas nestas provas.

Os oito dry-runs adicionais passaram: dashboard, email-delivery, control-plane
e repository-executor em preview e produção. O dashboard foi construído com
`CLOUDFLARE_ENV=preview|production`; os demais usaram `wrangler deploy --dry-run`
e o `--env` correspondente, com default para core/executor produtivos. Os
outputs foram separados em diretórios temporários. A configuração compilada
preview conservou seus próprios serviços, auth off, ingress off e hold fechado.
Nenhum recurso remoto foi criado, banco migrado ou email enviado. Dockerfile
continua reconstruível: isso verifica build, não imagem imutável publicada nem
prontidão de promoção. O build local final é reconstruído em checkout limpo
antes de congelar o artefato por SHA; seu recibo/manifest é prova anexada ao PR,
não um SHA autorreferente dentro deste documento.

## Protocolo de desempenho

O lab usa Chromium 153.0.8010.12, macOS ARM64/Apple M4, CDP CPU4x, loopback sem
throttling de rede/região, cinco contextos frios e cinco navegações quentes por
rota/perfil. O perfil estreito é viewport móvel, **não aparelho físico**. Mede
welcome/account/list/detail200, bytes efetivamente solicitados, fontes, load+
heading/fonts, TTFB e DOM. Filtro/refresh aguardam resposta real e estado visível.
SDK oficial `web-vitals` 6.2.3 é dev-only, injeta instrumentação apenas no
harness sintético e conserva somente valores numéricos, sem attribution/DOM.

Os ceilings são JS gzip 210000, CSS gzip 12000, WOFF 160000; lab SSR p95 1500ms,
filter/refresh p95 500ms, DOM1200, LCP p75 2500ms, CLS p75 0.1 e INP200ms.
Derivam do build/browser medido, com margem de CI e testes de violação
independente; o limite de JS foi mantido após trocar a implementação de Markdown
para caber nele. A amostra local de 2026-10-09T21:43:59Z mediu JS195256/CSS5553/font159732,
SSR detalhe cold p95 447ms no desktop e 486ms no viewport móvel; warm p95
319/326ms, filtro p95 95ms, refresh p95 62ms e INP sintético 16ms. Os relatórios anexados são a fonte dos números da
execução correspondente. INP do lab é de uma navegação/interações sintéticas,
não p75 de usuários. LCP/CLS de dez navegações locais também não são CWV de campo.

O workload D1 usa dois repositórios de 10000 PRs cada, mesma SQL/contrato de
produção, contains raro/sem resultado/curto e filtro combinado. O índice de
atividade é conferido por EXPLAIN. COUNT/contains podem ler todo o repo:
aproximadamente 20000 rows_read por request, mesmo com só 50 itens devolvidos;
isso é evidência do custo, não promessa de busca indexada. Repetir remotamente
com região/plano/sample size/CPU/p50/p95 antes de concluir #164/#157.

Fontes primárias verificadas em 2026-10-09:
[Marked](https://marked.js.org/using_advanced),
[Web Vitals](https://github.com/GoogleChrome/web-vitals) e
[CDP](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/).
