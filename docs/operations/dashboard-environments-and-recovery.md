---
id: OPERATIONS-DASHBOARD-ENVIRONMENTS-RECOVERY
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
related:
  - ../planning/dashboard-implementation-plan.md
  - ../research/2026-10-04-dashboard-email-delivery-investigation.md
  - ../research/2026-10-04-dashboard-read-model-investigation.md
---

# Ambientes e recuperação do dashboard

## Pergunta e limite

Como publicar e recuperar o MVP sem misturar identidade, efeitos de email,
projeções e recursos de preview/produção?

A fundação M1 tem manifests, tipos e comandos locais. A operação autorizada em
2026-10-08 provisionou os D1 de produção e suas migrations. O ambiente de
bootstrap publicou a fundação estática com autenticação desabilitada. A ativação
posterior pelo responsável cadastrou os secrets GitHub e habilitou auth; o
manifest de produção acompanha esse estado com `AUTH_ENABLED=true`. O OAuth
real ainda não foi validado. Preview e recuperação
remota continuam propostas. O pipeline automático do core não publica esses apps.

## Bootstrap de produção

Conta Cloudflare: `4be6ae7d1bb4a3b2a395c6d30e2671a5`. Owner operacional desta
provisão: Thiago Crepequer. Os recursos são exclusivos destes apps:

| Recurso         | Nome / valor                                                | Estado                                                                                    |
| --------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Dashboard       | `holon-dashboard`                                           | Publicado; origem `https://holon-dashboard.thiago-crepequer.workers.dev`; auth habilitado |
| Email           | `holon-email-delivery`                                      | Publicado privado; sem rota pública, URL de preview, Queue ou envio implementado          |
| `IDENTITY_DB`   | `holon-identity` / `52a95f05-168f-4702-a064-10934931d3c8`   | Migrations `0001`–`0005` aplicadas; autoridade `identity`                                 |
| `PROJECTION_DB` | `holon-projection` / `af121530-2f99-4d01-8155-c20efc040a3b` | Migration `0001` aplicada; autoridade `projection`                                        |

A provisão usou a API Cloudflare, após conferir a conta e os recursos existentes.
O D1 antigo `holon-admin-d1` não pertence a esta entrega. Os bancos novos estavam
vazios; os receipts `d1_migrations`, as autoridades e `PRAGMA foreign_key_check`
foram conferidos. A API de importação SQL preserva os corpos dos triggers; não
dividir os arquivos por ponto e vírgula para aplicar migrations. Depois da
primeira provisão, usar os receipts e Time Travel antes de novas mudanças de
schema; rollback de Worker não desfaz uma migration.

O manifest padrão permanece local. Para construir o artefato de produção:

```sh
CLOUDFLARE_ENV=production pnpm --filter @holon/dashboard build
pnpm --filter @holon/email-delivery exec wrangler deploy --env production --dry-run --outdir dist
```

O deploy do dashboard precisa usar `apps/dashboard/build/server/wrangler.json`
gerado pelo build de produção e seus assets em `build/client`. Não publicar
diretamente o TypeScript do manifest de origem. A publicação via API envia os
assets, os módulos compilados e os bindings do mesmo artefato revisado. Somente
o dashboard tem workers.dev habilitado; ambos têm preview URLs desabilitadas.
Invocation logs ficam desabilitados para não capturar URLs de callback OAuth.

`AUTH_ENABLED=false` é bootstrap explícito: a fundação estática e liveness
funcionam, mas auth e tenancy privadas permanecem indisponíveis. O secret
`AUTH_SECRET` pode ser provisionado nessa fase sem tornar a configuração parcial
uma falha global. Não gerar outra chave ao ativar GitHub. A chave protege cookies
e tokens criptografados, e sua rotação exige o procedimento específico abaixo.

### Evidência da publicação inicial

Publicação via API em **2026-10-08**, com 100% de tráfego nas versões abaixo.
Artefato de origem: commit `58749c416d0b4d587ee06889e5304ad3945d6138`, branch
local `codex/dashboard-production-bootstrap`, baseada em `main` após o merge
do PR #171. Esta operação não fez push nem alterou o pipeline automático.

| Worker                 | Versão Cloudflare                      | Horário UTC            | Superfície                                     |
| ---------------------- | -------------------------------------- | ---------------------- | ---------------------------------------------- |
| `holon-dashboard`      | `b6df419e-9f66-4f5f-b283-aab4f336506a` | `2026-10-08T02:46:30Z` | workers.dev habilitado; previews desabilitados |
| `holon-email-delivery` | `c4946809-d9f4-439e-a28b-a8ff02338b2b` | `2026-10-08T02:46:00Z` | workers.dev e previews desabilitados           |

A API confirmou os dois bindings D1, as vars de produção, o nome do secret
`AUTH_SECRET` (gerado sem exposição do valor) e observabilidade sem invocation
logs. `pnpm verify`, build de produção e dry-runs passaram. Smoke HTTPS confirmou
documento SSR 200 com CSP nonce, `nosniff`, `no-referrer` e `private, no-store`;
asset JS 200 com cache immutable; health 200; auth 404 e workspaces 503 no
bootstrap; POST de origem não confiável 403. Chromium validou hidratação,
troca pt-BR/en e modal sem erro de página ou violação CSP em **2026-10-08T02:46:48Z**.
Essas amostras não provam OAuth GitHub, tenancy autenticada, projeções ou envio
real de email. O envio permanece um stub privado sem Queue/provider.

### Alinhamento após a configuração de auth

O responsável configurou os secrets GitHub e `AUTH_ENABLED=true` no Worker.
A versão ativa passou a `86f5345f-21d5-4b68-9ee8-8dcdfa443969`, publicada pelo
dashboard Cloudflare em **2026-10-08T02:52:07Z**. Em **2026-10-08T02:58:55Z**,
a API confirmou `AUTH_ENABLED=true` e os nomes `AUTH_SECRET`,
`GITHUB_APP_CLIENT_ID` e `GITHUB_APP_CLIENT_SECRET`, sem recuperar seus valores.
A leitura anônima de `/api/auth/session` respondeu 200 com `null`.

O manifest versionado e o gate de build de produção exigem agora
`AUTH_ENABLED=true`, para que uma publicação futura não desfaça essa
configuração. Essa alteração de código não executa um novo deploy. A leitura de
sessão comprova a composição ativa, mas não valida as credenciais no GitHub,
callback, login ou logout reais. Nesse artefato publicado não existia página
`/login` nem botão de login. O complemento M2 acrescenta o botão mínimo na
página `/`, além de reconexão, dispositivos e preferências; esses controles só
chegam a produção após a operação de rollout correspondente. O onboarding
completo pertence à #159 e o smoke produtivo à #167.

## Operação local materializada

Na raiz, com Node >=24.11 <25 e pnpm 11.24.0:

```sh
pnpm install --frozen-lockfile
pnpm --filter @holon/db migrate:identity:local
pnpm --filter @holon/db migrate:projection:local
pnpm --filter @holon/dashboard dev
pnpm --filter @holon/dashboard build
pnpm --filter @holon/email-delivery build
pnpm --filter @holon/dashboard exec playwright install chromium firefox webkit
pnpm verify
```

Os scripts de migration têm `--local` fixado e apontam aos manifests reais;
builds só fazem dry-run. Vitest usa D1/DO isolados; Playwright inicia Wrangler
local na porta 8794 após o build. O dev usa origem exata do manifest e porta
8794; não inferir origem confiável do Host para acomodar outro hostname.

Os nomes `holon-dashboard-local`, `holon-email-delivery-local`, os dois nomes D1
`holon-identity-local`/`holon-projection-local` e UUIDs `00000000-0000-4000-8000-000000000001/2`
são locais/sintéticos. Ambos os D1 têm `remote: false`; URLs workers.dev e preview
estão desligadas. Esses IDs não representam recursos Cloudflare. O estado local
é descartável, mas não apagar migrations versionadas para resetar dados.

O manifest padrão não representa um ambiente remoto. Na configuração de produção,
uma migration remota futura requer autorização e será um passo explícito
`wrangler d1 migrations apply <binding> --remote --env production --config
apps/dashboard/wrangler.jsonc`, com plano de recuperação e owner. Não
reutilizar os UUIDs locais nem tratar `--local`/`--remote` como flags intercambiáveis.

`/api/health` é liveness, sem verificar schema/auth/provider. M2/M5 compõem
`assertReady` dos adapters e readiness apropriada; não interpretar HTTP 200 da
fundação como produto pronto. O pipeline de deploy do core não inclui estes apps.

## Composição por ambiente

| Ambiente           | Dados e limites                                                             | Efeitos permitidos                                                          |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Teste local/CI     | Identidade/PRs sintéticos, D1/DO isolados, sem tokens reais                 | Fakes/Workerd/browser; sender controlado, sem GitHub/email reais            |
| Preview homologado | Recursos não produtivos próprios, callbacks/origens exatos, acesso restrito | Somente smokes explicitamente autorizados; destinatários de teste restritos |
| Produção           | Bindings, banco, Queue/DLQ, domínio e key material identificados            | Operação publicada e autorizada; sem herdar credenciais/dados de preview    |

Não ligar preview a D1 de produção, produção à fila de testes ou testes a binding
`remote: true` por conveniência. Cron, consumer e origem de links também são por
ambiente. O email Worker privado não expõe envio por HTTP; configuração deve
desabilitar rotas públicas e URLs auxiliares efetivas. `workers_dev: false` não
desliga sozinho URLs de preview/versionamento: declarar configuração aplicável
e comprovar a superfície real. [Workers URLs](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/),
[configuração Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/).

GitHub App/OAuth callback de homologação tem registro separado ou URIs explícitas
suportadas, sem wildcard confiando em qualquer branch. Rotação de credenciais
usa mecanismo suportado da integração aprovada e dono operacional; registrar
efeito sobre sessões/tokens antes de trocar key material. Não copiar secrets
para fixtures, logs, bundle, documentos ou artefatos de CI.

## Migrações, artefatos e rollout

1. Registrar SHA/lockfile, versões do runtime e bibliotecas, compatibility date,
   migrations, IDs de recursos e grafo de bindings do artefato revisado.
2. Construir/testar/dry-run sem aplicar migrations ou criar recursos. Separar
   explicitamente instalação, geração e aplicação local/remota de schema.
3. Aplicar somente migrations revisadas, com backup/ponto de recuperação e
   verificação de constraints/índices. Não editar migrations já aplicadas.
4. Coordenar publicação dos contratos atuais entre dashboard, core e sender,
   distinguindo import de código de service binding runtime. Não criar ciclo
   de imports entre apps ou fallback de contrato antigo para ocultar rollout.
5. Validar mesmo artefato/SHA, callbacks, origem/cookie/CSRF, autorização privada,
   alarm/projeção, publisher/consumer e sender antes de abrir tráfego geral.
6. Ampliar rollout somente com sinais e smokes definidos. Rollback de código
   não reverte schema ou efeito externo; confirmar compatibilidade do artefato
   anterior com schema corrente ou usar recuperação coordenada.

Este roteiro não exige ferramenta nova por iniciativa do agente. Enquadrar
dashboard/email no fluxo de CI/deploy real em decisão própria; ADR-0048 não
prova que novos Workers já estão cobertos. Não ressuscitar admin/read model antigo.

## Publicação da conclusão de M2

O bootstrap de produção descrito acima aplicou as migrations de identidade
`0001`–`0005` e a migration inicial de projeção. Isso não demonstra que as
migrations posteriores já tenham sido aplicadas. O complemento M2 acrescenta
`0006_membership_governance_and_reauth.sql` e `0007_user_preferences.sql`
na identidade; não altera as cinco migrations aplicadas nem a projeção.
A conclusão local de M2 e a integração de seu PR não publicam automaticamente
`holon-dashboard`.

Antes de publicar esse artefato, em operação autorizada:

1. Confirmar conta, D1 de identidade, SHA e lista de migrations pendentes pelo
   manifest de produção; preservar os receipts anteriores e o ponto de recuperação.
2. Conferir as invariantes existentes, inclusive equipes sem owner, e revisar
   as migrations aditivas. Não transformar erro de preflight em reset de dados.
3. Aplicar somente as migrations revisadas no D1 de identidade, conferir
   receipts e `PRAGMA foreign_key_check`, e publicar o Worker correspondente.
4. Validar sessão anônima, OAuth autorizado, preferência em outro dispositivo,
   logout atual/todos e negação de uma sessão revogada na request seguinte.
   Separar esse smoke real da prova Workerd/D1 com provider controlado.

Rollback de Worker não desfaz schema nem revogação. Restore de D1 pode reviver
sessões ou provas de reautenticação; seguir as restrições de recuperação abaixo
antes de reabrir tráfego. Os comandos locais de migration continuam com
`--local`; a tarefa de implementação/PR não autoriza aplicar novas migrations
remotas, alterar credenciais ou publicar Workers.

### Sessões e preferências: recuperação mínima

A página `/` oferece login GitHub e recuperação de sessão perdida; não há uma
rota `/login`. Após expiração/revogação, o novo login usa outro fluxo OAuth.
Reapresentar code/state consumidos não recupera sessão. O controle de dispositivos
lista apenas sessões próprias; logout atual/global limpa cookies pelo SDK.
Outro dispositivo perde admissão na próxima request. A UI detecta essa perda
na próxima leitura/intenção explícita e não consulta por timer/foco/visibilidade.
Uma sessão diferente fecha o contexto antigo e revalida SSR, preservando a nova
sessão permitida; uma aba parada não recebe limpeza instantânea.

Para preferências, ler `GET /api/preferences` após resultado desconhecido ou
repetir o mesmo POST `{ locale, timezone }`, preservando sessão/CSRF válidos.
O UPSERT mantém uma linha por User; o retry não cria equipe nem dispara review.
`command_unknown` não é prova de rollback. Perfil corrompido/indisponível exige
corrigir o storage; não remover dados para simular preferência ausente.

### Governança: confirmação e resultado desconhecido

Os quatro comandos de equipe — promoção, rebaixamento, remoção e saída —
precisam de uma intenção criada por POST `/api/auth/reauth/init`, seguida de
novo OAuth GitHub com `reauthIntentId`. A intenção pendente vence em 10 minutos;
prova confirmada vence 5 minutos depois do callback e pertence à nova sessão,
ação, equipe e alvo originais. Renovação comum não satisfaz essa exigência.
Após negação/expiração, revalidar sessão e membership e criar outra intenção;
não reutilizar code/state ou modificar prazos/prova diretamente no banco.

Se a escrita retornar `command_unknown`, consultar workspaces/membership atuais
antes de decidir outro comando. Consumo e efeito são transacionais, mas perder
a resposta não prova rollback. Replay de prova consumida é negado e não deve
recriar membership. A negação do último owner exige promover outro participante
existente antes de sair/rebaixar/remover; não apagar triggers para contorná-la.
Uma sessão humana continuar válida após remoção não concede acesso à equipe.

## Login GitHub: configuração e rotação do recorte M2

Responsável pela revisão de origens e permissões: `core-team`. O operador da
provisão Cloudflare é Thiago Crepequer; as credenciais e alterações no registro
da GitHub App ainda exigem ação de seu responsável.
O primeiro recorte implementa login social GitHub, não SSO corporativo.

| Ambiente      | Origem/baseURL                                         | Callback GitHub                                  | Estado                                                                         |
| ------------- | ------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Local padrão  | `http://127.0.0.1:8794`                                | `http://127.0.0.1:8794/api/auth/callback/github` | Manifest local; autenticação requer secrets locais; não é registro real da App |
| Teste de auth | Origem loopback HTTPS sintética definida pelo harness  | Mesma origem + `/api/auth/callback/github`       | GitHub controlado, D1 isolado e nenhum OAuth real                              |
| Preview       | Não definido                                           | Não definido                                     | Exige origem HTTPS não loopback explicitamente homologada e recursos próprios  |
| Produção      | `https://holon-dashboard.thiago-crepequer.workers.dev` | Mesma origem + `/api/auth/callback/github`       | Auth habilitado; secrets cadastrados; OAuth real ainda não validado            |

`validateGitHubAuthConfig` rejeita credenciais ausentes, URL com caminho/query/
fragmento/credencial, desenvolvimento fora de loopback e ambientes remotos sem
origem explicitamente homologada. As listas de preview e produção devem ser
disjuntas. Host/forwarded headers e nome da branch não definem baseURL/callback.
Ter uma URL HTTPS não representa homologação. `AUTH_ENVIRONMENT` seleciona a
política e `AUTH_REGISTERED_ORIGINS` fornece um JSON estrito com listas `preview`
e `production`. O manifest de produção registra explicitamente a origem acima;
o manifest local não oferece configuração remota utilizável.

O modo é **GitHub App**. User access tokens usam permissões da App e não os
scopes de OAuth Apps; `disableDefaultScope: true` evita os scopes padrão do
provider. Para obter email no fluxo nativo, revisar **Account permissions → Email
addresses: Read-only**. Login não exige permissão de escrita em repositório,
não instala a App, não conecta instalação ao workspace e não concede acesso
privado. Permissões de review/instalação pertencem às integrações do core.

Os valores `AUTH_SECRET`, `GITHUB_APP_CLIENT_ID` e `GITHUB_APP_CLIENT_SECRET`
são entradas da composição servidor. O client ID da App não é o App ID nem
a chave privada usada pelo core para tokens de instalação. Secrets reais ficam
no armazenamento de secrets do Worker/ambiente; nunca em vars versionadas,
fixtures, linha de comando, logs, bundles ou screenshots. Em desenvolvimento,
usar arquivo local ignorado e credenciais próprias de desenvolvimento; não
copiar material de produção. A chave auth tem pelo menos 32 caracteres. Origem ausente, trio parcialmente
configurado e auth habilitado sem IDENTITY_DB fecham com 503 sanitizado.
Sem nenhum secret auth, a fundação estática M1 permanece utilizável. Com
`AUTH_ENABLED=true`, o trio completo e `IDENTITY_DB` são obrigatórios.

### Obter e configurar credenciais por ambiente

Na produção acima, o responsável já cadastrou os secrets. O procedimento abaixo
orienta novos ambientes ou mudanças autorizadas; não recriar secrets existentes
apenas para reproduzir o deploy.

1. No GitHub, abrir **Settings → Developer settings → GitHub Apps** da conta
   proprietária, ou **Organization settings → Developer settings → GitHub Apps**
   se a App pertencer a uma organização. Abrir **Edit** da App Holon existente.
2. Em **General**, copiar o **Client ID** e gerar um **Client secret**. Não usar
   App ID, chave privada ou installation token nesses campos.
3. Registrar a callback exata
   `https://holon-dashboard.thiago-crepequer.workers.dev/api/auth/callback/github`.
   Preservar as callbacks e configurações utilizadas por outros consumidores da
   App. Em **Permissions & events → Account permissions**, conferir
   **Email addresses: Read-only**. Não alterar webhook/instalações do core como
   parte da ativação do login.
4. No Cloudflare, abrir **Workers & Pages → holon-dashboard → Settings →
   Variables and Secrets**. Adicionar como secrets `GITHUB_APP_CLIENT_ID` e
   `GITHUB_APP_CLIENT_SECRET`. `AUTH_SECRET` é provisionado separadamente e não
   deve ser substituído. Não enviar os valores em chat ou commit.
5. Conferir `AUTH_ENABLED=true` no ambiente de produção versionado,
   construir/publicar o novo artefato e executar OAuth real com usuário de teste,
   callback, logout, novo login e isolamento de workspace. Sem esse smoke, não
   declarar login real validado. Não habilitar auth enquanto faltar um secret.

Alternativa pelo CLI, com entrada interativa dos valores (comandos separados):

```sh
pnpm --filter @holon/dashboard exec wrangler secret put GITHUB_APP_CLIENT_ID --env production
pnpm --filter @holon/dashboard exec wrangler secret put GITHUB_APP_CLIENT_SECRET --env production
```

O arquivo `.env.cloudflare` contém somente o token para operar a API; ele não é
o armazenamento dos secrets de runtime. O token desta provisão exige **D1 →
Edit**, restrito à conta correta, e a role **Admin** no escopo do produto
**Workers** para criar os dois Workers. Após a criação, o acesso de publicação
pode ser reduzido a **Editor** apenas em `holon-dashboard` e
`holon-email-delivery`. Editor não permite criar novos Workers. O operador
configura essas permissões em **Manage Account → Account API Tokens**.
O nome legado `Workers Scripts → Edit` está sendo substituído pelas roles;
consultar [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/),
conferido em **2026-10-08**. As credenciais da GitHub App não são recuperáveis
por esse token.

Procedimento a preparar na operação autorizada:

1. Fixar ambiente, registro da GitHub App, owner, origem/callback exatos,
   bindings D1 e SHA do artefato. Conferir isolamento de credenciais e dados.
2. Gerar novo client secret no registro correspondente e inseri-lo pelo
   mecanismo interativo/secret store do ambiente, sem imprimir seu valor.
3. Publicar o artefato autorizado e validar login existente, login novo,
   callback/PKCE/state, logout e recuperação por novo OAuth com usuário de teste.
   Somente então remover a credencial anterior e registrar resultado sem tokens.
4. Tratar `AUTH_SECRET` separadamente: ele protege cookies e a criptografia
   nativa de tokens persistidos. Não substituí-lo cegamente. Uma mudança exige
   plano suportado pela versão fixada, tratamento de sessões/tokens existentes
   e prova de reconexão/recuperação antes de retomar tráfego. O recorte não
   implementa migração de chave nem serviço de refresh/grants privados.

Tokens access/refresh são criptografados desde a primeira persistência pelo
Better Auth. Isso não demonstra refresh remoto: não há acesso privado nem
renovação de grants implementados. Estado/code consumidos não são retries;
resultado desconhecido exige novo OAuth. Restauração de D1 precisa preservar
reservas vivas ou suspender callbacks pendentes conforme a política abaixo.

Fontes primárias conferidas em **2026-10-07**:
[user access tokens e callback/PKCE GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app),
[provider GitHub do Better Auth](https://better-auth.com/docs/authentication/github)
e [accounts/linking/tokens](https://better-auth.com/docs/concepts/users-accounts).
Configuração operacional conferida em **2026-10-08**:
[ambientes do Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/),
[upload direto de assets](https://developers.cloudflare.com/workers/static-assets/direct-upload/),
[importação SQL D1](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/)
e [Client ID/secret da GitHub App](https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-login-with-github-button-with-a-github-app).
O bootstrap não criou nem alterou a GitHub App, DNS ou credenciais GitHub, e não
executou smoke com provider real. A provisão dos bancos e migrations remotas é
registrada acima, junto das versões publicadas, SHA e limites dos smokes.

## Estado observável e condições de intervenção

| Autoridade      | Sinais mínimos sem conteúdo privado                                                                                              | Intervenção                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Auth/GitHub     | Falha de callback, refresh perdido/contendido, reconexão requerida, negações/erros classificados                                 | Corrigir integração; não conceder acesso nem fundir User por email                 |
| Email D1        | Idade de intenção, publicado sem conclusão, lease vencido, próximas ações, tentativas totais, resultado desconhecido/falha final | Reconciliador cobre não terminais; revisar causa de falha terminal antes de replay |
| Queue/DLQ       | Backlog, idade/retention, retries e encaminhamento                                                                               | Relacionar com D1; mensagem não é registro final de negócio                        |
| Ledger/projeção | Revisão pendente/confirmada, idade da obrigação, alarm/rearmamento e lag                                                         | Recuperar tarefa e snapshot autoritativo; preservar cleanup e outras obrigações    |

Eventos usam IDs opacos, códigos previstos, revisões, contagens, duração e
resultado. Não incluir email, título/autor, conteúdo de PR, token/link, corpo de
provider ou erro arbitrário. Também revisar invocation URLs/query strings e
logging nativo; logger sanitizado no app não sanitiza automaticamente a plataforma.
Email preview de produção deve estar desligado/conferido conforme pesquisa.

Alertas e prazo de intervenção não podem ficar sem dono. Antes de publicar,
fixar responsável, latência/deadline de entrega, limite de lag, retenção e prazo
de atendimento, derivados da carga/política aprovada. Backoff/jitter e orçamento
do job precisam caber no prazo útil do convite e na retenção configurada. Não
usar disponibilidade da DLQ como garantia de recuperação ilimitada.

## Recuperação sem repetir efeitos cegamente

Primeiro registrar ambiente/IDs, incidente e ponto de recuperação; manter
evidência mínima e obter autorização da operação. Consultar estado atual antes
de qualquer replay. Reenvio preserva ID, alvo, estado, deadline e orçamento;
aceito/cancelado/expirado não produz outro ingresso. Q37 cobre duplicação limitada
de mensagem sob resultado desconhecido, não retry indiscriminado de refresh OAuth.

Restore de banco pode reviver sessão revogada, convite consumido, lease ou job
antigo. Portanto a restauração de identidade não deve imediatamente reabrir
tráfego/sender: revalidar/inutilizar sessões e grants afetados, reconciliar convites
e efeitos conhecidos, classificar efeitos incertos e definir orçamento atual antes
de retomar. Se a história durável necessária se perdeu, preservar modo seguro e
exigir reconexão/reconciliação, sem inventar sucesso ou reiniciar contadores.

DO e D1 não têm restore atômico comum. Se ledger retornar a uma revisão inferior
à projeção, o UPSERT monotônico a rejeitará. Isolar o escopo afetado, recuperar a
autoridade e reconstruir/reconciliar sua projeção explicitamente sob um plano
operacional autorizado; preservar snapshot de rollback. A barreira suspende
produtores **e escritas da projeção**, não apenas tráfego do dashboard. Entregas
anteriores ao restore ainda em trânsito não podem reaplicar revisão alta depois
da reconstrução ou da retomada.

O candidato de barreira usa geração de recuperação persistida por escopo,
conferida na gravação e capturada junto do snapshot **antes** de I/O. Recuperação
coordenada, com ingress/consumers suspensos, instala uma geração nova em autoridade
e destino, reconstrói e só então reabre o escopo. Destino rejeita geração antiga;
retry reobtém snapshot autoritativo, sem remarcar payload antigo com geração nova.
Geração causal não é versão/compatibilidade de schema. Provar o mecanismo real
antes da publicação, inclusive entrega tardia pós-retomada e falha em cada passo.
Não resetar revisão silenciosamente, aceitar payload antigo como novo ou criar compatibilidade de
schemaVersion. Recuperar a projeção atual é distinto de importar histórico de PRs.

Testar restore/reconciliação com dados sintéticos antes da publicação. Exercitar
jobs já aceitos, convite cancelado, sessão revogada, ledger com revisão inferior
e obrigação sem wake-up. Incluir snapshot antigo retido em trânsito chegando
após reconstrução/retomada, que deve ser rejeitado pela barreira. Reconstrução
do derivado pode consultar autoridades por ID nesse procedimento; a lista
normal continua sem fan-out por linha.

Cloudflare documenta [Time Travel D1](https://developers.cloudflare.com/d1/reference/time-travel/)
e [PITR SQLite DO](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api).
Confirmar retenção/plano/IDs/pontos disponíveis no ambiente operado; a capacidade
documentada não significa que uma restauração tenha sido ensaiada ou autorizada.
Fontes verificadas em **2026-10-04**; nenhuma operação foi executada nesta revisão.

## Recuperação HTTP da fundação M1

A #137 usa rate limits técnicos na autoridade D1 de identidade, com migration
aditiva `0004_rate_limit.sql`. A migration aditiva `0005_tenancy_mutation_guard.sql`
acrescenta o marcador transitório da admissão na batch: commit/rollback deixam a
tabela vazia. Não é fila, lease ou recibo que deva ser retomado por operador. Eles não representam quotas comerciais nem
autorização. Excesso de taxa responde 429 `rate_limited` com `Retry-After`;
indisponibilidade de storage fecha o efeito com erro sanitizado. Esperar a
janela antes de repetir; não apagar budgets ativos como mecanismo de retry.
A política e sua evidência estão em [segurança web](../engineering/web-security-and-data-boundaries.md)
e [revisão final M1](../research/2026-10-07-dashboard-milestone-one-final-review.md).

Em `command_unknown`, preservar a operation ID e o payload da intenção: a equipe
pode ter sido gravada mesmo sem confirmação. O retry idempotente reconcilia a
operação existente; não gerar outra ID para contornar o erro. `invalid_request`
por colisão indica uma intenção diferente com o mesmo ID. `reconnect_required`
fecha leituras privadas até novo OAuth. Nenhuma dessas condições autoriza
reset de banco, reviver sessão, ampliar egress ou conceder permissão.

Gates de integração de convites/email/conteúdo continuam em #148/#149, #152,
#157/#158, #159, #161 e #163. Essa fundação não comprova envio, Markdown real,
serviços externos ou ambiente remoto.
