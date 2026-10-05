---
id: RESEARCH-DASHBOARD-AUTH-PROOF
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-05
related:
  - 2026-10-04-dashboard-auth-persistence-investigation.md
  - ../engineering/web-security-and-data-boundaries.md
  - ../planning/dashboard-implementation-plan.md
---

# Prova local de autenticação: Better Auth e D1

## Resultado da política aprovada em 2026-10-05

**Recuperação por email verificado comprovada localmente; gate completo ainda
NO-GO pelo state concorrente.** O responsável aprovou usar a vinculação implícita
padrão do Better Auth após o debate sobre verificação e reutilização de emails.
A restrição anterior de Q32 foi substituída explicitamente na
[referência de identidade](../engineering/dashboard-identity-and-workspaces.md#vinculação-por-email-verificado-ajuste-aprovado-em-2026-10-05).
Isso resolve o bloqueio `account_not_linked` do cenário com mesmo email
verificado; não acrescenta atomicidade User/Account nem altera o parser OAuth.

A bancada usa **Better Auth/core/adapters 1.7.7**, Drizzle **0.45.3**, plugin
Cloudflare **1.1.2** e D1 real local. A configuração mantém `transaction: false`
no Drizzle, linking nativo e `trustedProviders: []`; não desativa a verificação
local padrão, não copia o core nem introduz hook de recuperação. Os providers,
adapters e handler são os publicados; só a rede GitHub é sintética.
As versões/dependências e compatibility date não mudaram nesta atualização.

### Cenários e oráculos da atualização

`test/account-linking.test.ts` parametriza Drizzle/D1 e D1 nativo. As demais
provas conservam falhas de persistência, sessão, criptografia e superfície pública.
D1/cookies/redirects são reais; os exemplos de identidades são exclusivamente
sintéticos. Outro subject com mesmo email é um ensaio controlado da política,
não evidência de dois usuários GitHub reais com o mesmo email simultaneamente.

| Cenário                                                         | Resultado local                                                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Falha no INSERT User, Account ou Session; novo OAuth            | Recupera com mesmo email verificado; um User/Account/Session e User preservado quando já existia          |
| Outro subject com mesmo email verificado recebido e local       | Vincula Account ao User existente; não cria outro User                                                    |
| Email recebido não verificado                                   | Nega linking, sem nova Account/Session nem alteração das linhas anteriores                                |
| Email local não verificado, recebido verificado                 | Nega linking; signup nativo não verificado não serve de prova de ownership                                |
| Subject já vinculado muda email para o de outro User            | Conserva a Account/User original, sem transferir a identidade                                             |
| Falha ao vincular outra Account e novo OAuth                    | Recupera, conserva User e sessão anterior                                                                 |
| Linking concorrente do mesmo subject                            | Constraints convergem para um subject/User; nova tentativa funciona                                       |
| State alterado, cookie ausente/de outro fluxo ou state expirado | Nega antes do token endpoint, sem User/Account/Session                                                    |
| Code consumido com novo state válido                            | Provider sintético nega; nenhuma sessão adicional                                                         |
| Replay sequencial com cookie original                           | Nega antes da segunda troca de token                                                                      |
| Replay concorrente do mesmo state/cookie/code                   | Duas trocas no provider; só um sucesso por código único. Gate de consumo único de state continua falhando |
| Escritas User/Account no callback                               | INSERTs separados, sem D1.batch; recuperação por linking não é rollback                                   |
| Email muda entre a falha de Account e o retry, mesmo subject    | Novo User com Account/Session; User inicial permanece sem Account/Session                                 |

A regra de linking não exige verificação para **todo signup**: o teste de
User local não verificado começa por um OAuth nativo que o cria e autentica.
Aceite de convite exige confirmação atual do email no provider; login/email
sozinho não concede membership ou grant privado. Provisionamento Holon futuro
não pode reagir apenas a `user.create`: precisa de login concluído e Account
vinculada. A bancada não implementa esses efeitos, limpeza de órfãos, recuperação
de User local não verificado, refresh distribuído ou reauth.

### Execução e resultado

Os testes novos foram executados primeiro com linking desativado: **10 falhas
em 16 testes**, sendo oito nas expectativas da nova política/recuperação e duas
no gate concorrente já existente. Após habilitar o linking nativo aprovado:

- `pnpm --filter @holon/dashboard-auth-proof test`: **42 testes passaram**.
- `pnpm --filter @holon/dashboard-auth-proof typecheck`: passou.
- `pnpm --filter @holon/dashboard-auth-proof test:coverage`: **42 passaram**;
  100% linhas/funções/statements e 96,42% branches de `src/**/*.ts` do harness,
  preservando os thresholds 90/90/90/85. Não instrumenta o core de terceiros.
- `pnpm --filter @holon/dashboard-auth-proof test:viability`: **duas passaram,
  duas falharam; exit 1**. Recuperação passa nos dois adapters; consumo concorrente
  antes do token endpoint ainda observa duas trocas em vez de uma.

Node **24.19.0**, pnpm **11.24.0**, Workerd local e data de compatibilidade
**2026-08-29**, `nodejs_compat`. A prova concorrente usa requests no mesmo isolate;
não prova coordenação regional. O provider falso usa códigos únicos e não prova
PKCE, permissões ou configuração de uma GitHub App real. Sem recursos, secrets,
OAuth real, banco remoto, deploy ou email. Integração geral/CI têm seus resultados
separados no [relatório do milestone](2026-10-05-dashboard-milestone-zero-results.md).

### Interpretação e próximo gate

A [documentação de linking](https://better-auth.com/docs/concepts/users-accounts#account-linking)
revalidada em **2026-10-05** confirma o default e avisa que `trustedProviders`
pode dispensar verificação. Os casos negativos exercitam os defaults da release
fixada; não se infere segurança de todos os providers ou de futuras versões.
Email reutilizável continua sendo um risco do modelo aprovado, não uma identidade
imutável. A vinculação padrão suportada substitui a necessidade de trocar D1
apenas para recuperar esse cadastro; PostgreSQL não foi adotado.

A [fonte do parser 1.7.7](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/state.ts)
e a distribuição instalada usam `findVerificationValue` e delete posterior.
A biblioteca possui outra primitiva de consumo, mas esse parser não a chama;
adicionar `getAndDelete` a secondary storage não substitui o caminho OAuth atual.
Não se alterou o core ou adicionou wrapper para disfarçar o resultado. A repetição
concorrente não é, por si só, prova de takeover: o código único negou segundo login.
A aprovação de linking não autoriza relaxar o requisito mais forte de state.

**#129 e dependentes continuam bloqueados.** O próximo gate é obter consumo
concorrente de state por composição oficialmente suportada e repetir as regressões;
qualquer mudança do requisito precisa de decisão explícita, não de ajuste do teste.
O User incompleto quando email muda permanece documentado; sua limpeza e ausência
de autoridade no onboarding precisam de política/prova na integração de produto.

## Registro da execução inicial sob a política anterior

O restante conserva a evidência inicial: a fixture desativava linking implícito
conforme a restrição então acordada. As conclusões sobre impedir vínculos por
email e exigir alternativa de persistência retratam essa política, substituída
pela aprovação e prova acima; não são a configuração ou recomendação atuais.

### Resultado e escopo iniciais

**NO-GO na execução inicial, com linking implícito desativado.** A prova
DASH-02, issue #129, reproduziu persistência parcial de User/Account: depois de
falha na gravação de Account, um novo fluxo OAuth da mesma identidade termina
em `account_not_linked`, sem sessão, e deixa User órfão. Trocar Drizzle pelo
adapter D1 nativo oficial não resolveu. A issue permanece aberta; esta pesquisa
conclui a investigação executada, não a viabilidade ou o milestone do dashboard.

A implementação está em [`tooling/dashboard-auth-proof`](../../tooling/dashboard-auth-proof/README.md),
workspace privado de teste, sem app implantável, exports de produto, Wrangler
config, secrets reais ou comandos de deploy. Better Auth, providers, adapters,
Drizzle, state/cookies e queries são os pacotes publicados reais; Workerd e D1
são locais pelo plugin oficial Cloudflare. Somente os endpoints HTTP GitHub são
sintéticos. Não há fake que reimplemente signup, sessão ou o algoritmo do adapter.

A prova executa o provider GitHub nativo com tokens expirantes sintéticos e
email privado verificado. Não configura nem autoriza uma GitHub App real e não
comprova suas permissões, grants, PKCE ou entrega de email. Rate limiting e logs
nativos estão desligados na fixture, não validados ou aprovados para produção.

### Versões e proveniência verificadas em 2026-10-05

| Componente                                           | Versão executada  | Fonte primária                                                            |
| ---------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| Better Auth                                          | 1.7.7             | [registry](https://registry.npmjs.org/better-auth/1.7.7)                  |
| Core                                                 | 1.7.7             | [registry](https://registry.npmjs.org/@better-auth/core/1.7.7)            |
| Drizzle adapter                                      | 1.7.7             | [registry](https://registry.npmjs.org/@better-auth/drizzle-adapter/1.7.7) |
| Kysely adapter D1 nativo, dependência do Better Auth | 1.7.7             | [registry](https://registry.npmjs.org/@better-auth/kysely-adapter/1.7.7)  |
| Drizzle ORM                                          | 0.45.3            | [registry](https://registry.npmjs.org/drizzle-orm/0.45.3)                 |
| Vitest / cobertura Istanbul                          | 4.1.11            | catálogo e lockfile do Holon                                              |
| Plugin Cloudflare                                    | 1.1.2             | catálogo e lockfile do Holon                                              |
| Node / pnpm                                          | 24.19.0 / 11.24.0 | runtime utilizado                                                         |

Os dist-tags `latest` oficiais permaneceram nessas versões de Better Auth/ORM;
não foi encontrada release estável posterior que eliminasse o bloqueio.
Drizzle Kit 0.31.11 foi revalidado no [registry](https://registry.npmjs.org/drizzle-kit/0.31.11),
mas não instalado/usado por este workspace: não houve geração de migrations.
As dependências da prova são devDependencies exatas/catalog; integridades estão
no lockfile. O core e os adapters inspecionados correspondem à release/tag
Better Auth `v1.7.7`, commit `db02f233918ad1233bf0753e437e1c0da353273d`.

Compatibilidade Workers: `2026-08-29`, a data já utilizada no runtime do Holon,
com `nodejs_compat`. O binário do catálogo recusou a tentativa inicial de
`2026-10-04`, informando máximo `2026-09-04`; essa tentativa não executou testes.
Não trocar o catálogo nem generalizar a prova para outra data de compatibilidade.

### Método e oráculos

O fluxo inicia em POST social do handler real, obtém state/cookie, troca código
no provider GitHub e termina no callback real. O GitHub sintético aplica código
de uso único, fornece perfil e `/user/emails`, e rejeita qualquer outra rede.
Os testes inspecionam redirects/cookies e linhas reais de User, Account e Session.

Schema SQL e schema Drizzle são fixtures explícitas do core sem plugins. Um teste
compara todas as colunas físicas com as do Drizzle e prova foreign key no D1.
A fixture acrescenta unicidade `(providerId, accountId)` para proteger o subject
sob concorrência; a prova de convergência depende também dessa constraint e não
atribui toda a garantia à biblioteca. Isso não corrige cadastro parcial.

Falhas são produzidas por triggers temporárias `RAISE(ABORT, ...)` antes de
INSERT em User, Account ou Session no D1 real. São exclusivamente **injeção de
falha**, removidas antes da tentativa seguinte; não são solução de recuperação
ou alteração do core. Reset do plugin isola cada teste. Uma nova tentativa OAuth
recebe outro state e outro código; replay nunca é usado como recuperação.

Há duas suites com critérios distintos:

- **Diagnósticos:** afirmam o comportamento observado do candidato fixado,
  inclusive os defeitos reproduzidos. Um resultado verde conserva a evidência e
  não significa que login está apto a entrar no produto.
- **Viabilidade:** asserts comuns exigem o comportamento desejado. Não há
  `it.fails`, skip ou inversão da expectativa. O comando termina em erro
  enquanto os candidatos não cumprem os requisitos; não participa silenciosamente
  do comando de diagnósticos nem é relatado como aprovado.

### Evidência observada

| Cenário                                                | Resultado local                                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Signup normal, email GitHub privado/verificado         | User/Account/Session presentes, subject GitHub correto, redirect de sucesso e cookie host-only/HttpOnly/Secure/Lax                        |
| Tokens OAuth em repouso                                | Valores persistidos são strings distintas dos tokens sintéticos; API servidor recupera o access token original usando criptografia nativa |
| Falha antes de User e novo OAuth                       | Recupera; uma identidade/account/session                                                                                                  |
| Falha antes de Session e novo OAuth                    | Recupera a identidade já vinculada; uma identidade/account/session                                                                        |
| Falha depois de User, antes de Account, mesmo email    | User=1, Account=0, Session=0; novo OAuth retorna `account_not_linked` em Drizzle e D1 nativo                                              |
| Email muda após essa falha, mesmo subject GitHub       | Novo OAuth pode criar outro User e Account, deixando o primeiro User órfão; não constitui recuperação íntegra                             |
| Outro subject GitHub com mesmo email verificado        | Login negado, sem vínculo implícito ou Account adicional                                                                                  |
| Callbacks concorrentes distintos da mesma identidade   | Convergem para um User/Account com as constraints da fixture; novo login funciona                                                         |
| Replay sequencial, reenviando cookie original de state | Negado; sem segunda troca de token/session                                                                                                |
| Replay concorrente do mesmo state/cookie/code          | Duas requests chegam ao token endpoint; o provider sintético nega código repetido e só um login sucede                                    |
| Sessão nativa JSON                                     | Inclui o segredo `session.token`; exposição confirmada por request real                                                                   |
| DTO público reduzido                                   | Sem token de sessão/OAuth/email; allowlist fecha paths/métodos/providers e campos de signin fora do contrato                              |
| Sessão renovada por uso e depois revogada no D1        | Renovação preserva Set-Cookie; request seguinte após DELETE retorna contexto nulo, sem cookie cache                                       |
| Sessão efetivamente expirada no D1                     | `expiresAt` no passado resulta em contexto nulo na request seguinte                                                                       |
| Origin estrangeiro no signin anônimo nativo            | A fixture observou resposta 200; fronteira pública própria rejeita 403                                                                    |

A concorrência foi executada por requests no mesmo isolate Workerd; não prova
coordenação entre isolates/regiões independentes. O resultado concorrente de
state não é, isoladamente, prova de takeover ou
vulnerabilidade: o código único do provider evitou segundo login. Entretanto,
a propriedade mais forte de consumo único de state antes de trocar token não
foi demonstrada. O gate registra essa condição separadamente. O **NO-GO já é
suficientemente sustentado pelo cadastro parcial**, independentemente desse
requisito protocolar adicional.

### Causas nas fontes publicadas

O [core OAuth](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/oauth2/link-account.ts#L542)
cria User e Account sequencialmente dentro de `runWithTransaction`.
O [adapter Drizzle](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/drizzle-adapter/src/drizzle-adapter.ts#L1250)
usa transação desativada por padrão, e a [factory](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/core/src/db/adapter/factory.ts#L862)
não transforma esse callback em batch transacional. No retry, linking implícito
desativado recusa User encontrado por email sem Account correspondente.

A alternativa `betterAuth({ database: env.AUTH_DB })` é suportada oficialmente,
mas a [seleção de dialect D1](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/kysely-adapter/src/dialect.ts#L186)
fixa `transaction = false`; o [driver](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/kysely-adapter/src/d1-sqlite-dialect.ts#L123)
recusa transações interativas. Seu teste produziu o mesmo bloqueio de recuperação.
[Database Better Auth](https://better-auth.com/docs/concepts/database) distingue
instância suportada de garantia transacional; `D1.batch` não torna um callback
CRUD arbitrário atomicamente compatível.

O [parser de state](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/state.ts#L230)
usa leitura de verification e [delete posterior](https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/better-auth/src/state.ts#L291),
permitindo a janela concorrente observada. Não se alterou esse parser nem se
adicionou wrapper de callback para ocultar a condição.

A tradução de sessão usa somente a API servidor com `returnHeaders`, DTO
explícito e todos os Set-Cookie; não reescreve resposta por regex/monkey patch.
Esse seam HTTP é validado como prova isolada e não restaura signup nem autoriza
copiá-lo diretamente para um app sem suas demais políticas.

### Alternativas e consequência arquitetural

| Caminho                                                            | Garantia/custo                                                                                             | Situação                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Drizzle D1 estável atual                                           | Baixo acoplamento planejado, mas User/Account parcial não recupera                                         | NO-GO reproduzido                                        |
| D1 nativo Better Auth estável                                      | Remove Drizzle do caminho auth, mantém limitação de transação e mesmo órfão                                | NO-GO reproduzido; não é solução                         |
| Release oficial futura com atomicidade/recuperação suportada em D1 | Preserva direção D1, depende de upstream e reexecução das regressões                                       | Não disponível na stable revalidada; sem prazo prometido |
| Better Auth + Drizzle/PostgreSQL com transação real                | Caminho documentado com transações; exige backend, operação, latência/egress e prova Workers/driver/falhas | Proposta alternativa, não executada/adotada              |

[Better Auth PostgreSQL](https://better-auth.com/docs/adapters/postgresql),
[Drizzle transactions](https://orm.drizzle.team/docs/transactions) e
[Cloudflare Hyperdrive/PostgreSQL](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)
sustentam a possibilidade de uma composição transacional; não provam sua
viabilidade no Holon nem eliminam automaticamente a janela específica de state.
Não se instalou pg, conectou banco ou criou binding Hyperdrive.

Se for escolhida persistência transacional alternativa, manter identidade,
tenancy, memberships, convites e outbox na mesma fronteira transacional evita
reintroduzir autoridade/efeitos divididos entre bancos. A projeção funcional
pode permanecer separada. Essa alteração requer revisão de decisão/grafo,
migrations, ambiente/backup/restore/custos e prova antes de auth/onboarding;
não é troca silenciosa da direção Better Auth+Drizzle/D1 aprovada pelo usuário.

Não são alternativas aceitas: associar órfão por email, hook que contorna linking,
GitHub ID agregado ao User sem recuperação suportada pelo core, cópia/patch do
adapter/core, monkey patch ou `transaction:true` em D1 sem suporte. A mudança de
email reproduzida mostra por que um workaround centrado em email não resolve
a identidade incompleta. Tenancy própria continua necessária e não corrige isso.

### Comandos e critérios de conclusão

Executados com Node 24.19.0 em 2026-10-05, no worktree isolado. Para reproduzir
após instalação centralizada do workspace:

```sh
pnpm --filter @holon/dashboard-auth-proof typecheck
pnpm --filter @holon/dashboard-auth-proof test:coverage
pnpm --filter @holon/dashboard-auth-proof test:viability
```

Durante iteração foram executados os bins locais `tsc`, `vitest --coverage` e
`vitest test/auth.viability.test.ts`, para evitar auto-sync pnpm concorrente.
O comando pnpm test inicial atualizou automaticamente a resolução após alteração
do manifest; instalação/lockfile foram coordenados pelo responsável do PR.

Resultado executado registrado: diagnósticos **15 testes verdes**, cobertura
integral de `src/**/*.ts`: 100% linhas/funções/statements e 96,42% branches,
acima dos thresholds existentes (90% linhas/funções/
statements e 85% branches); gate de viabilidade **4 falhas**, abrangendo cadastro
interrompido e state concorrente nos dois candidatos. Nenhum teste de produção foi
excluído da cobertura para atingir limite.

Para mudar NO-GO para GO, uma composição oficialmente suportada precisa passar
as regressões sem vincular pessoas por email, sem User órfão e sem callback
customizado para mascarar falta de suporte. Depois continuam as provas de
refresh distribuído/perda do par, reauth, tenancy/invites/outbox, ACL e browser
na integração escolhida. Essa suite não implementa tais fluxos nem os aprova.
Nenhum deploy, GitHub login real, recurso remoto ou segredo real foi utilizado.
