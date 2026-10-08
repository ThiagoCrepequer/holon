---
id: ENGINEERING-FRONTEND-STRUCTURE
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-07
related:
  - typescript-and-module-design.md
  - ../research/2026-10-04-dashboard-library-landscape.md
---

# Organização de aplicações web e dependências

## Alcance e direção

Como organizar o dashboard dos usuários mantendo proximidade dos arquivos,
responsabilidades claras e dependências externas concentradas em packages?

A [ADR-0054](../decisions/0054-establish-user-dashboard-foundations.md) materializa
as fundações locais de `apps/dashboard`, `apps/email-delivery`, `packages/ui` e
`packages/db`. A [arquitetura do dashboard](../architecture/user-dashboard.md)
descreve arquivos/interfaces concretos. Exemplos de review/auth/queries abaixo
continuam desenhos para M2–M6, sem pastas vazias ou comportamento simulado.
A ADR-0040 permanece vigente para o admin retirado.
O [guia TypeScript](typescript-and-module-design.md) continua valendo para
imports, tipos, módulos e contratos de todo o Holon.

## Escopo e topologia acordados

Na [rodada 1](../planning/dashboard-engineering-decision-review.md#rodada-1-decisões-acordadas-em-2026-10-04),
em 2026-10-04, o responsável confirmou:

- Primeira entrega: lista/detalhe por repositório autorizado, estados atuais
  e filtros básicos. Q12 confirmou somente leitura de reviews; feedback,
  reexecução e configuração não entram nesta fatia. Histórico está fora dela.
- Q13 confirmou repo/estado/busca número+título, atividade recente primeiro.
- Q16 confirmou pt-BR e inglês completos desde a primeira entrega. Q17/Q18
  confirmaram login GitHub e uso individual + organizações Holon; acesso/sessão
  em Q22/Q24 foram confirmados. Q25–Q30 fixaram governança, cardinalidade e
  frescor. Q31–Q34 confirmaram autoridade de vínculo, convites por email via
  Cloudflare, múltiplos owners e onboarding self-service mínimo na primeira entrega.
- `apps/dashboard` será um Worker próprio, com React Router SSR e API Hono
  no mesmo deployable, separado de `apps/control-plane`.
- Suporte browser, acessibilidade e gates seguem os
  [critérios acordados](testing-and-evidence.md#dashboard-critérios-acordados-para-implementação-futura).

SSR inicia a página e API atende interações; ambos usam os mesmos contratos
e capacidades autorizadas. Não duplicar regras de produto entre loader e
handler. A rodada 2 definiu inicialmente lista por projeção D1 e detalhe
agregado pelo core, sem histórico/backfill. Interfaces/projeção durável e
integração de autenticação precisam de desenho/prova técnica. Essa confirmação
não adiciona bindings,
workspaces ou comandos aos dois Workers de produção atuais.

## Dependências externas e packages

Concentrar bibliotecas externas em packages que ofereçam uma interface útil do
Holon. O app compõe essas capacidades e mantém somente dependências de seu
framework ou exceções justificadas. A meta é concentrar conhecimento e política,
não apenas reduzir o número de imports externos.

| Dono proposto                                | Interface para consumidores                                                                   | Implementação que concentra                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/ui`                                | Componentes, ícones, receitas de movimento, campos, tabelas e gráficos com padrões Holon      | shadcn/primitivas, Lucide, Motion e biblioteca de gráficos; acessibilidade, tokens e estados consistentes                |
| `packages/auth`                              | Identificação da sessão, handler de autenticação e integração cliente explicitamente separada | Better Auth, cookies/configuração e tradução de identidade; tenancy e entrega pertencem à aplicação, não ao adapter auth |
| `packages/db`                                | Criação da persistência e adapters de leitura/escrita por responsabilidade                    | Drizzle/D1, schema físico, queries SQL, migrations e tradução de rows; sem importar auth ou UI                           |
| `packages/contracts` existente               | Schemas e DTOs de fronteira                                                                   | Validação de requests/respostas; separar por capacidade sem duplicar shapes                                              |
| `packages/application` / `domain` existentes | Casos de uso, portas e invariantes adequados ao domínio                                       | Política do produto sem React, Better Auth, ORM ou HTTP                                                                  |
| Módulo de dados no app                       | Queries/hooks/options e transporte validado por capacidade                                    | TanStack Query, hidratação, erros, cancelamento e invalidação do dataset; package cliente não exigido                    |

`ui` e `db` têm bases locais; `auth` entra somente com a integração M2.
Os demais nomes são candidatos, não uma obrigação de criar todos no bootstrap. `ui` protege padrões reutilizáveis da marca mesmo com um primeiro
app consumidor. `auth` e `db` protegem políticas e infraestrutura identificáveis.
Não criar um pacote para cada dependência ou hook.

Não reexportar SDKs inteiros sob `@holon/*`, expor o ORM como banco universal ou
replicar todos os parâmetros da biblioteca em wrappers genéricos. Uma interface
como `ReviewReadStore.list(...)` retorna DTOs/tipos do Holon e concentra a query;
`db.select(...).from(...)` espalhado em loaders mantém acoplamento ao Drizzle.
A integração Better Auth/Drizzle pode exigir o objeto ORM entre `auth` e `db`.
Se confirmado, usar um subpath somente servidor com consumidores restritos;
concentrar esse acoplamento na integração, sem devolvê-lo aos componentes,
loaders ou casos de uso. Confirmar o contrato do adapter na prova posterior.

UI pode expor `ReactNode` porque React é core assumido; não expor tipos internos
de Motion, Lucide ou ORM sem uma necessidade explícita.

Exceções diretas: React/React DOM, React Router e o adapter HTTP Hono nos
pontos de composição. Tailwind/Vite/Wrangler pertencem ao build/runtime,
não a um wrapper de aplicação. **TanStack Query fica no app**, conforme Q9
em 2026-10-04: keys/options/hooks em módulo de dados da feature ou junto à
rota se forem exclusivos dela. Providers/cache/hidratação são compostos no
app; não criar package cliente só para deslocar esses arquivos.

Lingui é uma exceção direta do app: catálogos, negociação por request e provider
pertencem à superfície. Types/build incluem sync, missing sem fallback, compile
estrito e fixture negativa no CLI real.

TanStack Form continua condicional aos formulários reais. Table/Virtual podem
ser exceções localizadas se uma necessidade concreta não couber na interface
de UI. Outras dependências mantêm a preferência por packages com comportamento
útil. Transporte pode ser extraído posteriormente quando houver consumidor
importável real, sem levar automaticamente toda a política Query junto.

Antes de uma exceção, verificar se a necessidade pode ser acrescentada à
interface existente sem reproduzir a biblioteca. Documentar dono, imports
permitidos, tipos externos expostos e motivo. Não declarar que uma reexportação
elimina acoplamento: o consumidor ainda aprende aquele contrato.

## Organização por responsabilidade e localidade

Usar módulos por funcionalidade, rotas como adaptadores finos e composição no
app. Co-localização de arquivos privados da página é desejável. O acoplamento
é controlado pela direção dos imports e pela interface, não pela distância no
filesystem.

```text
apps/dashboard/
  app/
    root.tsx                     # layout raiz e providers compostos
    routes.ts                    # URL -> módulo de rota, configuração explícita
    composition.server.ts       # conecta capacidades/bindings, apenas servidor
    routes/
      review-detail/
        route.tsx                # exports React Router, loader fino e composição
        page.tsx                 # layout desta página
        review-header.tsx        # parte exclusiva desta página
        review-detail.context.tsx # apenas se houver estado compartilhado local
        loader.server.ts         # bootstrap autorizado, sem SQL ou SDK auth
      review-list/
        route.tsx
        page.tsx
        filters.tsx
        search-params.ts          # URL validada -> filtros normalizados
    features/
      reviews/
        public.ts                # interface pequena para outras capacidades
        review-summary.tsx       # UI de produto reutilizada em várias rotas
        data/
          review-queries.ts      # Query keys/options/hooks do app por dataset
        model/
          review-presentation.ts # transformação pura para apresentação
    shell/
      navigation.tsx             # composição de navegação do produto
    server/
      api/
        reviews.handler.ts       # Hono: parse, identidade, caso de uso, resposta
  test/                          # segue a organização efetiva do workspace
```

A árvore é ilustrativa. Não criar diretórios vazios, `context`, `model`,
`public.ts` ou um arquivo por categoria em páginas simples. Começar com poucos
arquivos nomeados pelo conteúdo e separar quando mudarem por razões distintas.
Queries/hooks/options pertencem ao app. Se só uma rota usa o dataset, podem
ficar junto dela; compartilhamento entre páginas vai à feature. Não duplicar
keys ou política de hidratação em componentes e não mover esses módulos para
packages por uma regra genérica de encapsulamento.

React Router permite mapear URLs a módulos com `routes.ts`; o nome de uma
pasta não precisa reproduzir a URL. Isso mantém a rota próxima de seus arquivos
sem prender uma feature a parâmetros, loader ou objetos do router.
[Fonte oficial](https://reactrouter.com/api/framework-conventions/routes.ts).

## Direções de import

| Origem                  | Pode consumir                                                                                           | Não deve consumir                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Rota/página             | Arquivos privados da própria rota, interfaces de features, UI, contratos e framework                    | Internals de outra rota, ORM, Better Auth ou storage concreto                 |
| Feature                 | Seus módulos privados, packages autorizados e interfaces de outra capacidade quando houver relação real | Rotas, tipos gerados de rota, composição do app ou internals de outra feature |
| Shell/root              | Interfaces de features, UI e providers declarados                                                       | Regras de negócio ou query SQL                                                |
| Handler/loader servidor | Contratos, identidade traduzida, casos de uso e capacidades injetadas                                   | DOM, hooks, regra divergente de autorização ou query ad hoc                   |
| Composição servidor     | Factories de auth/persistência, casos de uso e bindings do app                                          | Estado mutável global de usuário ou cache compartilhado entre sessões         |
| Package                 | Exports de outros packages autorizados pelo grafo                                                       | Qualquer `apps/*` ou caminhos privados de outro workspace                     |

Features não importam umas às outras por conveniência. A rota pode compor duas
features sem torná-las mutuamente dependentes. Relação real usa interface pequena
unidirecional; uma regra de produto compartilhada vai ao módulo que a define.
Não criar `shared/utils` para esconder um ciclo.

Os arquivos privados de `review-detail` pertencem àquela página. Quando outra
rota precisar de `review-summary`, mover a capacidade para `features/reviews`
e expor uma interface sem `Route.LoaderArgs` ou params do router. Somente
comportamento genérico da marca sobe para `packages/ui`; `FindingEvidence`
ou `ReviewSummary` continuam UI do produto, não componentes genéricos.

Para features, usar `public.ts` quando houver consumidor externo. Para packages,
exports/subpaths explícitos, como `@holon/ui/button`, `@holon/ui/icons`,
`@holon/auth/client` e `@holon/auth/server`; não um barrel que misture todos
os ambientes e dependências. Não criar um barrel por subpasta privada.

## Formulários, schemas, contexts e estado

| Artefato                               | Dono e regra                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Formulário de uma página               | Junto à rota; campos e controles genéricos vêm de UI                                          |
| Fluxo/formulário usado em várias rotas | Feature que representa a tarefa; sem importar roteamento concreto                             |
| Schema de apresentação                 | Junto ao formulário; campos transitórios, mensagens e normalização da UI                      |
| Schema HTTP/payload compartilhado      | `contracts`; validar novamente no servidor e respostas do cliente                             |
| Schema físico/tabelas                  | Persistência em `db`; nunca reutilizar row ORM como DTO público                               |
| Queries/mutations                      | Módulo de dados da capacidade; keys, frescor, erro e invalidação têm um dono                  |
| Context de página/feature              | Estado local compartilhado de interação; criar somente quando props/hooks locais não bastarem |
| Context global                         | Provider composto na raiz para tema/sessão/cache, não um objeto com todo estado do produto    |
| Filtros compartilháveis                | URL validada; não manter cópias independentes em Context/store/Query                          |
| Valores de formulário e disclosure     | Estado local/form engine; não cache de servidor                                               |
| Dataset remoto                         | Query; não replicar em Context/store; hidratação inicial segue a política SSR/API             |

O schema de formulário pode compor partes do contrato para reduzir duplicação,
mas não define autorização ou banco. Validação para UX não é evidência de
segurança. Apresentação decide como mostrar um estado; servidor decide se o
comando é permitido. Query key inclui filtros normalizados, usuário, workspace e recurso;
logout/troca de escopo cancela e descarta dados anteriores.

## SSR, API e isolamento de ambiente

Preservar a [composição híbrida](../research/2026-10-04-dashboard-library-landscape.md#composição-híbrida-proposta--2026-10-04):
loader prepara a página e snapshot seguro, a feature lê a API após hidratação e
publica o snapshot no cache Query,
Hono valida/translada requests, e ambos chamam a mesma aplicação. Comandos de
recursos usam `/api/*`; não criar actions paralelas com outra regra.
Endpoints de autenticação serão definidos no debate próprio, não inferidos
como simples comandos CRUD de recursos do dashboard.

### Dono da leitura em SSR, hidratação e navegação

A composição candidata usa uma ponte explícita entre Router e Query:

| Momento                      | Dono e comportamento                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documento inicial            | Loader servidor chama o caso de uso diretamente, sem HTTP para a própria API; QueryClient por request recebe somente o snapshot autorizado e seu instante de observação            |
| Hidratação                   | Cache desidratado usa o transporte seguro do framework; browser restaura o snapshot sem nova leitura                                                                               |
| Navegação cliente            | `clientLoader` delega à operação de leitura explícita da feature, que consulta `/api/*` e confirma o snapshot no cache Query; não chama também `serverLoader` para o mesmo dataset |
| Filtro/página/voltar/avançar | Mesma operação lê novamente sob autorização atual; a URL validada define os filtros aplicados, com cursor reiniciado quando eles mudam                                             |
| Refresh manual               | Mesma operação, uma leitura autorizada; conteúdo/foco são preservados apenas enquanto o escopo continuar permitido                                                                 |

O dataset tem **um cache Query**, não cópias ativas em loader data, Context e
state. `useLoaderData` transporta bootstrap/contexto; a página observa o cache.
Para esses datasets com dono explícito, um observer passivo (`enabled: false`
na API documentada) é candidato a impedir fetch autônomo. É escolha restrita
motivada por Q8: invalidação sozinha não refaz a query; o dono executa a próxima
leitura. Não impor esse modo a toda capacidade nem usar `shouldRevalidate: false`
global para ocultar duplicação ou impedir renovação de sessão.

Frescor do cache não é autorização. A leitura explícita de navegação/filtro/
refresh deve chegar à API para revalidar o escopo, sem fast path que devolve
cache por `staleTime` em vez da leitura requerida. Ao voltar a outro repo ou
workspace, não reapresentar conteúdo privado cacheado antes da nova confirmação.
A preservação durante refresh refere-se à apresentação atual ainda autorizada.
Negação tardia de recurso invalida seu escopo original na mesma geração de
identidade. Se houve confirmação mais nova daquele escopo, remove somente a
key antiga sem apagar a confirmação nova. Uma negação atual impede também
respostas anteriores de outras páginas/filtros de repovoar o escopo. Sessão
inválida atual fecha todo o cache da identidade; não equivale a 403 de recurso.

Provar a ponte na versão fixada do Router/Query, incluindo transporte do loader,
timestamps e opções de observers. A referência `latest` do Query já diferencia
APIs de execução; não copiar nomes de versões distintas. A contagem esperada é
uma leitura de dataset por intenção normal e zero na hidratação, sem polling,
refetch por foco/reconexão/montagem ou retries ocultos. Cancelar keys do escopo
anterior, consumir `AbortSignal` no transporte e conferir geração de usuário/
workspace, query key/recurso e intenção antes de aplicar resposta ou erro.
Um 403 tardio de A não pode fechar B permitido no mesmo usuário/workspace.
Cancelar browser não desfaz efeito servidor. Não usar hooks Suspense nessa
ponte sem comprovar cancelamento.
[Client data](https://reactrouter.com/how-to/client-data),
[Query desabilitada](https://tanstack.com/query/latest/docs/framework/react/guides/disabling-queries)
e [cancelamento](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation).

A [prova executável de 2026-10-05](../research/2026-10-05-dashboard-browser-proof.md)
refina essa composição para as versões fixadas: o leitor da feature controla
HTTP, AbortSignal e intenções; Query conserva o único snapshot/subscription,
com `setQueryData` público e observer passivo. Cancelamento de uma execução
Query pode restaurar o estado anterior por design; isso não vale como resposta
autorizada para uma nova intenção. Não usar a deduplicação de requests pendentes
como confirmação de retorno ao escopo. Esse seam é restrito ao dataset manual
do MVP; não muda o papel geral da biblioteca nem cria outro cache.

O bootstrap desidratado é consumido na hidratação inicial. Re-render, remount
de observer ou negação posterior não reaplicam esse snapshot para ressuscitar
dados expulsos. Revalidação posterior passa pelo leitor explícito e sua nova
confirmação. A regra precisa permanecer testada ao compor a rota produtiva.

Navegação para página nova define foco no conteúdo/título e anúncio curto.
Filtro/refresh/idioma mantém o controle acionador e scroll pertinente. Se o item
focado desaparecer, escolher um destino previsível. Draft de busca pode ser local
até confirmação; a URL continua autoridade da busca aplicada. Não executar
prefetch de dados privados por hover/viewport no MVP sem política e prova próprias.
[Acessibilidade Router](https://reactrouter.com/how-to/accessibility).

Módulos `.server.ts` no app marcam composição, binding e código restrito.
React Router rejeita referências desses módulos no grafo cliente em Framework
Mode; módulos de rota precisam conter seus exports usuais e não recebem
sufixo `.server`. O package consumido não fica protegido apenas por ter
`server` no nome: separar exports e comprovar a ausência no bundle cliente.
[Fonte oficial](https://reactrouter.com/api/framework-conventions/server-modules).

Tipos gerados de rota ficam no adaptador de rota. Dados enviados ao browser
são DTOs serializáveis, não instancia de auth/ORM, bindings ou tokens. Não
instanciar auth, persistência ou QueryClient servidor em singleton com estado
de usuário. A composição recebe o contexto do runtime e injeta capacidades
mínimas no caso de uso. Não passar todo `env` a cada componente/módulo.

Serializável não significa seguro para inserir em HTML. Usar o transporte do
framework; não construir `<script>` com `JSON.stringify` de títulos/findings.
Conteúdo externo recebe escaping, URLs permitidas e política de Markdown/HTML
descritos em [segurança web](web-security-and-data-boundaries.md). Tokens OAuth
permanecem no servidor; a sessão opaca pode ser transportada em cookie HttpOnly.

Root compõe providers uma vez, com lifecycle explícito. UI genérica não cria
seu próprio QueryClient ou client auth. Erros de contrato/transporte são
classificados na borda; a página escolhe mensagem/estado, preservando privacidade.
Atualização otimista exige semântica segura de rollback/reconciliação; não
transformar sucesso visual em confirmação de execução no servidor.

## Identidade e escopo do workspace

O [modelo de identidade/workspaces](dashboard-identity-and-workspaces.md)
separa login, User estável, membership, espaço e integração GitHub. Provider
não é tenant e papel não é global ao usuário. Pessoal/equipe usam a mesma
entidade acordada em Q25; organização é sinônimo de workspace. Owner/member,
convites explícitos e cardinalidade de instalações foram confirmados em Q26–Q29.
Q31 exige owner Holon + titular pessoal/owner da org GitHub para conectar a
instalação inteira; leitura privada mantém Q22. Q32 confirma convites por email
verificado via Cloudflare; Q33 permite vários owners e protege o último.
Q34 inclui onboarding self-service mínimo. Nenhuma entidade/ACL foi implementada.

Workspace é explícito na URL e leitura API, validado no servidor por membership,
connection/instalação/repo e grant humano conforme Q22. Preferência de último
workspace lembra destino, sem depender do plugin Organization ou impor o escopo
das outras abas. SSR/Query/i18n ficam
por request/contexto; response antiga não repovoa cache após troca/logout.
Não confiar no ID informado pelo browser nem só em filtro D1. Q30 exige
revalidar sessão/membership na próxima request, sem cookie cache de sessão;
grants GitHub têm cache de até 60 s e invalidação por eventos recebidos.
A política de produto é compartilhada entre SSR e API, sem duas ACLs distintas.

## Fronteira proposta de entrega de emails

Q35 confirmou `apps/email-delivery` separado/privado e Q36 escolheu fila com
retries duráveis desde a primeira entrega. A proposta anterior de chamada
aguardada sem Queue foi superada. A direção está acordada; contratos, jobs e
bindings ainda não foram implementados.

| Responsável            | Capacidade                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard/aplicação    | Autorizar/criar/cancelar/aceitar convite, preservar membership/último owner e persistir intenção de envio atomicamente com convite                                                                           |
| Publisher no dashboard | Recuperar intenções pendentes, publicar ID estável na Queue e confirmar publicação sem perder trabalho após crash                                                                                            |
| Worker de email        | Consumir/validar referência, obter claim/contexto por RPC privado, renderizar template pt-BR/en, enviar e persistir resultado antes de ack individual                                                        |
| Packages               | Auth identifica usuário/sessão; application define política e portas; db implementa persistência; contracts valida Queue/RPC; templates ficam internos ao Worker enquanto não houver consumidor independente |

**Composição proposta:** convite+outbox no mesmo D1 → publisher recuperável →
Queue → email-delivery → Email Sending. Worker usa capability estreita no
dashboard para claim/contexto/resultado; proposta sem acesso ORM/D1 amplo no
sender. Payload da Queue é referência, sem email, corpo ou token/link.
Não expor endpoint público de envio nem aceitar HTML/remetente/URL arbitrários.

Fila não tem transação com D1. Intenção persistida e publisher com wake-up próprio
fecham a janela commit→publicação; job ID preservado tolera mensagens repetidas.
Persistir sucesso do provider antes de `ack()` evita reenviar sucesso conhecido,
mas timeout/crash após aceitação externa e antes do registro pode duplicar email.
Q37 confirmou retry automático limitado da mesma intenção, com possível mensagem
duplicada, sem novo convite/membership. Não é garantia de envio exatamente uma
vez. Convite cancelado/aceito/expirado é descartado antes do envio;
email já enviado não pode ser recolhido.

A [investigação de entrega](../research/2026-10-04-dashboard-email-delivery-investigation.md)
detalha falhas, leases, retries, DLQ, privacidade/preview e provas. Queue e
Worker email são capacidades necessárias acordadas; não adicionar outros canais,
scheduler de notificações, digest ou novas funcionalidades por disponibilidade.
Nenhum recurso foi criado. O [estado de referência](../planning/dashboard-engineering-decision-review.md)
separa política acordada, desenho técnico e provas restantes.

## Internacionalização desde a primeira entrega

Q16 confirmou pt-BR e inglês. Ambos têm catálogo completo de UI, incluindo
nomes acessíveis, erro, vazio, estado, plurais e formatação. Mensagens específicas
ficam perto da capacidade que as usa; regras/provider/formatters reutilizáveis
podem formar uma integração compartilhada útil. Não criar um wrapper de toda
a biblioteca ou aliases que o extractor não reconheça.

SSR usa instância de tradução por request, com locale e catálogo explícitos.
Browser hidrata com a mesma escolha; não redetectar idioma na primeira render
ou ativar locale em singleton servidor entre usuários. Catálogos públicos
imutáveis podem ser compartilhados; locale mutável não. CLI/compiladores ficam
no build, sem leitura de arquivos de tradução pelo filesystem do Worker.

Idioma de UI, região de formatação e fuso são conceitos separados. Não usar
o fuso default do runtime para SSR e outro no browser. Q19 confirmou preferência
pessoal → navegador → inglês; Q20 confirmou fuso pessoal/UTC até conhecê-lo. Allowlist de locale evita import arbitrário de header.
DTOs mantêm IDs/códigos/datas não localizados; UI traduz códigos de erro, sem
parse de mensagem humana. Troca de idioma preserva rota/filtros/foco.

Idioma da UI não traduz título do PR, achados/evidência/código nem dispara
nova revisão. `output.language` continua governado pela configuração de review.
A [pesquisa bilíngue](../research/2026-10-04-dashboard-library-landscape.md#suporte-bilíngue-e-identidade-confirmados--2026-10-04)
compara Lingui/react-i18next; biblioteca e versão ainda precisam de prova
SSR Workers/build/extraction. Não instalar segunda pilha de lint ou i18n só
por recomendação de plugin. Os [critérios de teste](testing-and-evidence.md#dashboard-bilinguismo-e-carga-de-referência-acordados)
passam a cobrir os dois idiomas.

## Leitura inicial, atualização e SSE futuro

A rodada 2 definiu a leitura inicial da lista por projeção D1 mínima indexada,
sem fan-out a DOs por item; o detalhe será um snapshot agregado autoritativo
do ledger, consumido por capacidade restrita do core. Contratos/entrypoint
ainda precisam de implementação. A composição é inferência para reduzir
custo de leitura e duplicação, não benchmark de latência. Consulte a
[justificativa e prova futura](../planning/dashboard-engineering-decision-review.md#q5-critério-técnico-e-limite-da-conclusão).

Metadados legíveis são persistidos a partir de ingresso validado/enriquecimento
controlado; não consultar GitHub a cada item da lista. Não construir histórico
de execuções anteriores nem importar/backfill de PRs. Isso não autoriza apagar
estado funcional existente do ledger. Achados sem proveniência confirmada para
o head atual não aparecem como resultado atual.

**Sem atualização automática no primeiro recorte.** Abertura/navegação,
filtros/paginação e refresh manual disparam leituras explícitas; nenhum polling,
refetch por foco/reconexão ou montagem adicional sobre snapshot hidratado.
Query fica configurado no app por dataset; o backend continua atualizando a
projeção duravelmente, com ordenação e reconciliação próprias. Preserve
conteúdo/foco durante refresh e último dado confirmado em falha transitória
somente se o escopo continuar autorizado. Sessão inválida, acesso negado ou
grant expirado sem confirmação fecham a apresentação privada e descartam o cache
pertinente; não conservar dados privados como fallback. Erro de intenção antiga
não pode remover a sessão/escopo novo. Retries de leitura são explícitos, sem
repetir 401/403 ou contrato inválido automaticamente.
[Defaults oficiais do Query](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults),
verificados em 2026-10-04, exigem delimitar esses gatilhos; `staleTime` sozinho
não expressa toda a política de interação.

SSE é evolução documentada: eventos tipados/revisão, autorização, ordenação,
reconexão, ressincronização por snapshot e desligamento ao mudar escopo.
Não instalar implementação de streams ou fallback por polling agora.

## Infraestrutura de aplicação e verificação futura

- Dependências `workspace:*` e exports explícitos; versões externas centralizadas
  no catálogo quando adotadas. React compatível como peer da UI evita duplicação.
- Build/code splitting por rota e imports de ícones/componentes necessários;
  evitar catálogo dinâmico inteiro ou um barrel que carregue todas as telas.
- Gate de imports: direções entre workspaces, route-to-route proibido,
  feature-to-route proibido, internals de features e ciclos locais.
- Gate de ambiente: build cliente não contém Better Auth servidor, Drizzle,
  bindings, credenciais ou imports de módulos servidor; typecheck de rotas.
- Testes por comportamento: regra pura, adapter persistência/auth no runtime,
  componente por interação e fluxo browser por navegação/sessão/SSR.
- Migrations com um dono e comandos separados de build/check; um package não
  possui deploy independente. O app declara bindings e ambiente em Wrangler.
- Banco local/remoto, preview e produção têm configuração explícita; instalação,
  build e CI de PR não aplicam migrations nem criam recursos por acidente.

`pnpm test:architecture` hoje cobre o grafo vigente e ciclos de módulos; não
cobre automaticamente os novos workspaces ou regras frontend propostas.
Estender os checks junto da primeira implementação, incluindo imports type-only,
aliases e subpaths. Não adicionar tooling novo se o gate atual puder representar
essas regras. Este documento não altera o teste para aceitar pacotes inexistentes.

O scanner atual reconhece `.tsx`, mas restringe a descoberta aos workspaces/
`src` vigentes e a resolução relativa `.js` a `.ts`; isso não prova ciclos em
TSX, aliases ou subpaths novos. Extensão exige fixtures negativas que falhem por
import proibido, ciclo e vazamento servidor/cliente, além dos casos permitidos.

A remoção de exports servidor pelo React Router e seu code splitting são
capacidades do framework, não prova do bundle futuro. Executar build e conferir
artefatos da combinação real antes de declarar isolamento ou performance.
[Fonte oficial](https://reactrouter.com/explanation/code-splitting).

## Checklist de localização

1. Só esta página usa? Manter junto à rota.
2. Várias páginas usam a mesma tarefa/objeto de produto? Feature com interface.
3. É padrão visual/acessível reutilizável sem domínio de review? `ui`.
4. É contrato externo? `contracts`; é armazenamento? Adapter persistência.
5. É regra de produto? Módulo/caso de uso dono, consumido por SSR e API.
6. A extração remove conhecimento duplicado ou apenas muda o caminho do import?
7. O consumidor aprende tipos do Holon ou precisa conhecer todo o SDK?

A estratégia combina localidade, interfaces pequenas, composição e portas/
adapters nas integrações. Não exige um framework de pastas ou camadas idênticas
para cada feature. Fontes externas verificadas em **2026-10-04**; exemplos de
paths e nomes são propostas do Holon, não convenções obrigatórias das bibliotecas.

## Checks materializados na fundação

`tooling/architecture/module-graph.mjs` interpreta AST e confere src/app/workers,
exports/subpaths, alias `~/` com contraparte em Vite e resolução `.js`→`.tsx`.
Fixtures negativas provam ciclos, internals de rotas/features e vazamento servidor
transitivo. Componentes puros não alcançam runtime/SDK servidor. Módulos de rota
mistos ficam sujeitos ao build real e à verificação do bundle cliente.

Features não podem importar a composição em `root.tsx`, `routes.ts`,
`composition.server.ts` ou `shell/*`. As fixtures também cobrem imports relativos
e reexports pelo alias `~/` para os dois arquivos de configuração/composição,
preservando o acesso aos módulos servidor internos da própria feature.

O primeiro bootstrap contém `routes/welcome/route.tsx`, wildcard 404 localizado,
`server/http-*`, `i18n/` e contexto de nonce por request. Não há pasta components
central de páginas nem feature fictícia. `packages/ui` expõe button, dialog,
select-field, icons, brand, CSS e utilitário de classes por subpath.

Para inspecionar a configuração shadcn, `pnpm dlx shadcn@4.21.3 info` em
`apps/dashboard` resolve o destino `packages/ui/src`. O alias exato `@holon/ui`
serve à geração; não é um módulo runtime. O app continua importando subpaths
exportados, sem alias wildcard para internals. Não gerar componentes de produto
num diretório central por padrão; indicar a rota dona. `add` não foi executado
na fundação e não autoriza sobrescrever APIs existentes ou adicionar SDKs sem
comportamento, tokens e testes correspondentes.
