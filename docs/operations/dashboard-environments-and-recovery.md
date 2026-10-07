---
id: OPERATIONS-DASHBOARD-ENVIRONMENTS-RECOVERY
kind: reference
status: proposed
owners:
  - core-team
last-reviewed: 2026-10-07
related:
  - ../planning/dashboard-implementation-plan.md
  - ../research/2026-10-04-dashboard-email-delivery-investigation.md
  - ../research/2026-10-04-dashboard-read-model-investigation.md
---

# Ambientes e recuperação do dashboard

## Pergunta e limite

Como publicar e recuperar o MVP sem misturar identidade, efeitos de email,
projeções e recursos de preview/produção?

A fundação M1 tem manifests, tipos e comandos **locais**. Preview/produção e
recuperação remota continuam propostos, sem IDs/domínios/credenciais definidos.
Completar esses ambientes em operação autorizada conforme [deploy](deployment.md)
e ADRs vigentes. A fundação não autoriza migration remota, DNS, restore ou envio.

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

Não há comando remoto utilizável nessa configuração. Em promoção futura,
identificar a configuração homologada e binding reais; a aplicação remota será
um passo explícito `wrangler d1 migrations apply <binding> --remote --config
<configuração-homologada>`, com plano de recuperação, owner e autorização. Não
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

## Login GitHub: configuração e rotação do recorte M2

Responsável pela revisão de origens e permissões: `core-team`. O operador da
GitHub App/Cloudflare deve ser identificado na mudança operacional futura;
não há owner nominal, registro remoto ou credencial homologados nesta entrega.
O primeiro recorte implementa login social GitHub, não SSO corporativo.

| Ambiente      | Origem/baseURL                                        | Callback GitHub                                  | Estado                                                                         |
| ------------- | ----------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Local padrão  | `http://127.0.0.1:8794`                               | `http://127.0.0.1:8794/api/auth/callback/github` | Manifest local; autenticação requer secrets locais; não é registro real da App |
| Teste de auth | Origem loopback HTTPS sintética definida pelo harness | Mesma origem + `/api/auth/callback/github`       | GitHub controlado, D1 isolado e nenhum OAuth real                              |
| Preview       | Não definido                                          | Não definido                                     | Exige origem HTTPS não loopback explicitamente homologada e recursos próprios  |
| Produção      | Não definido                                          | Não definido                                     | Exige origem HTTPS não loopback homologada, distinta de preview                |

`validateGitHubAuthConfig` rejeita credenciais ausentes, URL com caminho/query/
fragmento/credencial, desenvolvimento fora de loopback e ambientes remotos sem
origem explicitamente homologada. As listas de preview e produção devem ser
disjuntas. Host/forwarded headers e nome da branch não definem baseURL/callback.
Ter uma URL HTTPS não representa homologação. O manifest local não oferece
configuração remota utilizável.

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
Sem nenhum secret auth, a fundação estática M1 permanece utilizável.

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
Este roteiro não executou criação de App, troca de secret, DNS, deploy, migration
remota ou smoke com provider real.

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
