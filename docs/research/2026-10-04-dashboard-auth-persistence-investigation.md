---
id: RESEARCH-2026-10-04-DASHBOARD-AUTH-PERSISTENCE
kind: research
status: current
date: 2026-10-04
verified-at: 2026-10-04
owners:
  - core-team
related:
  - 2026-10-04-dashboard-authentication-discovery.md
  - 2026-10-04-dashboard-email-delivery-investigation.md
  - 2026-10-04-dashboard-read-model-investigation.md
  - ../engineering/dashboard-identity-and-workspaces.md
---

# Autenticação e persistência do dashboard: investigação da composição

## Leitura atual após a política aprovada em 2026-10-05

Este relatório conserva a investigação inicial sob linking implícito proibido.
O responsável posteriormente aprovou o linking nativo por email verificado no
provider e no User local; a [regra atual](../engineering/dashboard-identity-and-workspaces.md#vinculação-por-email-verificado-ajuste-aprovado-em-2026-10-05)
substitui essa restrição de Q32. A [prova Workerd/D1 atual](2026-10-05-dashboard-auth-proof.md#resultado-da-política-aprovada-em-2026-10-05)
recupera Account interrompida em Drizzle/D1 e D1 nativo por novo OAuth com mesmo
email verificado. Isso não faz User/Account atômicos; a limitação de state
concorrente mantém #129 bloqueada. Os gates de tenancy, refresh e convites abaixo
continuam válidos. Não exigir outra persistência apenas com base no NO-GO inicial.

## Pergunta e conclusão

Como compor Better Auth, Drizzle e D1 preservando as políticas acordadas de
identidade, workspaces, owners, convites e revogação?

**Recomendação técnica:** Better Auth para User, Account e Session; workspaces,
memberships, conexões e convites sob regras próprias do Holon em domínio/aplicação,
com portas de persistência. O plugin Organization permanece uma opção investigada;
não é requisito para cumprir o modelo SaaS acordado. Organização e workspace
continuam sendo sinônimos de uma única entidade de produto.

A leitura das fontes não demonstra uma integração pronta. Há riscos concretos
de atomicidade no adapter D1 e no cadastro OAuth do próprio core, além de provas
necessárias de refresh concorrente e cookies SSR. Retirar o plugin não elimina
esses riscos. Esta investigação não implementa auth, schema, migration ou recursos.

**Leitura ao final da pesquisa inicial:** a [revisão de robustez](#revisão-de-robustez--2026-10-04)
acrescenta bloqueio de prontidão do cadastro OAuth, exposição nativa de token de
sessão, protocolo de comandos e comportamento de refresh perdido. A combinação
estável abaixo é candidata, não aprovada para bootstrap de auth sem essas provas.

## Versões e procedência verificadas em 2026-10-04

| Pacote                      | Estável `latest` observado | Publicação UTC       | Fonte publicada                                                               |
| --------------------------- | -------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| Better Auth                 | `1.7.7`                    | 2026-09-30T21:30:55Z | [Registro npm](https://registry.npmjs.org/better-auth/1.7.7)                  |
| Drizzle adapter Better Auth | `1.7.7`                    | 2026-09-30T21:32:56Z | [Registro npm](https://registry.npmjs.org/@better-auth/drizzle-adapter/1.7.7) |
| Core Better Auth            | `1.7.7`                    | 2026-09-30T21:30:24Z | [Registro npm](https://registry.npmjs.org/@better-auth/core/1.7.7)            |
| Drizzle ORM                 | `0.45.3`                   | 2026-09-21T10:06:39Z | [Registro npm](https://registry.npmjs.org/drizzle-orm/0.45.3)                 |
| Drizzle Kit                 | `0.31.11`                  | 2026-09-21T10:06:58Z | [Registro npm](https://registry.npmjs.org/drizzle-kit/0.31.11)                |

O adapter declara ORM `^0.45.2 || >=1.0.0-rc.1 <2.0.0`; Better Auth aceita Kit
`>=0.31.4 || >=1.0.0-beta.1`. Portanto **Better Auth/adapter/core 1.7.7 + ORM
0.45.3 + Kit 0.31.11** é o candidato estável para uma prova focada, sem instalar
RC por inferência. A [página D1 do Drizzle](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)
orienta `@rc`; a discrepância entre exemplo e releases deve ser considerada.
O [adapter padrão](https://better-auth.com/docs/adapters/drizzle) usa Relations v1;
Relations v2 é outro entrypoint e não tem necessidade demonstrada nesta fatia.

As tags foram verificadas separadamente dos artefatos npm, que não expunham
`gitHead`: Better Auth `v1.7.7` aponta para
`db02f233918ad1233bf0753e437e1c0da353273d`; Drizzle `0.45.3` aponta para
`15454dbe49d827c6081f3d0231e2e7985e517295`. Foram lidas fontes e distribuições
publicadas em diretório temporário, sem executar o código das bibliotecas.
Peer dependencies compatíveis não provam funcionamento em Workerd/D1.

## O adapter transacional não equivale ao batch D1

- O [adapter estável](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/drizzle-adapter/src/drizzle-adapter.ts#L1250)
  usa `transaction: false` por padrão; ativar a opção chama `db.transaction`.
- Sem implementação transacional, a [factory](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/core/src/db/adapter/factory.ts#L862)
  executa `fn(adapter)`. O nome `runWithTransaction` não implica rollback.
- O [driver D1 estável](https://github.com/drizzle-team/drizzle-orm/blob/15454dbe49d827c6081f3d0231e2e7985e517295/drizzle-orm/src/d1/session.ts#L111)
  emite `BEGIN`, `COMMIT` e `ROLLBACK` para `transaction()`. Não transforma o
  callback em `D1Database.batch()`.
- [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
  e [Drizzle batch](https://orm.drizzle.team/docs/sqlite/batch-api) são caminhos
  próprios, com rollback quando um statement falha. Uma atualização que afeta
  zero linhas não é automaticamente uma exceção: o protocolo deve interpretar
  condições, resultados e dependências entre statements.

Não recomendar `transaction: true` como correção automática para D1, nem vender
`false` como compatibilidade completa. Não foi executado `BEGIN` em D1 nesta
pesquisa; a evidência de fonte é a diferença entre os caminhos. Batches próprios
devem proteger operações completas, sem pressupor que qualquer sequência de
CRUD se torna correta apenas por estar em um batch.

## Plugin Organization: proteção existente e limites

| Fluxo inspecionado                    | Fato na fonte                                                                                                  | Implicação para o Holon                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Criar organização                     | Organization e membership owner são gravadas em sequência, sem transação envolvendo ambas                      | Falha intermediária precisa de recuperação; não demonstra workspace com owner atômico |
| Remover/rebaixar/sair do último owner | Há checks antes da mutação                                                                                     | A proteção existe; consulta e mutação separadas exigem prova contra corrida           |
| Aceitar convite                       | Claim `pending → accepted`, depois criação de member em `runWithTransaction`; catch tenta retornar a `pending` | Compensação não equivale a atomicidade D1; falha após membership deve ser exercitada  |
| Enviar convite                        | Persiste invitation e depois chama callback por await/background                                               | Callback/after-hook não garante convite e outbox no mesmo commit                      |

Fontes fixadas: [criação](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/plugins/organization/routes/crud-org.ts#L179),
[owners](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/plugins/organization/routes/crud-members.ts#L386),
[saída](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/plugins/organization/routes/crud-members.ts#L906),
[aceite](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/plugins/organization/routes/crud-invites.ts#L739)
e [envio](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/plugins/organization/routes/crud-invites.ts#L577).
São observações de código e hipóteses de falha justificadas, não reprodução em D1.

A fronteira própria evita adaptar essas regras por cópia do plugin, vários hooks
ou triggers sem necessidade demonstrada. Não exige novo package. A proposta é
expor operações como garantir pessoal, criar equipe com owner, convidar com
intenção de envio, aceitar convite e preservar owners ao promover/remover/sair.
Autoridade do ator, estado esperado, unicidade e condição do último owner devem
participar da mutação, e não somente de leitura anterior.

Workspace+owner, convite+outbox e aceite+membership ficam no **mesmo D1 de
identidade/tenancy**, com constraints, statements condicionais e batches a provar.
O banco candidato de projeção funcional não participa dessas transações.
Migrations têm dono único; apps compõem portas, sem espalhar Drizzle nas rotas.
Os contratos públicos do app usam conceitos Holon, sem tipos do plugin nas páginas.

## Risco restante no próprio cadastro OAuth

O [core OAuth](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/oauth2/link-account.ts#L542)
cria User e depois Account dentro de `runWithTransaction`. Sem transação no
adapter, a segunda gravação pode falhar após persistir User. Repetir callback
com linking implícito desativado precisa recuperar consistentemente esse estado.

Esse ponto é condição de prontidão do candidato estável, mesmo usando tenancy
própria. Injetar falha entre User/Account e repetir callback; verificar
unicidade, ausência de vínculo a outra pessoa e recuperação sem fundir usuários
por email. A pesquisa não escolhe um patch ou adapter alternativo sem essa prova,
nem autoriza relaxar a política de identidade para contornar o problema.

## GitHub humano, email verificado e tokens

Recomendação: login humano da **GitHub App**, com acesso granular/interseção já
acordada e tokens expirantes. [Better Auth GitHub](https://better-auth.com/docs/authentication/github)
documenta suporte aos dois tipos de app. A GitHub App precisa de permissão de
conta **Email addresses: Read-only**; scope tradicional de OAuth App não substitui
a prova de autoridade. [GitHub user token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

O [provider estável](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/core/src/social-providers/github.ts#L118)
consulta `/user` e `/user/emails`, escolhe endereço e usa seu `verified` real.
Não assume que todo email retornado está verificado. Ausência/falha produz estado
explícito; não inventar email sintético verificado. Provar email privado,
identidade por ID estável, state/callback/cookies e PKCE S256 quando houver verifier.

**Errata de fonte:** Better Auth ainda afirma que OAuth Apps não têm refresh
tokens; o [changelog GitHub de 2026-08-14](https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/)
adicionou expiração/refresh optativos a OAuth Apps. Não usar essa diferença antiga
como justificativa. Para GitHub App, access token expira em 8 h e refresh token em
6 meses; refresh invalida o par anterior. [Refresh GitHub](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens).

O [caminho nativo de refresh](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/api/routes/account.ts#L680)
persiste o novo par perto da expiração. Nesse caminho inspecionado não foi
encontrada exclusão mútua distribuída/CAS. Provar dois Workers renovando o mesmo
token, o perdedor da corrida e falha entre refresh remoto e gravação local.
Refresh de token GitHub não é renovação da sessão Holon nem reautenticação.

Direção técnica: `encryptOAuthTokens: true` nativo, `storeAccountCookie`
desativado, linking implícito desativado e tokens só no servidor. O handler
completo inclui `/get-access-token` e `/refresh-token`, com respostas de token;
restringir o transporte HTTP público por allowlist e provar a porta interna.
Não basta omitir chamadas no cliente. Tokens não entram em browser, RPC de leitura
ou logs. [Opções oficiais](https://better-auth.com/docs/reference/options).

## Sessão SSR, isolamento e reautenticação

Q24 mantém sessão móvel de 7 dias, renovada em uso após 24 h. Q30 exige leitura
local atual na próxima request, sem cookie cache inicialmente. SSR e API usam
mesma política e fonte primária de identidade; contexto/memoização só por request,
respostas privadas sem cache compartilhado. Não adotar réplica de identidade sem
provar revogação por outro ator. [Investigação de leitura](2026-10-04-dashboard-read-model-investigation.md).

Propagar **todos os `Set-Cookie`** da leitura/renovação de sessão nos loaders SSR,
redirects e respostas de dados. A [rota de sessão](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/api/routes/session.ts#L477)
trata headers internamente; a composição externa precisa preservá-los.

`freshAge` usa `createdAt`, não a renovação móvel. O [middleware](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/api/routes/session.ts#L595)
não protege automaticamente comandos Holon próprios. A prova de reauth deve
vincular novo fluxo ao mesmo User e intenção sensível. GitHub documenta
`prompt=select_account`; isso não promete exigir senha/MFA. Janela e ações
sensíveis serão explicitadas na composição, sem atribuir defaults ao produto.

## Condições de prova e limites

Antes de declarar a combinação pronta, uma etapa de implementação autorizada
deve comprovar:

1. Falha User/Account e callback repetido sem fusão por email.
2. Refresh concorrente, par rotacionado e falha após efeito remoto.
3. SSR/cookies, redirects, isolamento entre requests e bundle sem tokens.
4. Pessoal idempotente e criação equipe+owner íntegra.
5. Último owner preservado sob remoções/rebaixamentos/saídas concorrentes.
6. Convite+outbox e aceite+membership atômicos, autoridade revalidada e alvo correto.
7. Login real GitHub App, email privado/verificado, org privada e grants paginados.

Fontes verificadas em **2026-10-04**. Método: documentação primária, registry npm,
tags e leitura de código publicado. Nenhuma dependência instalada/executada,
teste Workerd/D1, login real, operação de conta ou envio. O experimento SQLite
de outro relatório prova consultas sintéticas de projeção, não esta composição.

## Revisão de robustez — 2026-10-04

### Cadastro: condição de bloqueio, não débito posterior

O caminho candidato fica **no-go para autenticação de usuários** enquanto não
demonstrar atomicidade ou recuperação suportada de User/Account após falha em
cada gravação, por **novo fluxo OAuth**. Replay do mesmo state/code consumido
é negado; repetição idempotente de negócio não autoriza reusar credencial de
uso único. A expressão “repetir callback” da investigação inicial não é um
protocolo de recuperação. Não aceitar usuário órfão que bloqueie
login, associação por email, cópia do core, monkey patch ou `transaction: true`
sem suporte D1. Se o caminho estável não cumprir a invariável, rever adapter/
persistência por decisão arquitetural antes de construir onboarding sobre ele.
Tenancy própria continua recomendada, mas não corrige cadastro da biblioteca.

### Superfície pública: segredo de sessão também exige tradução

A fonte estável de `/get-session` e `/list-sessions` usa `parseSessionOutput`;
`session.token` não tem `returned: false` no schema core e o filtro só elimina
campos com essa marca. Portanto a leitura indica exposição no JSON nativo,
além das rotas OAuth já identificadas. Não foi executada request nesta auditoria.
[Rota](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/api/routes/session.ts#L316),
[parser](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/db/schema.ts#L115),
[schema](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/core/src/db/get-tables.ts#L133)
e [filtro](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/core/src/utils/db.ts#L7).

Usar allowlist **método/path/provider**, sem handler genérico público. Contexto,
listagem e gestão de sessão retornam DTO Holon sem token; o adapter servidor
resolve identificador público da sessão pertencente ao User para o segredo
necessário à operação interna. Paths de linking, credenciais, exclusão e plugins
não escolhidos ficam fechados. Native client SDK não deve reabrir essas rotas.
Cookie opaco HttpOnly chega ao browser; tokens OAuth e segredo de sessão não
entram em JS/JSON/SSR/logs. Provar respostas reais e preservar todos os Set-Cookie.
[API interna](https://better-auth.com/docs/concepts/api),
[cookies](https://better-auth.com/docs/concepts/cookies).

### Mutação condicional completa

Cada operação define precondições, chave de intenção e resultado indivisível.
Todos os statements dependentes compartilham ator/workspace/estado/revisão; se
uma guarda afetar zero linhas, **nenhum efeito dependente pode ocorrer**.
Inspecionar `changes` depois não desfaz inserts anteriores. Chave repetida com
outro ator, espaço ou conteúdo é inválida; repetição legítima recupera resultado
confirmado, sem repetir criação/entrega. Constraints e batch protegem falhas
SQL; guards protegem condições do domínio. Ambos precisam de prova concreta,
incluindo autoridade revogada durante preflight e disputa pelo último owner.

### Refresh coordenado e reconexão honesta

Uma porta servidor é dona de todas as renovações do account. A tentativa tem
propriedade persistida e revisão; worker atrasado não sobrescreve o vencedor,
e perdedor relê o novo par quando ele existe. Mutex em memória não cobre isolates.
Não permitir caminho nativo paralelo que ignore essa coordenação.

Se o GitHub consumiu o refresh e a resposta com o novo par se perdeu, CAS/lease
local não recupera o segredo externo. Estado é **precisa reconectar**: negar
leitura privada dependente, manter sessão Holon independente e orientar novo
fluxo do mesmo account. Não aplicar Q37 a refresh nem repetir token consumido
cegamente. Reconexão não vincula outro User por email e revalida grants.

### Convite e HTTP

A [referência de segurança web](../engineering/web-security-and-data-boundaries.md)
define cookie host-only/origens exatas, CSRF dos comandos Hono, reauth vinculado
à intenção e convite por ID opaco sem autoridade de ingresso. Aceite exige
confirmação atual de email alvo verificado no provider, account correspondente,
estado/prazo e POST protegido; flag antiga no User não basta. Isso elimina bearer
secret de convite na outbox sem relaxar a identidade acordada.

Provas acrescentadas: segredo no JSON/HTML/logs; método/path fora de allowlist;
CSRF/redirect malicioso; callback/login parcial; refresh concorrente/perdido;
zero rows sem efeitos posteriores; email alvo alterado/ausente/provider indisponível;
aceite repetido pelo mesmo User e negado a outro, sem recriar membership
posteriormente removida. São critérios bloqueantes do
[plano](../planning/dashboard-implementation-plan.md), sem runtime implementado.

## Prova executável e atualização em 2026-10-05

A [prova Workerd/D1](2026-10-05-dashboard-auth-proof.md) passou a executar os
pacotes publicados reais e OAuth GitHub com rede sintética. A falha antes de
Account deixou User persistido; um novo OAuth com state/code novos terminou
em `account_not_linked`. A composição D1 nativa oficial reproduziu o mesmo
bloqueio. Esse **NO-GO** confirma o risco descrito acima e mantém DASH-02/#129
aberta, sem auth produtiva ou hook de recuperação por email.

O relatório registra também sessão JSON nativa com `session.token`, DTO servidor
reduzido com Set-Cookie, expiração/revogação e state concorrente. Diagnósticos
verdes conservam evidência do candidato; o gate de viabilidade usa asserts
comuns e falha. Alternativas transacionais são propostas para decisão/prova,
não substituição aprovada da persistência. A pesquisa anterior permanece um
snapshot; o relatório novo distingue cada comportamento efetivamente testado.
