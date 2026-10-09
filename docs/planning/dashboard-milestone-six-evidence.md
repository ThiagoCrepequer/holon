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
duas versões estáveis reais e aparelhos físicos. A operação abaixo comprovou
SQL D1 remoto, publicação, rollback e transporte de email; #164/#157 ainda exigem
CPU do Worker, lag real e CWV de campo; #166/#167 conservam os gates de
recuperação coordenada, alertas e OAuth/GitHub. O PR
deve permanecer draft até esses gates; seu merge sozinho não fecha #127 nem
autoriza operação. SSE #168 continua fora deste escopo.

Em 2026-10-09, o responsável autorizou ajuste da #165, deploys e testes em
produção, dispensando preview separado. O escopo operacional passa a usar os
Workers produtivos existentes com contas/repositórios de teste e destinatários
autorizados. A autorização não é evidência de execução nem encerra outras issues.

Base de implementação: PR #184 aceito, merge
`929ed5b8eaed671f7c6d5da3e8cdb1a117ba5ce0`. Os comandos abaixo são locais, com
Node 24.11.0 / pnpm 11.24.0 e dependências fixadas. As provas locais não usam
usuários, conteúdo de repositórios ou destinatários produtivos. A seção de
operação distingue as amostras executadas na conta Cloudflare real.

## Matriz de requisitos

| Issue | Implementação/prova local                                                                                                                                                                                   | Condição restante para encerramento                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| #159  | `/account`, onboarding/workspaces/repositórios, membros/owners, governança OAuth, convites, sessões e preferências bilíngues; mesma intenção após resposta perdida; último owner; retorno/reauth no detalhe | Critérios locais cobertos pelo gate completo; encerrável                                                            |
| #160  | lista/status/search/order=activity na URL; cursor scoped, reset de filtro/refresh, back/forward, uma leitura por intenção, Query disabled; 50 por página e dois repos de 10k no D1 local                    | Critérios locais cobertos; benchmark remoto pertence à #164/#157                                                    |
| #161  | rota de detalhe/painel comum, Markdown restrito, severidade/estado/evidência/sugestão, dez achados por payload/DOM; 200 achados, source original, Escape/foco/scroll, URL profunda                          | Critérios locais cobertos; matriz física/integração real pertence à #163/#167                                       |
| #162  | Dialog/painel usam CSS/tokens compartilhados; reduced motion instantâneo/live, close/reopen sem timer de foco nem evento close antigo                                                                       | Critérios locais cobertos; matriz física pertence à #163                                                            |
| #163  | matriz pt-BR/en × Chromium/Firefox/WebKit, keyboard, axe WCAG 2.2 AA, 320px/zoom200, CSP/HTML/tracking, retorno/expiry/reauth; retries=0, provas CI sete dias                                               | Últimas duas versões estáveis reais, Safari real e dispositivo físico; emulação não encerra issue                   |
| #164  | budgets e browser local; adapter real no D1 produtivo com 20k linhas, região/colo, SQL p50/p95 e rows_read; paginação e recuperação de escopo remotas                                                       | CPU do Worker, lag de publicação real e CWV de campo; latência REST não mede essas grandezas                        |
| #165  | manifests/grafo/gates; inventário produtivo, artefato congelado, quatro Workers publicados, Sandbox por digest existente, migrations e rollback real da mesma versão                                        | Conferir CI e manter escopo/autorização dos testes; integração OAuth pertence à #167                                |
| #166  | hold/DO/alarm locais; Time Travel real dos dois D1 vazios; recuperação scoped da projeção; cinco alertas ativos, responsável/canal confirmados, envio do alerta DLQ e recuperação do sinal 1→0              | PITR coordenado com ledgers/obrigações externas, demais cenários de outage e qualificação dos alertas               |
| #167  | artefato produtivo publicado; OAuth humano; cron/Queue/RPC/provider reais, recebimento bilíngue confirmado, duplicatas/DLQ sem novo envio; aceite humano e membership única no D1                           | GitHub privado/org/revoke, criação de convite pela UI, replay após remoção de membership e demais gates de promoção |
| #127  | experiência/core/admissão/efeitos integrados no código; evidência das issues específicas                                                                                                                    | Todos os gates operacionais acima; tracker não pode fechar por código local                                         |

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

## Qualificação em produção executada em 2026-10-09

O operador autorizou o uso dos recursos produtivos existentes, do destinatário
de teste e da conta GitHub sob seu controle. A #165 foi alterada no GitHub para
**DASH-38 · Validar produção, CI e publicação por artefato**. Não foi criado
preview nem Worker duplicado. Os receipts locais da operação conservam UUIDs de
fixtures e resultados técnicos; links de convite, endereços pessoais, tokens e
conteúdo privado não entram nesta evidência versionada.

Artefato produtivo congelado de
`b7dd6b43ba0118b1989f3b44b7d4700412170258`: 71 arquivos, manifest SHA-256
`45ca301006a5b2982b636db09e1ecf3618eed6221e66a59ed9b22e05de9430e4`.
Os quatro builds produtivos passaram antes do congelamento em checkout limpo;
uploads usaram os módulos compilados com `--no-bundle`. Os mapas e bundles do
harness não foram publicados. `pnpm verify` passou; depois do alinhamento dos
manifests, `pnpm test:deploy:coverage` passou 73 testes, com cobertura de linhas
99,29%, branches 94,48% e funções 94,81%, além de formato, lint focado, tipos do
executor e builds produtivos. Esses comandos não representam CI remota.

### Versões da primeira implantação e superfície

Inventário da primeira implantação. A atualização posterior do dashboard para
configurar a App está registrada abaixo; os outros três Workers conservam as
versões desta tabela.

| Worker                      | Versão com 100% de tráfego             | Publicação/reativação UTC |
| --------------------------- | -------------------------------------- | ------------------------- |
| `holon-dashboard`           | `cb0c869e-8937-40e5-9a4f-f4eb0b4be858` | `2026-10-09T22:45:17Z`    |
| `holon-email-delivery`      | `c20b50e2-1681-4037-9f80-82e44a11d715` | `2026-10-09T22:36:03Z`    |
| `holon-control-plane`       | `0837989c-47f8-405b-8451-828d7fc3b5b5` | `2026-10-09T22:44:45Z`    |
| `holon-repository-executor` | `cd975578-ca99-447e-8c41-9f2e9b66501e` | `2026-10-09T22:49:48Z`    |

A API de deployments confirmou essas versões e as annotations do SHA. Os
bindings foram lidos da **versão efetivamente implantada**: `/settings` pode
refletir o upload mais recente, inclusive uma versão de manutenção que já não
recebe tráfego. Os D1, entrypoints RPC e nomes de secrets existentes foram
preservados, sem recuperar valores nem rotacionar credenciais. Dashboard/core
mantêm workers.dev; email/executor estão privados; previews estão desligados
nos quatro. Os URLs do executor/core foram alinhados ao manifest antes do deploy.

A imagem existente do Sandbox foi fixada no manifest por
`sha256:e2fed19a256a14d9b60f3c2d061a87584019fd0e18b0f3a8a8834a8eeed621a1`.
O application permaneceu na versão 91, com o mesmo namespace e limite de dez
instâncias: o Wrangler confirmou ausência de mudanças, sem build/push/rollout
de imagem nova. A primeira publicação do executor ativou o Worker, mas falhou
depois ao consultar o Keychain na etapa Containers. A repetição do upload
congelado com diretório temporário de configuração do CLI e token da conta
correta concluiu o deploy, sem alterar o Keychain ou credenciais armazenadas.

A fila de revisões foi pausada durante a troca de core/executor. O inventário
paginado encontrou zero Workflows não terminais: review 6 complete/6 errored,
shards 328 complete/89 errored, clarification vazio. A ausência de cleanup e
supersession nos ledgers foi uma **premissa explícita do operador**, que orientou
considerar inexistentes tarefas pendentes; não foi medida por uma consulta
global aos ledgers. Estados terminais de Workflow não demonstram essa ausência.
A fila original foi retomada após a conferência dos deploys; a API confirmou
`delivery_paused=false` em `2026-10-09T22:54:06Z`, sem purge ou reset de estado.

### Schema, rollback e recuperação limitada

Identity recebeu `0006`–`0012`, preservando `0001`–`0005`; projection recebeu
`0002`, preservando `0001`. Receipts finais 12/2 e `foreign_key_check` vazio nos
dois bancos. A importação oficial SQL foi usada para conservar os triggers:
o primeiro comando Wrangler falhou com `incomplete input` antes de registrar
`0006`; seu estado foi conferido antes da importação. Nenhuma migration aplicada
foi editada, nenhum banco foi resetado.

Antes de criar fixtures de email ou permitir login, os dois D1 não continham
dados de aplicação. Com o dashboard em manutenção, foram registrados bookmarks
posteriores às migrations, inseridos marcadores próprios e executado Time
Travel real para esses bookmarks. Os dois restores conservaram hash de schema,
receipts, contagens e integridade; removeram somente os marcadores posteriores.
A barreira independente continuou respondendo 503. **Esses bookmarks não podem
ser reutilizados agora:** há efeitos de email e identidade posteriores ao ensaio.
O drill não demonstra restore coordenado de core/DO nem reconciliação de efeitos
externos, leases e alarms pendentes.

### Alertas remotos e CI após configuração do remetente

O operador confirmou responsável nominal e canal de incidentes no registro
restrito da operação. O token inicialmente não permitia escrita em Notifications
(HTTP 403); após sua atualização pelo responsável, a API aceitou o cadastro.
O limite real da conta foi cinco políticas `custom_analytics` (erro 17204 na
sexta), por isso sete sinais foram agrupados em cinco políticas. Todas foram
salvas desabilitadas, conferidas por leitura da configuração exata e ativadas
em `2026-10-09T23:15Z`. Filtros incluem somente conta/Worker/eventos fixos e
códigos; a consulta retorna um agregado numérico `value`.

As políticas cobrem DLQ, email unknown/overdue, retry de projeção com attempt

> =6, saúde da projeção/alarm e falha de leitura privada/autoridade GitHub.
> Janela e avaliação são de dez minutos, repetição de uma hora. O SQL API exigiu
> comparações JSON diretas e janela explícita no cadastro; `IN` sobre atributo
> JSON e uma expressão excessivamente aninhada foram recusados antes do cadastro.
> As cinco consultas finais foram validadas remotamente. O catálogo declara
> amostragem adaptativa; ausência de amostra não comprova ausência de incidente.

Às `2026-10-09T23:16:10Z`, uma duplicata de job sintético já completed foi enviada
à DLQ original. Às `23:17:36Z`, o sinal era 1, os cinco alertas continuavam ativos
e o job conservava uma tentativa/um accepted. Notifications registrou envio por
email da política DLQ em `23:25:41Z`. A API retorna o UUID do histórico com
hífens, diferente do ID da política; a correlação normalizou essa representação.
Às `23:26:28Z`, a consulta da janela retornou 0 e o job permaneceu completed,
com uma tentativa/um accepted. Isso comprova disparo do alerta e recuperação do
sinal, sem reenvio do convite. Nessa observação havia um único registro de envio,
sem mensagem de recuperação. O operador confirmou recebimento do alerta por
email. A observação posterior encontrou envio de resolução em `23:35:42Z`,
correlacionado à mesma política, com `state_event=ALERT_STATE_EVENT_END`; o envio
inicial tem `ALERT_STATE_EVENT_START`. Assim, a política DLQ tem prova de disparo,
recebimento do alerta inicial, recuperação do sinal e envio da resolução. Não
inferir chegada da resolução à caixa de entrada somente pelo receipt de envio.
Outros cenários de outage, as demais políticas
e o PITR coordenado continuam pendentes.

A CI de `03676fd` falhou ao conferir os tipos gerados de email-delivery após
habilitar o remetente produtivo. A mesma falha foi reproduzida localmente;
`wrangler types` regenerou somente os literais da configuração e seu hash.
Depois da correção, `pnpm verify` completo passou: 21 tasks de tipos, 32 de
cobertura (29 reaproveitadas), 17 de build (16 reaproveitadas), 73 testes de deploy
e 97 jornadas nativas sem falhas. A primeira tentativa dessa repetição dentro
do sandbox não iniciou o servidor loopback; a execução autorizada com Workerd,
Playwright e Docker concluiu o gate. Isso não é resultado da nova CI remota.
Os tipos gerados não alteram o JavaScript do artefato produtivo congelado.

A revisão real do Holon para `03676fd` terminou partial/neutral, com zero achados
novos verificados e limites de inventário/contratos. Uma observação anterior de
baixa severidade sobre `DashboardViewer` foi conferida manualmente: todos os
consumidores usam o módulo atual, somente via import type; o loader continua
executando autoridade no servidor. O typecheck e o build/browser verificaram
essa composição. Isso não transforma a revisão parcial em aprovação integral.

O rollback de Worker selecionou a versão de manutenção
`8ce890c0-9b48-46ad-87e3-88c2414a05d3`, do mesmo bundle, e confirmou HTTP 503.
A reativação selecionou a versão exata `cb0c869e-8937-40e5-9a4f-f4eb0b4be858`
sem rebuild/upload; o dashboard voltou a HTTP 200. A prova de bindings usou cada
versão selecionada, sem confundir `/settings` com o tráfego ativo.

### Transporte e recebimento de email

Domínio e DNS de Email Sending foram conferidos, e o sender produtivo foi
habilitado com allowlist. Conforme exceção explícita do operador, `Email content
preview` permanece habilitado; desativação posterior ainda não executada.

Quatro convites/intents sintéticos foram inseridos para exercitar o transporte;
o owner sintético não tinha conta OAuth nem sessão. Cron → wake/RPC → Queue →
claim/start → provider → receipt funcionou: pt-BR e en terminaram completed,
uma tentativa e accepted cada. O operador encaminhou os dois emails recebidos,
confirmando também a chegada à caixa de entrada. Cancelado e expirado ficaram
canceled, com zero tentativas e nenhum envio.

Uma duplicata do job completed foi entregue na fila principal e na DLQ; uma
mensagem inválida foi entregue na principal. Tail confirmou dois batches com
outcome ok, sem exceções, e sinal numérico `email_dlq`. Após o consumo, os jobs
aceitos mantiveram uma tentativa/um receipt cada: não houve novo envio.
O Tail foi encerrado. Isso não prova resultado desconhecido do provider,
falha transitória real. O ensaio posterior do alerta DLQ está descrito acima. Fixtures de transporte
não substituem criação de convite pela UI, email verificado e aceite único na
jornada OAuth.

### Smoke HTTPS e benchmark remoto

Smoke anônimo confirmou `/` e `/account` 200, `/api/health` 200, sessão 200/null,
`/api/workspaces` 403, `/login` 404 conforme as rotas existentes e POST de origem
não confiável 403. CSP nonce, nosniff, no-referrer e no-store estavam presentes.
Três assets remotos tiveram bytes decodificados e SHA-256 idênticos ao artefato.
O login humano no Chrome retornou à conta com os controles autenticados de
workspace/sessões. O operador confirmou as opções de workspace na UI. O controle
nativo conseguiu ler a conta, mas falhou ao expandir o seletor e enviar teclado;
essa limitação de automação não foi tratada como defeito do produto. Isso comprova
essa entrada OAuth, não toda a matriz de instalações, organizações e revogações.

O primeiro aceite humano do convite retornou a mensagem sanitizada de falha.
Uma leitura por estados e comparações mostrou convite pending/não expirado,
email primário correspondente e nenhuma membership nova. O inventário da versão
ativa mostrou ausência de `GITHUB_APP_ID`: a composição mantém colaboração
indisponível sem esse binding, embora OAuth e workspaces M2 funcionem. O operador
confirmou que o login usa a mesma App do check real de review. Seu ID público foi
configurado no manifest do dashboard, e os tipos foram regenerados. A regressão
de pré-flight falhou inicialmente por aceitar App ID ausente; depois passou,
cobrindo ausência, valores inválidos e inteiro inseguro. Correção de configuração
e teste local não substituem repetição do aceite na versão produtiva corrigida.
O gate completo após essa correção passou: 74 testes de deploy com cobertura de
linhas 99,29%, branches 94,55% e funções 94,81%; 21 tasks de tipos (20 em cache),
32 de cobertura (30 em cache), 17 de build (16 em cache) e 97 jornadas nativas
sem falhas, com os mesmos dois labs CDP ignorados em Firefox/WebKit. Nenhum
threshold foi alterado. Esse resultado ainda não é o da CI remota do novo HEAD.

O candidato corrigido foi congelado em checkout limpo de
`f6ac2885d02b6417e09db0c4f698032679f902ef`: 71 arquivos, manifest SHA-256
`fdd92fa52e973b7822dccab189fc07ab9aa526060fd7161c43b157b00dff68c6`.
Os 33 arquivos JavaScript do dashboard são byte-idênticos ao candidato inicial;
a configuração acrescenta o App ID. Secrets por nome, D1 e entrypoints RPC foram
conferidos no upload, antes da ativação. A versão
`027d7ee9-41af-435d-ac5f-18dfbb604ddb` recebeu 100% do tráfego em
`2026-10-09T23:42:00Z`; a API confirmou a seleção. O smoke HTTPS e os três hashes
de assets passaram novamente. A fila de reviews permanece ativa e os outros
Workers não precisaram de nova troca para essa correção de configuração.

Após a correção, o operador confirmou a mensagem de convite aceito na jornada
autenticada. Leituras do D1 em `23:43:26Z` e `23:44:17Z` encontraram estado
accepted, duas memberships no workspace (owner sintético e um destinatário),
um owner e exatamente uma membership para o accepted_by. O transporte conservou
completed, uma tentativa e um accepted do provider. A mensagem e o estado são
provas do aceite real; não demonstram criação pela UI, todos os perfis GitHub nem
replay depois de remover a membership.

Às `2026-10-09T23:45:05Z`, a limpeza removeu somente as quatro fixtures de
convite/intents/attempts, o workspace sintético e seu owner sem OAuth/sessões.
Pré-flight confirmou os quatro IDs nesse workspace, nenhuma entrega pending e
nenhuma outra membership do owner. Após a batch, workspace/owner/convites/
memberships desse escopo tinham contagem zero e foreign_key_check vazio. As
contas, sessões e workspaces reais não eram alvos das queries. Os receipts do
ensaio foram preservados no registro operacional restrito; os links de teste
não representam convites ativos após essa limpeza.

O adapter real `createProjectionPersistence` foi executado via batch REST no D1
produtivo, usando somente dois repositórios sintéticos com 10k registros cada,
dez amostras por caso, região ENAM/colo MIA. Tempos abaixo são a soma das
durações SQL retornadas pelo D1; latência REST do host foi medida separadamente.

| Caso                             | SQL p50 (ms) | SQL p95 (ms) | Máximo rows_read |
| -------------------------------- | -----------: | -----------: | ---------------: |
| Primeira página                  |       2,6417 |       4,4478 |            10054 |
| Raro tardio                      |      19,1166 |      24,6148 |            20004 |
| Sem resultado                    |      19,5129 |      23,3198 |            20004 |
| Termo comum                      |      10,4649 |      15,6624 |            10054 |
| Filtros combinados sem resultado |      16,7412 |      18,5659 |            20004 |
| Raro no segundo repositório      |      20,7289 |      25,3417 |            20002 |

Paginação keyset retornou cem itens únicos em duas páginas. Recuperação scoped
1→2 ocultou a leitura enquanto rebuilding, rejeitou write antigo e ativação
incompleta, depois ativou a geração reconciliada. As 20k fixtures e scopes foram
removidos e a ausência conferida. A amostra não mede CPU de Workerd, ACL HTTP,
lag causal de publicação real ou CWV de campo. #164/#157 conservam esses limites.

Fontes primárias operacionais verificadas em 2026-10-09:
[deployments e versões](https://developers.cloudflare.com/workers/versions-and-deployments/),
[importação D1](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/),
[batch e duração SQL D1](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/),
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/),
[Email Sending](https://developers.cloudflare.com/email-service/configuration/send-bindings/) e
[mensagens Queue](https://developers.cloudflare.com/api/resources/queues/subresources/messages/methods/push/).

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
