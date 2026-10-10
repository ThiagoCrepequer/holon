---
id: DASHBOARD-MILESTONE-SEVEN-EVIDENCE
kind: planning
status: current
owners:
  - core-team
last-reviewed: 2026-10-10
---

# Dashboard 7: contrato visual e evidência

Este documento acompanha #187–#194 e o PR #186. A referência fornecida pelo
usuário está preservada em [layout-reference.png](dashboard-seven-assets/layout-reference.png).
As capturas deste milestone usam identidades, equipes e repositórios sintéticos;
não representam dados produtivos nem métricas comerciais do Holon.

## Contrato visual implementado

A referência orienta estrutura e densidade: navegação lateral persistente,
workspace próximo da marca, cabeçalho de contexto, área principal espaçosa,
ações de leitura visíveis e cards agrupados por tarefa. O conteúdo corresponde
aos objetos do Holon: repositórios autorizados, conexões GitHub, equipe, convites,
atividade de reviews e achados. Nenhum KPI financeiro ou número ilustrativo foi
adicionado ao produto.

A Semente oficial acompanha a assinatura `holon`. Papel, tinta, violeta,
bordas, estados e foco vêm dos tokens semânticos existentes; Manrope é a fonte
da aplicação, Instrument Serif a abertura pública e IBM Plex Mono o código.
Os temas claro/escuro usam a mesma hierarquia. Sidebar tem 240px em desktop;
o conteúdo é fluido, com largura máxima da marca, cards em duas colunas quando
há espaço e uma coluna em mobile. Filtros de reviews passam de linha para grade
vertical. Conteúdo longo quebra no container; código original conserva scroll
local por teclado. A navegação não depende de hover ou overlay alternativo.

O único controle de gestão de workspace é o menu lateral junto à marca. A primeira
abertura lê o catálogo explicitamente; selecionar uma opção muda o contexto.
“Criar workspace” abre um Sheet lateral direito com os dados da equipe e a ação
pessoal quando ainda disponível. A criação confirmada seleciona o novo workspace;
um resultado desconhecido conserva nome e operationId inclusive ao fechar/reabrir
o Sheet. Não existe página nem botão separado para gerenciar/criar workspaces.
O cabeçalho é único (`Dashboard`); sem seleção, uma orientação curta aponta para
o controle lateral. Após seleção, nome e role contextualizam os cards acionáveis.

O botão do usuário abre Dropdown Menu com Preferências e Sair. A superfície de
sessões ativas foi retirada por solicitação explícita; APIs e garantias de
revogação atual/global permanecem, com prova HTTP autenticada e descarte da sessão
na próxima request. Fechar o menu retorna foco ao usuário; abrir preferências
transfere foco ao dialog, cujo fechamento retorna ao mesmo botão. Sheet e dialog
preservam top layer/inert nativos; Base UI é dono do teclado/seleção dos menus.
O catálogo apresenta `fullName` autorizado; convites apresentam destinatário e
estado, membros apresentam nome e role. IDs técnicos aparecem somente onde
identificam a instalação/prova de uma ação concreta. Nenhuma leitura privada
inicia por hidratação, foco, visibilidade ou reconnect do browser.

Inputs/selects compartilham label, descrição/erro e altura mínima de 44px;
texto de 16px evita zoom automático no foco em mobile. Bordas e foco usam
tokens de contraste, e estados disabled não recebem hover de botão ativo.
Select continua nativo, com chevron decorativo sem capturar ponteiro e fallback
para aparência nativa em forced colors. Preferências usam espaçamento uniforme
entre campos. Escape em um dialog aberto não dispara o retorno do detalhe.

Lista tem título, observação datada, refresh manual, filtros e atividade com
estado textual, autor e data. Detalhe preserva resumo, achados e evidências
originais em cards. Navegação mantém filtro/cursores e retorno ao link com foco
/scroll; conta mantém `returnTo` validado. Estados vazio, loading, indisponível,
negado, reconexão e resultado desconhecido têm feedback explícito. Uma negação
remove snapshots privados antes de nova ação; resposta de escopo antigo não
reabre conteúdo. O convite aceito/cancelado permanece terminal no servidor.

## Mudanças e critérios por issue

| Issue | Implementação e prova principal                                                                                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #187  | Contrato acima, referência preservada e capturas comparáveis abaixo; pt-BR/en, temas, desktop/mobile e estados relevantes.                                                                                                                         |
| #188  | Button/Input/Card/Badge/Dropdown Menu/Sheet shadcn adaptados sob MIT, `cva`, Tailwind v4 e tokens; campos compartilham label/hint/error; menus Base UI e dialog/Sheet nativos com foco/teclado/CSP. [Procedência](../../packages/ui/README.md).    |
| #189  | Shell único, navegação/workspace, ações de conta, grade de colaboração, filtros/lista/detalhe e retorno ao contexto. Sem leituras automáticas ou widgets fictícios.                                                                                |
| #190  | Adapter tipado + controlador privado com AbortSignal/geração/escopo; descarte em 401/403; intents imutáveis; recibos inválidos não confirmam efeito. Tests browser de resposta tardia, retry após commit e último owner.                           |
| #191  | Controller de interação separado de views; Query continua único dono; interfaces públicas reduzidas; filtros/paginação/refresh/retorno sem leitura extra na hidratação. Hostile HTML/código continua tratado como texto.                           |
| #192  | Skills aplicadas proporcionalmente; effects por responsabilidade, estado derivado da URL e composição explícita; runtime contracts, sem `any` novo ou tipo genérico ornamental. Cache Turbo inclui fontes/tokens externos e saída real `build/**`. |
| #193  | Semente PNG CID inline, fallback textual, tokens gerados, HTML inline/texto pt-BR/en, URL canônica e expiração. Templates preservam mesma mensagem no retry, sem pixel ou fonte remota.                                                            |
| #194  | Matriz browser, capturas, foco/Escape/reflow/reduced motion, budgets, gate completo e CI do SHA entregue, com limites reais documentados.                                                                                                          |

## Defeitos reproduzidos e fronteiras revisadas

A revisão iterativa incorporou as decisões do usuário: eliminar cabeçalhos e
ações de workspace redundantes, concentrar criação no Sheet lateral e substituir
sessões ativas por Preferências/Sair no menu do usuário. As capturas anteriores
preservam o estado do HEAD `750c108`; o contrato acima descreve a composição final.
O [índice visual](dashboard-seven-assets/README.md) reúne 32 comparações de
conta/lista/detalhe/convite e os estados, controles e zoom complementares.

| Observação anterior                                                                         | Correção e regressão observável                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconexão após 401 conservava snapshots de repositórios/membros.                            | O controlador remove snapshots antes de expor a reconexão; `reconnecting removes repository and membership snapshots before another action` testa o fluxo.                  |
| Escape do dialog de preferências propagava para o retorno do detalhe.                       | O retorno respeita o fechamento do overlay; `Escape closes preferences before leaving the private review detail` mantém rota/foco.                                          |
| Retry de convite desconhecido podia usar destinatário editado depois da primeira tentativa. | Intenção imutável por workspace conserva destinatário/locale/operationId; testes incluem commit com resposta perdida e troca de workspace, conferindo uma única outbox.     |
| Voltar/avançar alterava a URL sem sincronizar a seleção e permitia resposta antiga.         | Escopo deriva da URL; uma geração invalida transporte e snapshots. O teste ignora AbortSignal deliberadamente e verifica ausência de snapshot antigo antes de nova leitura. |
| O token de foco usado pelo app não existia; controles tinham estilos/estados duplicados.    | FieldFrame e variantes semânticas centralizam label/hint/error/foco; teste mede outline calculado claro/escuro.                                                             |
| O breadcrumb em português ultrapassava o viewport em 2px no zoom CSS 200%.                  | O cabeçalho permite quebra; regressões de 200 achados nos dois idiomas e zoom nativo passam sem overflow global.                                                            |

Colaboração deixa de expor comandos com path/body/resultado desconhecido às views:
`workspace-data.ts` esconde HTTP/parsing e `workspace-state.tsx` concentra escopo,
gerações e intenções. Remover uma view não exige recriar validação, transporte ou
regras de retry. Reviews conserva o dataset validado e Query existentes;
`review-interaction.tsx` é dono da navegação/refresh/foco, e `review-views.tsx`
compõe conteúdo. A busca de consumidores permitiu remover exports internos
ociosos de `public.ts`; o gate impede imports privados entre features. Não há
client/cache paralelo nem pacote genérico novo.

## Aplicação das skills solicitadas

Instalações solicitadas estão disponíveis no host. Foram usadas como método,
sem substituir ADR-0054 ou os limites de autorização do projeto:

- `vercel-react-best-practices`: separar effects com responsabilidades diferentes,
  manter valores derivados na renderização, não duplicar Query em state, imports
  por subpath e revisar artefato compilado. Regras Next/RSC não se aplicam.
- `vercel-composition-patterns`: shell compõe children e features; Card/Header/Title
  explicitam estrutura; interfaces de produto escondem transporte.
- `typescript-advanced-types`: unions discriminadas de resultados e tipos inferidos
  dos contratos; dados externos continuam validados em runtime. Não usar tipos
  avançados quando tipos concretos deixam a regra mais clara.
- `tailwind-design-system`: `@theme inline`, semântica de variantes/estados,
  utilities responsivas e uma fonte canônica de tokens; CSS próprio limitado a
  motion nativo e conteúdo Markdown não confiável.
- `turborepo`: `$TURBO_DEFAULT$` permanece nos inputs; tokens/fontes do monorepo
  entram no hash e o build do dashboard declara `build/**`. Sem alterar cache
  para esconder testes ou publicar artefatos de outro ambiente.
- `frontend-design` e `web-design-guidelines`: contrato específico do Holon,
  referência real, hierarchy, labels, estados observáveis, foco e reflow.
- `improve-codebase-architecture`/`codebase-design`: auditoria somente leitura e
  aprofundamento de colaboração/reviews; sem criar pacote/camada genérica.
- `vercel-react-view-transitions`: avaliada; não introduzir API experimental ou
  novo motor de motion no runtime estável. Native dialog e reduced motion bastam
  para as interações atuais. `design-taste-frontend` exclui dashboards/tabelas do
  próprio escopo; a marca e a referência fornecida prevalecem.

Proveniência solicitada: agent-skills `063bee94c3f4df8453406c830b0a7df0f2860278`,
wshobson/agents `46891e7e60da0e52baf1050b7b6391b64e84c6d9`, turborepo
`34e255684268c31ef961dacd82b783baf69c6c35`, anthropics/skills
`dbd4588f9e1033efb41dad4bef2f7947c8993d44` e taste-skill
`717446e07a78d4e6d7918b1fde1a263378eebac9`.

## Matriz de prova

`milestone-seven.spec.ts` combina pt-BR/en, claro/escuro, 1440px/320px e
conta sem leitura, Sheet de criação, menu do usuário, conta com repositório, lista e detalhe. Captura ainda
convite indisponível, lista vazia e negação. Axe inclui regras WCAG 2/2.1/2.2 AA;
assertions medem ausência de overflow no documento, foco no detalhe/retorno,
Escape e preferência de movimento reduzido. O teste de zoom via CSS em 320px é complementar. `native-zoom.spec.ts` usa
`chrome.tabs.setZoom(2)` em perfil Chromium sintético novo, sem permissões,
content scripts ou acesso à sessão humana: confirma fator 2, metade do viewport
CSS e CSS `zoom=1`, e verifica conta/lista/detalhe, temas/idiomas, teclado,
modal/foco e Axe. Não instala extensão no Chrome do usuário.

Os testes anteriores continuam cobrindo 200 achados, hostile Markdown/HTML,
scroll local de código, SSR por usuário, leitura por intenção, grant revogado,
callbacks de OAuth, sessão revogada, primeiro clique e governança do último owner.
A preparação de 65 ledgers usa lotes de até dez em eventos HTTPS separados;
a prova final exige **65 linhas e 65 estados concluídos**, sem reduzir cardinalidade,
D1 ou o protocolo real dos ledgers. A reprodução Linux com Node 24.11.0, 2 CPU e
8 GiB confirmou essas contagens e health 200 após todos os lotes.

Chromium/Firefox/WebKit do Playwright são engines automatizadas locais. Não
qualificam duas versões estáveis instaladas de Chrome/Firefox/Safari, Safari
real ou aparelhos físicos. Essa matriz permanece **pendente na issue operacional
#163**; o critério #194 permite registrar esse limite explicitamente. Axe sozinho
não certifica conformidade integral WCAG; teclado, leitura, foco e reflow têm
assertions adicionais. Não inferir Core Web Vitals ou redução de CPU a partir
somente das capturas.

As capturas arquivadas são Chromium. A implementação instalada de Playwright
1.63.0 injeta `<style>body {}</style>` sem nonce para sincronizar animações ao
capturar WebKit; a CSP estrita corretamente bloqueia esse estilo da ferramenta.
O teste mantém assertions de CSP/reflow/Axe/foco em todos os engines e captura
somente Chromium, sem liberar inline styles nem excluir violações da aplicação.

WebKit também expõe os guards internos de foco do Base UI como `role=button`
sem nome para o cursor virtual do VoiceOver. O [mantenedor do motor de foco](https://github.com/floating-ui/floating-ui/issues/2823#issuecomment-2010715019)
qualifica o alerta `aria-command-name` como falso positivo: o foco é imediatamente
redirecionado, não permanece no guard. A versão 1.9.0 instalada usa essa mesma
implementação. O teste aceita somente esse achado em WebKit após conferir **cada
node**: span vazio, data attribute exato, tabindex/role e clipping/dimensões de
1px. A regra continua ativa para qualquer controle real; outros achados falham.
Menu/Escape/retorno de foco têm provas independentes. Isso não certifica VoiceOver
físico, que continua no gate operacional #163.

## Contratos e orçamento

Os contratos que chegam ao navegador usam Zod Mini 4.5.4, a API oficial funcional
da mesma dependência fixada. Primitivas de IDs, paths, status e achados têm uma
fonte canônica compartilhada com contratos servidor, mantendo strict, limites,
trim e refinements de linhas/evidências. Não há validador informal nem esquema
mais permissivo no cliente. Essa extração evita carregar validadores de protocolos
internos não usados pela UI. A suíte de contratos e o schema público gerado
qualificam a mudança. O schema JSON de configuração permaneceu idêntico; sua
identidade causal gerada muda porque os arquivos de entrada do compilador mudam.
Tipos estáticos continuam sem substituir runtime parsing.

Em 2026-10-10 o usuário autorizou “Usar Base UI e revisar o orçamento”. O teto de
JS do build completo passa de **210.000 para 240.000 bytes gzip** na #194. Depois
da extração dos contratos a medição intermediária foi 230.998 bytes; a medição
final está abaixo. Todos os chunks/rotas entram no cálculo. CSS conserva 12.000
bytes gzip e fontes 160.000 bytes. Os tetos de SSR/interação/LCP/CLS/INP/DOM e
cobertura não mudam. A revisão de escopo comporta o componente pedido; não é uma
afirmação de redução de CPU ou de melhoria de métricas de campo.

## Email

O template usa a Semente de `holon-avatar-180.png`, incorporada como attachment
inline `image/png` com `contentId=holon-semente`. O HTML referencia `cid:`;
nenhum asset privado é publicado. A assinatura textual e alt `Holon` continuam
legíveis com imagens bloqueadas. Fontes usam Segoe UI/Arial locais do cliente;
HTML mantém tabelas, inline CSS e fallback claro quando o cliente remove a regra
de dark mode. `tooling/brand/tokens.mjs` gera cores e PNG base64; `brand:check`
impede drift dos tokens/logo. Nenhuma mudança na autoridade/outbox/Queue.

A renderização browser resolve CID para uma data URL **somente no preview**;
é uma prova de layout, não de suporte MIME no cliente de email. A matriz inclui
pt-BR/en, claro/escuro, desktop/320px, logo/imagens bloqueadas e ausência de requests
externas. Recebimento real e cliente efetivamente usado são registrados
separadamente, sem incluir endereço do destinatário, convite privado ou PII no
repositório.

### Ensaio autorizado em produção — 2026-10-10

Foi atualizado somente o Worker existente `holon-email-delivery`, ambiente
`production`, com autoridade privada `holon-dashboard#EmailDeliveryAuthority`,
remetente restrito e filas existentes. Não houve deploy do novo layout do dashboard
nesta etapa. Pré-flight e pós-flight conferiram bindings, modo de recuperação ativo,
GitHub App ID confirmado, private ingress e integridade do D1 de identidade.

- Código limpo congelado: `2137359d564d1a5ae840f697a574a50cacfc241b`.
- Bundle SHA-256: `c478ab29336ec6ef90dae6396df0e872482a02551a524ecd7667ed120fc6e36c`.
- Versão ativa a 100%: `4f4f1811-0ae0-46e5-83f8-2236210c1ab1`, publicada em
  `2026-10-10T03:51:19Z`.
- Fixture restrita: um owner sintético sem OAuth/session, um workspace vazio e
  dois convites pt-BR/en destinados somente ao participante autorizado.
- Cron → RPC → Queue → provedor → receipt: ambas as entregas `completed`, uma
  tentativa registrada e uma aceitação cada. Na leitura `2026-10-10T03:54:10Z`,
  após replay dos mesmos dois job references, contagens permaneceram em **1/1**;
  os convites continuaram pendentes. Não houve novo envio nem novo convite.

Aceitação pelo provedor não comprova entrega nem renderização no Gmail. A confirmação humana no Gmail do navegador permanece pendente. A primeira
limpeza foi revertida integralmente pela proteção do último owner: contagens
conferidas após a falha continuaram em um user/workspace/membership e dois
convites/intents/attempts. A remoção correta do workspace com cascade foi
bloqueada pela revisão automática por exigir autorização explícita adicional;
nenhum trigger foi removido e as duas fixtures permanecem restritas, pendentes e
sem OAuth, sessões ou conexões. A confirmação solicitada ao operador ainda não
foi recebida. Nenhum email, link de convite, token ou conteúdo
produtivo foi versionado. A exceção operacional autorizada para Email content
preview continua no runbook do milestone anterior; não foi desativada neste ensaio.

## Fontes verificadas em 2026-10-10

- [Playwright extensions](https://playwright.dev/docs/chrome-extensions) e [Chrome tabs.setZoom](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom): zoom nativo no perfil sintético Chromium.
- [Zod Mini](https://zod.dev/packages/mini): API funcional e árvore de imports na mesma versão fixada.
- [shadcn Base UI Dropdown Menu](https://github.com/shadcn-ui/ui/blob/2d3f1cd436b18ea12f24130de4df781355925b08/apps/v4/registry/bases/base/ui/dropdown-menu.tsx): composição do menu solicitado.
- [shadcn/ui](https://github.com/shadcn-ui/ui/tree/2d3f1cd436b18ea12f24130de4df781355925b08/apps/v4/registry/new-york-v4/ui): componentes efetivamente adaptados e licença MIT.
- [Turborepo inputs/outputs](https://turborepo.dev/docs/reference/configuration): inputs externos ao package e outputs do build.
- [GitHub repositories](https://docs.github.com/en/rest/apps/installations?apiVersion=2026-03-10#list-repositories-accessible-to-the-user-access-token): `full_name` no catálogo autorizado.
- [Cloudflare Workers Email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) e [attachments](https://developers.cloudflare.com/email-service/examples/email-sending/email-attachments/): PNG inline com contentId.

### Sincronização da seleção no harness

A [CI de `e2fa50b`](https://github.com/ThiagoCrepequer/holon/actions/runs/38060573767)
concluiu a matriz com 129 casos aprovados, dois labs CDP ignorados e duas falhas
no mesmo helper, em Chromium/WebKit. O trace mostra fechamento do menu antes
do commit da navegação: `getAttribute(data-workspace-id)` leu uma string vazia;
o snapshot posterior já mostrava a equipe escolhida. Não houve falha de provider,
retry, permissão ou contrato de convite nesse cenário.

`chooseWorkspace` agora captura o ID da opção antes do clique e espera o trigger
confirmar **exatamente esse ID**, além do fechamento do menu. É a condição
observável necessária antes de executar um comando no novo escopo. Não usa sleep,
retry da suíte, tolerância nova ou alteração do timeout. O cenário de resposta
perdida/retry passou nos três engines após essa correção, mantendo um único
convite/intent e payloads idênticos. O gate completo é repetido para os demais
consumidores do helper e a CI final continua registrada no PR/issues.

## Resultados finais

`pnpm verify` completo passou em 2026-10-10, com Node 24.11.0 e pnpm 11.24.0:
brand/config schema/config validate, formatação, lint, tipos, arquitetura, deploy,
evidência, cobertura e build/dry-runs. O gate executou as jornadas nativas do app:
**131 passaram e dois labs CDP foram ignorados nos engines sem CDP**, sem retries.
Inclui o projeto exclusivo Chromium de zoom nativo. As 12 provas browser de
fundação também passaram; as suites do dashboard tiveram 169 testes puros e 102
Workerd, e a suíte de contratos teve 178 testes. Tests de email tiveram 24 casos
Workerd; a renderização de template separada passou em 48 combinações de engine,
locale, tema, viewport e imagens. Não foram alterados os mínimos de cobertura.

Turbo reutilizou tasks locais cujos inputs não mudaram; a matriz browser e os
controles alterados foram executados. Tipos: 21/21 tasks, 20 reutilizadas; cobertura: 32/32 tasks, 30 reutilizadas; build: 17/17 tasks, 13 reutilizadas. A [CI de `beffa84`](https://github.com/ThiagoCrepequer/holon/actions/runs/38023542532)
confirmou no Linux **131 jornadas sem falhas, dois labs CDP ignorados** e zoom
nativo: JUnit `133` testes, `0` failures/errors, duração `1127,033s`. A matriz
consumiu 18,8 minutos; o job de 30 minutos foi cancelado durante as suítes
posteriores, antes do build final e da qualificação do artefato. Isso não é CI
integral aprovada. O tempo máximo do **job** passa para 45 minutos para comportar
matriz, cobertura e build frios. Timeouts/retries dos testes, tetos de interação,
bytes e mínimos de cobertura permanecem iguais. As CIs posteriores e suas correções são registradas acima e ligadas no PR/issues;
prova local não substitui a conclusão do gate remoto.

| Artefato                  | Antes `750c108` |  Depois | Teto atual | Diferença |
| ------------------------- | --------------: | ------: | ---------: | --------: |
| JavaScript completo, gzip |         195.256 | 231.131 |    240.000 |   +35.875 |
| CSS completo, gzip        |           5.553 |   7.197 |     12.000 |    +1.644 |
| Fontes locais, bytes      |         159.732 | 159.732 |    160.000 |         0 |

O [receipt numérico](dashboard-seven-assets/performance-lab.json), coletado em
`2026-10-10T04:10:46Z`, usa Chromium 153.0.8010.12, macOS ARM64/Apple M4, CPU
throttle 4x, loopback sem network shaping e cinco amostras frias/quentes por rota
nos viewports 1280px e 320px. Entre as rotas, os maiores p95 foram 680ms frio e
831ms quente (teto 1.500ms); filtros 124ms e refresh 141ms (teto 500ms). LCP p75
máximo 196ms, CLS p75 máximo 0,000804, INP 24ms e DOM máximo 789 respeitaram os
limites 2.500ms/0,1/200ms/1.200. São medidas locais; não representam CWV de campo,
latência regional ou CPU HTTP do Worker produtivo. O aumento de bytes corresponde
à composição solicitada, com a revisão explícita do orçamento de JS; não se
atribui ganho de performance ao redesenho.

O [índice visual](dashboard-seven-assets/README.md) contém 32 pares antes/depois,
65 capturas finais de jornadas/estados, 12 de zoom nativo, três previews de email
e a referência original. A revisão visual conferiu conta/lista/detalhe, menu,
Sheet mobile e assinatura/CTA do email. Todos os arquivos usam fixtures sintéticas.

A suíte completa do core também passou **sem cache** com Node 24.19.0: 51 arquivos,
417 testes, linhas 93,58%, branches 87,05%, funções 94,02% e statements 92,4%.
O congelamento do artefato local pelo SHA `e2fa50b` conferiu 71 arquivos, sem
publicar recursos. Esses resultados são distintos da CI.

As revisões de padrões e especificação foram feitas separadamente sobre o diff
do milestone; a auditoria de arquitetura orientou as seams de colaboração e
reviews. Os defeitos comportamentais acima possuem regressões e não há bloqueio
de implementação identificado. Recebimento/renderização Gmail e limpeza de
fixture possuem estado explícito na seção de email. #193/#194 só podem ser
consideradas integralmente qualificadas com a confirmação humana e CI descritas
nessas issues. Este milestone não encerra por inferência #157/#163–#167 nem #127;
suas métricas, PITR, smokes de governança e qualificação remota permanecem nas
issues donas.
