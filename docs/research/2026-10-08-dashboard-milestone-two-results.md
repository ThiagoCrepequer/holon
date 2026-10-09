---
id: RESEARCH-DASHBOARD-MILESTONE-TWO-RESULTS
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
related:
  - ../architecture/user-dashboard.md
  - ../engineering/dashboard-identity-and-workspaces.md
  - ../engineering/web-security-and-data-boundaries.md
  - ../operations/dashboard-environments-and-recovery.md
---

# Milestone 2: identidade e workspaces

## Escopo e estado da revisão

Quais critérios de Dashboard 2 estão implementados e que evidência permite
encerrar #141, #143 e #144 após revisão e integração do PR?

A base é `b360283` de main, após o PR #176. Em 2026-10-08, a consulta ao GitHub
confirmou #139/#140/#142 encerradas e #141/#143/#144 abertas. O trabalho usa
um worktree separado, com Antigravity como agente primário de código e revisão
independente dos limites HTTP, D1, SDK, SSR e browser. Os diretórios anteriores
e as alterações locais da outra instância foram preservados.

Sessões, preferências e governança/reauth têm provas focadas positivas e
revisões independentes de especificação e padrões sem achados materiais
remanescentes. O gate completo passou após as correções; os resultados finais estão abaixo. O onboarding completo #159, convites, conexões
GitHub, grants e reviews privados permanecem nas entregas donas. Os controles
mínimos de login/reconexão, dispositivos e preferências pertencem a M2.

## Fronteiras e critérios

| Issue | Garantia                                                     | Oráculo e fronteira                                           |
| ----- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| #141  | Emissão e renovação de 7 dias/24 h com relógio injetável     | SDK público em Workerd, timestamps persistidos no D1          |
| #141  | Revogação própria/atual/global, isolamento e DTO sem segredo | HTTP composto com auth real local e SELECT final independente |
| #141  | Expiração concorrente não apaga renovação nem recria sessão  | Intercalação no write D1, relógio injetável e Date nativo     |
| #141  | Próxima leitura nega sessão perdida e fecha contexto antigo  | API/SSR e Chromium, Firefox, WebKit                           |
| #143  | Papéis locais e promoção só de participante existente        | Comando público, D1 e leitura final                           |
| #143  | Último owner sobrevive a remoção/rebaixamento concorrentes   | D1 real, duas operações simultâneas e SELECT independente     |
| #143  | Novo OAuth prova subject original, User, sessão e intenção   | SDK real, provider controlado e intenção persistida           |
| #143  | Guarda atual, prova/efeito atômicos e replay sem restauração | Falhas/corridas controladas e persistência independente       |
| #144  | Preferência própria com locale/IANA validados e CSRF         | Contracts, HTTP e UPSERT guardado no D1                       |
| #144  | Preferência prevalece e UTC inicial hidrata sem divergência  | Documento SSR e browser real                                  |
| #144  | Persistência entre dispositivos e confirmação/retry seguros  | Segundo OAuth nativo, perfil persistido e UI bilíngue         |

## Primeiras execuções e correções de sessões

A primeira fixture de dispositivos chamou um método inexistente de CookieJar;
isso foi erro de teste, não RED comportamental. Depois da correção, os cinco
cenários falharam por capacidades ausentes: listagem/revogação própria/global
e renovação pelo relógio injetado. O teste passou após a implementação.

A revisão `session-renewal-review.test.ts` mostrou dois RED causais: uma
renovação antiga encurtava uma nova e a expiração de snapshot antigo apagava
uma sessão renovada antes da escrita. SQL condicional e releitura da row
corrigiram as disputas. Outro RED fixou o clock em 2030: a emissão nativa
ignorava esse clock. O database hook público de criação passou a usar o mesmo
relógio da política, sem alterar Date global nem os prazos nativos do OAuth.

O sétimo cenário usa o relógio real: o SDK nativo apagava uma row renovada
entre leitura e limpeza de expiração, antes do after hook. O SELECT final
retornava null. A opção pública `deferSessionRefresh` evita a limpeza nativa
em GET; o hook usa o snapshot nativo, DELETE condicionado, releitura e cookies
oficiais. Depois da correção, os sete cenários passaram, inclusive a recuperação
do DTO e do cookie de sessão. A guarda continua negando uma row realmente
vencida ou revogada; não há patch/import privado do SDK.

O oitavo cenário de renovação vence a row depois do SELECT e antes do UPDATE:
a implementação anterior a reanimava. A escrita DB exige expiração vigente
pelos relógios da request e SQLite, além de não encurtar uma expiração mais
nova. Os oito casos passaram após essa correção. A suite dedicada de
persistência de sessões acrescenta validação de sessão corrente, classificação
de dispositivo sem UA/IP no DTO e clock da request atrasado perante SQLite.

A revisão HTTP reproduziu revogação do ator depois da admissão e antes da
batch: a API respondia 200 e apagava o dispositivo alvo. O caso de expiração
no mesmo intervalo também falhava. A guarda captura User/Account/sessão exata
na batch e usa o relógio SQLite na escrita, além do clock injetado. Os cinco
cenários HTTP passaram sem trocar a sessão revogada por outra sessão válida.

```sh
pnpm --filter @holon/auth test session-devices.test.ts
pnpm --filter @holon/auth test session-renewal-review.test.ts
pnpm --filter @holon/auth test http-session-review.test.ts
```

## Preferências, SSR e browser

A entrada strict aceita locale en/pt-BR e fuso IANA/UTC. Perfil não salvo tem
ambos os valores nulos; UTC salvo não é ausência. A escrita fixa ator da sessão
na condição do UPSERT. Os oito testes D1 cobrem dois dispositivos, outro
User/subject, sessão revogada/expirada, dados inválidos/corrompidos e falha de
leitura. Um caso executa o commit real e perde a resposta depois: retorna
`command_unknown`, leitura confirma o save e retry mantém uma linha por User.

Os dois testes HTTP usam SDK nativo e D1 reais locais. Query/body forjados não
trocam o dono do perfil; CSRF/locale/fuso inválidos não escrevem. Os seis testes
do viewer verificam capabilities servidor por request, DTO público, cookies,
ausência de perfil e falha/corrupção sem fallback enganoso.

```sh
pnpm --filter @holon/db test
pnpm --filter @holon/auth test preferences-http-review.test.ts
pnpm --filter @holon/dashboard exec vitest run --config vitest.config.ts --coverage
pnpm --filter @holon/dashboard exec playwright test --config playwright.auth.config.ts
```

O conjunto Node do dashboard passou em 75 testes, com os módulos de transporte
das features incluídos na instrumentação: statements 96,10%, branches 93,63%,
funções 96,49% e linhas 96,20%. Esse resultado antecede a integração final dos
handlers de governança; não substitui o gate final.

Depois de integrar os bridges de governança, a execução intermediária de 75
testes passou, mas sua cobertura caiu abaixo do gate. Foram acrescentadas
provas de composição para os quatro comandos, init, CSRF, payload/escopo
inválidos, capability ausente e erros sanitizados, sem replicar a política D1.
Os mesmos testes de HTTP e viewer passaram também no Workerd e foram incluídos
no gate dessa fronteira. Resultado: **90 testes Node**, cobertura
95,90% statements / 93,17% branches / 96,77% funções / 95,99% linhas;
**64 testes Workerd**, 95,30% / 90,86% / 97,67% / 95,49%, respectivamente.

Os 21 cenários browser nativos passaram em Chromium, Firefox e WebKit: seis
cenários de auth anteriores e quinze de sessão/preferências. Usam HTTPS local,
bundle real, SDK OAuth e D1, com somente o provider externo controlado. Cobrem
pt-BR/en, save/SSR/UTC, segundo dispositivo por outro OAuth, persistência de UTC
explícito, falha 503/retry, expiração/reconexão e revogação própria/global.
Foco, parâmetros de rota, hidratação, CSP, page errors e axe continuam gates.

O harness fornece IP sintético válido por identidade para representar o ingress
Cloudflare; remove o header de controle antes do Worker e ignora IP enviado pelo
cliente. Isso isola budgets persistidos entre testes sem relaxar a política
produtiva. A leitura axe aguarda o modal terminar sua transição, pois a opacidade
intermediária alterava a medição. WebKit revelou refresh de sessão ao esconder
o documento durante reload; a implementação final elimina consultas automáticas.
Não foram removidas assertions de page error nem reduzidos os thresholds.

A revisão independente identificou que consultas automáticas de sessão poderiam
renovar uma aba parada indefinidamente. O teste browser instala o relógio antes
do login e garante hidratação por interação: avançar 120 s no artefato anterior
produzia duas consultas quando esperava zero. Uma tentativa inicial sem assegurar
hidratação passou falsamente e não conta como prova. A implementação final remove
timer/foco/visibilidade; autoridade é verificada na próxima leitura/intenção
explícita, sem adicionar cap absoluto. Outro RED de transporte recebia sessão B
sob a geração A sem logout intermediário. A listagem agora exige isCurrent
igual à geração renderizada; divergência fecha controles antigos e revalida SSR.
A revisão por leitura confirmou as correções; os 21 cenários browser passaram
depois do rebuild do artefato com consultas exclusivamente explícitas.

## Governança e reautenticação

A prova inicial de concorrência tinha erro de fixture por faltar updated_at;
após corrigir a fixture, os três testes falharam pelo motivo esperado: zero
owners após duas remoções, dois rebaixamentos ou disputa mista. Os triggers
aditivos da migration 0006 mantiveram um owner, com um vencedor e uma negação.
O teste antigo de replay de criação passou a preparar um segundo owner válido;
continua provando que remover o ator e repetir criação não restaura participação.

A revisão de admissão mostrou dois RED causais: criar intenção persistia após
revogação da sessão ou perda de ownership entre preflight e INSERT. A guarda
precisa existir no write. Os testes de reauth pública começaram em RED por
init inexistente (404); o resultado positivo exige callback nativo, same subject,
proofSession exata e negação de outro subject com mesmo email verificado antes
do linking. Uma intenção pendente ou renovação comum não basta.

A revisão pública do callback expôs mais três RED: anônimo e outro User
iniciavam OAuth com intenção alheia; revogar a sessão original durante OAuth
mantinha redirect de sucesso apesar de confirmação negada. Os testes exigem
admissão da sessão original antes de iniciar e erro sanitizado ao confirmar
sem autoridade. Os caminhos nativos de promoção, rebaixamento, remoção e saída
já passaram com novo OAuth por comando. Após remoção pública, leitura de
workspace/membership retorna ausência e nova intenção do ex-participante é
negada; sair preserva o outro owner. Após a correção, os oito cenários nativos
de `reauth-boundary-review.test.ts` passaram. O oitavo intercala revogação
exatamente no UPDATE de confirmação, depois do provider e emissão nativa:
nega o redirect de sucesso, limpa cookie e remove a sessão nova sem conceder
prova ou alterar membership.

A revisão final reproduziu mais dois RED de recuperação: confirmação com
storage indisponível antes do commit e resposta perdida depois de commit real
deixavam a nova Session no D1 apesar de callback falho. A limpeza ocorria só
para retorno false. Os testes preservam a sessão original, exigem remoção da
nova sessão e mantêm o estado real da intenção (confirmada ou pendente), sem
converter confirmação desconhecida em sucesso. A correção trata retorno negado e exceção na mesma fronteira: limpa cookies
oficiais, tenta excluir a sessão recém-emitida e retorna erro estático. Os
testes passaram com a sessão original ainda válida, consultada pelos headers
originais preservados, e com a jar do callback anônima. Quando o commit da
confirmação ocorreu, a intenção permanece confirmada e não consumida; sem a
proofSession válida, ela não concede autoridade. Falha adicional do próprio
DELETE é tratada sem expor a exceção, mas não comprova remoção durável; o
callback continua sem sucesso e sem cookie de sessão.

No D1, as revisões de escrita revalidam proofSession, papel do ator, existência
do alvo e expiração na batch; confirmação nega sessão inexistente, de outro
User ou a original. Commit real com resposta perdida retorna resultado
desconhecido, e replay após remoção não restaura participação. Dois RED
adicionais cobrem falha simultânea da leitura de reconciliação e pending TTL
vencido no SQLite com relógio da request atrasado. Esses cenários não podem ser
substituídos por erro bruto ou por uma confirmação apenas em memória. Após as
correções, os treze cenários de admissão passaram. A suite D1 de 56 testes
passou, mas sua cobertura intermediária ficou abaixo dos thresholds; essa
execução não conta como gate completo nem dispensa provas pelos comandos
públicos de saída/remoção/rebaixamento concorrentes.

A prova pública final adiciona cinco corridas com intenções confirmadas antes
da disputa: saída/saída, rebaixamento/rebaixamento, remoção/remoção,
saída/rebaixamento e remoção/saída. Os métodos públicos do adapter são chamados
concorrentemente; SELECT independente confirma um owner, um vencedor, consumo
somente da prova vencedora e ausência de resíduos de guarda. Os cinco casos
passaram. Os triggers também mantêm as três provas diretas do invariante.

Os doze cenários nativos de OAuth passaram. Os dois últimos demonstram que
ser owner de outra equipe não autoriza um participante ou estranho local e que
uma prova não pode mudar para outro alvo existente: a negação não consome a
prova, que continua utilizável exclusivamente para o alvo original.

O SQL novo de sessão e reauth está no adapter DB, conforme a ADR-0054; hooks
públicos no auth coordenam a política e os cookies. Não houve patch do SDK,
fallback de identidade nem alteração de ADR aceito. As revisões finais de
Standards e Spec foram somente leitura e retornaram PASS, após as correções.

## Gate final

A primeira execução encontrou seleção incorreta da suite browser pública:
`milestone-two.spec.ts` também rodava sem o harness OAuth, apesar de pertencer
à configuração auth dedicada. A seleção foi corrigida e conferida: 12 casos
públicos e 21 autenticados, sem remover testes do gate. Também houve build de
produção iniciado sobre os mesmos artefatos usados pela execução; os resultados
browser dessa tentativa não qualificam a entrega. A repetição usa builds
sequenciais, mantendo CSP, assets, acessibilidade e page errors como gates.

A repetição sequencial isolou seis RED reais nos cenários públicos: depois de
trocar idioma/tema, o browser reportava `script-src`, URI bloqueada `eval`, no
bundle da rota. O diagnóstico do evento CSP foi acrescentado ao teste existente,
sem remover a assertion. A causa era a sondagem JIT do Zod 4.5.4 ao construir
objetos, agora importados no browser pelos contratos das novas features. O modo
público `z.config({ jitless: true })`, configurado antes dos schemas dashboard,
evita a sondagem sem reduzir validação nem liberar `unsafe-eval`. A preferência
importa esse módulo antes de construir seus próprios schemas. O ajuste é de
configuração do runtime Zod compartilhado; não há patch de dependência.

A regressão focada Chromium passou após rebuild, sem violação CSP. O gate
completo `pnpm verify` passou com Node 24.11.0 e pnpm 11.24.0, usando Docker
local para a imagem do Sandbox e Workerd/D1 locais. Foram 21 tarefas de
typecheck, 32 tarefas de cobertura e 17 tarefas de build concluídas; inclui
brand/config, formatação, lint, 14 testes de arquitetura, os testes de deploy,
thresholds originais e dry-runs. O control-plane preservou seus 347 testes.

| Fronteira final   | Testes | Statements | Branches | Funções | Linhas |
| ----------------- | ------ | ---------- | -------- | ------- | ------ |
| Auth Workerd/D1   | 75     | 95,48%     | 87,90%   | 100%    | 95,41% |
| DB Workerd/D1     | 105    | 94,76%     | 87,29%   | 100%    | 95,47% |
| Dashboard Node    | 90     | 95,90%     | 93,17%   | 96,77%  | 95,99% |
| Dashboard Workerd | 64     | 95,30%     | 90,86%   | 97,67%  | 95,49% |

O browser final passou em **33 cenários dashboard**: 12 públicos e 21
autenticados, distribuídos entre Chromium, Firefox e WebKit, incluindo CSP,
hidratação, foco, acessibilidade, preferências entre dispositivos, expiração,
revogação e ausência de consultas automáticas. O workspace independente de
prova browser também manteve seus 60 casos aprovados. Resultados reutilizados
pelo cache Turbo permanecem identificados na saída do gate; cache não foi
tratado como nova execução de cada teste.

```sh
pnpm verify
CLOUDFLARE_ENV=production pnpm --filter @holon/dashboard build
```

O build/dry-run separado de produção também passou. O artefato gerado declara
`AUTH_ENABLED=true`, ambiente production e bindings identity/projection
configurados. A saída termina em `--dry-run: exiting now`; não houve upload
de Worker nem aplicação de migrations remotas.

## Limites operacionais

O trabalho não aplica migrations em produção, cria recursos, altera secrets ou
publica Workers. As migrations novas de identidade são 0006 (governança/reauth)
e 0007 (perfil), aditivas às cinco já aplicadas no bootstrap. Merge não faz
deploy; aplicar migrations e publicar o artefato exige operação autorizada no
[runbook](../operations/dashboard-environments-and-recovery.md).

SDK/provider controlado e D1 local não comprovam credenciais da GitHub App,
OAuth remoto, latência de produção ou smoke MVP #167. CI remota, quando houver,
será reportada por seu próprio resultado; sucesso local não a substitui.

## Fontes conferidas em 2026-10-08

O SDK instalado Better Auth 1.7.7 foi inspecionado em conjunto com fontes
primárias atuais. A versão fixada e as provas executáveis prevalecem sobre um
exemplo publicado para outra versão.

- [Zod e CSP: modo jitless](https://zod.dev/compile#content-security-policy).
- [React Router: nonce para render e scripts](https://reactrouter.com/how-to/security).
- [OAuth e contexto confiável de servidor](https://better-auth.com/docs/concepts/oauth#passing-server-trusted-data).
- [Hooks e contexto de sessão](https://better-auth.com/docs/concepts/hooks).
- [Sessão e deferSessionRefresh](https://better-auth.com/docs/concepts/session-management).
- [Database hooks](https://better-auth.com/docs/concepts/database#database-hooks).
- [Batch transacional D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

`additionalData` do cliente não é autoridade. Subject real do provider, contexto
reservado do servidor, sessão emitida e guarda SQL têm provas distintas; linking
por mesmo email verificado não confirma reauth da conta original.

## Revisão adicional do PR #177 em 2026-10-08

A revisão integral partiu do head `cc7889f` sobre a base `b360283`. Os resultados
anteriores deste documento são evidência daquela implementação, não uma
garantia de ausência de defeitos. A revisão adicional de especificação e padrões
encontrou oito problemas e acrescentou correções locais e regressões:

| Problema encontrado                                                                           | Correção e evidência                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Uma request concorrente com snapshot antigo renovava novamente antes de 24 h                  | UPDATE condicional aplica a cadência à row atual; teste nativo intercala a primeira renovação e verifica o próximo limite de 24 h                                                                |
| Revogação ou desconexão entre admissão HTTP e SELECT ainda permitia ler dispositivos          | Uma única consulta revalida sessão exata, conta GitHub, expiração da request e SQLite junto da página; dois testes HTTP nativos reproduzem a corrida                                             |
| Intenções de reauth expiradas permaneciam indefinidamente                                     | Init admitido remove até 100 expiradas por comando; migration aditiva 0008 indexa expiração; teste com 120 expiradas preserva intenção e prova vivas e confirma sua utilização                   |
| SSR consultava sessão e preferências fora dos budgets HTTP                                    | Viewer consome os mesmos buckets antes das respectivas leituras; testes verificam 429 sem leitura e chaves compartilhadas                                                                        |
| Falha de preferências no SSR descartava cookies já renovados e perdia a classificação do erro | Response sanitizada conserva cookies e status 403/429/503; teste com React Router confirma headers do loader e erro sem detalhes privados                                                        |
| Logout nativo podia terminar com cookie de renovação depois do cookie de limpeza              | Cookies de limpeza ficam por último; teste OAuth/D1 com sessão envelhecida confirma jar anônima e ausência da row                                                                                |
| Cliente confirmava revogação com qualquer resposta 2xx                                        | Contracts strict validam respostas por comando; HTML, JSON inválido e campos extras não confirmam sucesso; resultado idempotente continua válido                                                 |
| Listagem de dispositivos fazia SELECT, resposta e render sem limite                           | Cursor próprio, ordem estável e lotes de 100 em DB, auth, HTTP, contracts e UI; migration aditiva 0009 indexa paginação; teste D1 percorre 210 sessões e browser verifica substituição da página |

As regressões comportamentais focadas foram observadas em RED antes das
correções e passaram depois. A paginação verifica a geração pela sessão atual
no envelope, inclusive quando esse dispositivo está em outra página. Cursor
expirado, revogado ou de outro User não permite continuar a leitura; refresh
retoma a primeira página. A retenção é oportunística no próximo init admitido,
sem scheduler novo. As migrations 0001–0007 não foram reescritas.

Foram atualizados os contratos e implementações em `packages/auth`,
`packages/db`, `packages/contracts` e `apps/dashboard`, seus testes e os guias
de arquitetura, engenharia e operação correspondentes. Nenhum recurso remoto,
secret, migration remota ou deploy foi alterado nesta revisão.

O novo `pnpm verify` passou com Node 24.11.0 e pnpm 11.24.0: 21 tarefas de
typecheck, 32 de cobertura e 17 de build. Preservou os thresholds, os 14 testes
de arquitetura e os 347 testes do control-plane. Houve reutilização de cache
Turbo em 4, 15 e 13 tarefas dessas fases, respectivamente; a evidência não
representa reexecução de todas as tarefas previamente cacheadas.

| Fronteira após a revisão | Testes | Statements | Branches | Funções | Linhas |
| ------------------------ | ------ | ---------- | -------- | ------- | ------ |
| Auth Workerd/D1          | 79     | 95,48%     | 87,90%   | 100%    | 95,41% |
| DB Workerd/D1            | 108    | 94,65%     | 87,22%   | 100%    | 95,33% |
| Dashboard Node           | 112    | 96,10%     | 93,24%   | 96,72%  | 96,38% |
| Dashboard Workerd        | 74     | 95,77%     | 91,55%   | 97,67%  | 95,95% |

O dashboard passou em 36 cenários browser, sendo 12 públicos e 24 autenticados
em Chromium, Firefox e WebKit. A prova browser independente manteve 60 casos.
O novo cenário de paginação controla somente a resposta de dispositivos após
login nativo para provar render e transporte; a paginação e a autoridade no
SELECT real são provadas separadamente em D1/HTTP. OAuth usa provider
controlado; a execução local não comprova OAuth remoto nem produção.

Comandos desta revisão incluem `pnpm install --frozen-lockfile`, regressões
focadas de auth/DB/dashboard, `pnpm test:architecture`, extração/verificação
i18n, formatação e `pnpm verify`. O gate usou Workerd/D1, browsers e Docker
locais e terminou os builds Workers com dry-run. A validação foi concluída
localmente em `codex/review-pr-177`, antes do commit e do envio autorizado pelo
usuário à mesma branch do PR, `codex/dashboard-milestone-two-completion`.
A CI do head original não valida este novo diff. O build de produção separado
relatado acima pertence à entrega original e não foi repetido nesta revisão.
