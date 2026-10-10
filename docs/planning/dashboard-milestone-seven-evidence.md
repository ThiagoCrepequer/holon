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

## Fontes verificadas em 2026-10-10

- [Playwright extensions](https://playwright.dev/docs/chrome-extensions) e [Chrome tabs.setZoom](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom): zoom nativo no perfil sintético Chromium.
- [Zod Mini](https://zod.dev/packages/mini): API funcional e árvore de imports na mesma versão fixada.
- [shadcn Base UI Dropdown Menu](https://github.com/shadcn-ui/ui/blob/2d3f1cd436b18ea12f24130de4df781355925b08/apps/v4/registry/bases/base/ui/dropdown-menu.tsx): composição do menu solicitado.
- [shadcn/ui](https://github.com/shadcn-ui/ui/tree/2d3f1cd436b18ea12f24130de4df781355925b08/apps/v4/registry/new-york-v4/ui): componentes efetivamente adaptados e licença MIT.
- [Turborepo inputs/outputs](https://turborepo.dev/docs/reference/configuration): inputs externos ao package e outputs do build.
- [GitHub repositories](https://docs.github.com/en/rest/apps/installations?apiVersion=2026-03-10#list-repositories-accessible-to-the-user-access-token): `full_name` no catálogo autorizado.
- [Cloudflare Workers Email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) e [attachments](https://developers.cloudflare.com/email-service/examples/email-sending/email-attachments/): PNG inline com contentId.

## Resultados finais

A preencher depois da execução do gate e da revisão do SHA entregue. Este
milestone não encerra por inferência #157/#163–#167 nem #127; suas métricas,
PITR, smokes de governança e qualificação remota permanecem nas issues donas.
