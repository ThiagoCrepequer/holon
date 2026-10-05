---
id: RESEARCH-DASHBOARD-CODE-REDEMPTION-PLUGIN
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-05
related:
  - 2026-10-05-dashboard-auth-proof.md
  - 2026-10-05-dashboard-oauth-security-requirements.md
  - ../engineering/web-security-and-data-boundaries.md
---

# Plugin de reserva do authorization code GitHub

## Resultado e responsabilidade

O responsável autorizou o plugin em 2026-10-05. A composição privada de M0
usa Better Auth 1.7.7, linking nativo aprovado e uma reserva atômica D1 antes da
troca por token. O gate de #129 passa nos dois adapters: **GO local**. Isso
qualifica a composição; não instala auth no produto nem demonstra OAuth remoto.

O plugin implementa uma política Holon via API pública da biblioteca. Não é um
fix oficial do Better Auth nem ativação de uma implementação pronta. A primitiva
`consumeOne` já existe nos adapters, mas o parser OAuth da release lê e depois
apaga state. Há uma reprodução nativa sem plugin nos dois adapters, conservada
nos testes; não se modifica nem copia o parser para fazer o gate passar.

Implementação e regressões:

- [`github-code-redemption-plugin.ts`](../../tooling/dashboard-auth-proof/src/github-code-redemption-plugin.ts):
  registra a política por `init(context)` e decora somente o provider GitHub nativo.
- [`github-code-redemption.ts`](../../tooling/dashboard-auth-proof/src/github-code-redemption.ts):
  digest, exclusão mútua durável, expiração e limpeza limitada.
- [`github-code-redemption.test.ts`](../../tooling/dashboard-auth-proof/test/github-code-redemption.test.ts):
  callback público, persistência D1 e falhas do limite externo.
- [`auth.viability.test.ts`](../../tooling/dashboard-auth-proof/test/auth.viability.test.ts):
  recuperação e uma token request por code, incluídas em `test`, `test:coverage`
  e portanto `pnpm verify`/CI. O comando focado permanece disponível.

## Ordem e fronteira de segurança

O callback nativo valida state, cookie assinado, prazo e contexto antes de
chamar `validateAuthorizationCode`. Nesse ponto o plugin calcula SHA-256 de
uma tupla com propósito, GitHub.com, client ID e code; a tupla JSON impede
ambiguidade de concatenação. A chave independe de state, redirect, isolate e
instância auth: novo state não libera o mesmo code para o mesmo cliente.
Providers/clientes distintos não partilham a autoridade do mesmo code.

D1 executa limpeza e `INSERT ... ON CONFLICT DO NOTHING RETURNING fingerprint`
no mesmo `batch`. A chave primária dá um vencedor; somente o retorno positivo
validado permite delegar ao provider original. Zero rows nega replay. Falha
lançada, resultado inválido/ambíguo ou indisponibilidade nega antes de egress.
Não há leitura seguida de escrita, mutex local, KV, transaction interativa ou
retry de token. São preservados PKCE, client credentials, redirect URI,
consulta de perfil, linking, criptografia e sessão nativos.

A reserva ocorre antes de o servidor externo confirmar PKCE. Um atacante que
já conheça o code de outra transação e possua seu próprio state/cookie válido
pode queimá-lo com um verifier diferente; não ganha identidade/sessão, mas pode
forçar novo OAuth da vítima. É o custo da política de não reutilização, não
prova de posse do code. Codes imprevisíveis, ausência de logs/URLs de callback
em telemetria e rate-limit continuam necessários. Não particionar o marcador
por verifier para evitar esse custo: isso permitiria repetir o mesmo code.

A reserva persiste **antes** da requisição externa. Crash depois dela, token
recusado, timeout ou resposta perdida nunca a removem. Sacrifica-se a retomada
daquela credencial para impedir repetição; o usuário inicia novo OAuth. Uma
falha posterior de Account/Session também exige novo fluxo e conserva a
recuperação por linking verificado. Isso não promete transação entre D1 e
GitHub, entrega exatamente uma vez, rollback User/Account ou retomada de code.
A política de retry de email Q37 não autoriza retry de credencial OAuth.

Há exatamente um provider `github` estático; configuração ausente/dinâmica ou
colisão com provider de plugin falha na inicialização. Outros providers não são
qualificados por esta prova e continuam negados na superfície pública. A
integração futura deve controlar a lista/ordem de plugins: um plugin posterior
que substitua o provider ou exponha outro token endpoint poderia contornar esta
política. Repetir o gate na composição final, sem caminho paralelo de troca.

## Schema, retenção e manutenção

A fixture adiciona tabela própria `github_code_redemption`, com
`fingerprint TEXT PRIMARY KEY`, `expires_at INTEGER NOT NULL` em segundos UTC e
índice `(expires_at, fingerprint)`. O ORM de User/Account não gere essa tabela.
Ela guarda somente digest e expiração; não contém code, verifier, tokens, email,
User ou membership, não cria autoridade e não entra no DTO público.

A reserva dura **24 horas desde a primeira tentativa**, medida pelo relógio
SQLite/D1, sem renovação em duplicatas. A limpeza remove no máximo **100**
linhas com `expires_at <= now` por transação, ordenadas pelo índice; jamais
remove uma reserva viva. Se o INSERT falha, a limpeza sofre rollback junto.
A expiração é retenção de um marcador de replay, **não lease para retry**.

A documentação de web OAuth do GitHub.com informa validade de code de dez
minutos; a margem de 24 h cobre esse intervalo com folga. A página específica
GitHub App documenta os mesmos endpoints e PKCE, mas não repete esse prazo.
Aplicar o prazo também a GitHub App é uma inferência, não medição remota: o
smoke da configuração escolhida deve confirmar expiração antes da promoção.
GHES e novos providers exigem qualificação própria. Se o prazo deixar de ser
limitado por uma garantia do provider, suspender a limpeza/admissão antes de
reduzir a proteção. A RFC recomenda prazo curto; não prova o prazo do GitHub.

Após retenção, um code antigo pode chegar novamente ao token endpoint e deve
ser negado por expirado. Não se promete deduplicação de valores opacos para
sempre. O teste modela esse limite: limpa o marcador expirado, o servidor
sintético nega o code antigo e um code novo permite login. Nenhuma limpeza
reabre um code válido no modelo qualificado.

Cada callback validado drena um lote. `pruneExpiredGithubCodes` oferece a mesma
limpeza limitada para manutenção em períodos sem login; invocações sucessivas
esgotam o backlog sem bloquear um request com loop ilimitado. M0 não tem Worker
implantável/scheduler: não alegar remoção física automática durante ociosidade.
Na implementação de `packages/auth`/API (#140), integrar a manutenção ao
scheduler autorizado, definir cadência/capacidade e alertar por falha/atraso,
com métricas sem payload. Não criar outro Worker só para esta tabela. Uma falha
de limpeza não libera credencial; acumula apenas metadados de replay. Migração
produtiva e operação pertencem à entrega de produto, não à fixture de M0.

## Evidência e limites

O gate é executado em Workerd/D1 locais com ambos os adapters oficiais; somente
HTTP do GitHub e falhas de bindings/relógio do servidor externo são controlados.
A prova cobre duas instâncias auth compartilhando D1, novo state, cookies
inválidos/estranhos, state expirado, falha de reserva, rollback de limpeza,
resposta de token perdida, recuperação, client IDs distintos, resposta D1
malformada, configuração ambígua, expiração e manutenção retomada.

A falha original foi observada primeiro com o assert existente: duas token
requests em vez de uma nos dois adapters. Após o plugin, esse mesmo assert
passa. A limpeza falhou primeiro com 101 marcadores expirados restantes;
depois a prova confirmou lotes de 100 preservando todas as reservas vivas.
Nenhum threshold foi reduzido, teste marcado como falha esperada ou código
produtivo excluído da instrumentação. Diagnóstico nativo e gate da composição
têm expectativas distintas porque exercitam configurações explicitamente
identificadas; o modo nativo não é fallback para produção.

Esses testes não provam coordenação regional, crash físico, failover/restore
D1 remoto, enforcement PKCE/downgrade/expiração no GitHub real ou entrega de
scheduler. Uma restauração que apague reservas vivas exige interromper callbacks
e invalidar fluxos pendentes durante a janela de validade externa; não colocar
um D1 vazio em serviço como se conservasse a exclusão mútua anterior.
Logs futuros devem traduzir falhas para códigos operacionais, nunca registrar
params, exceção arbitrária, cookies ou resposta do provider.

## Fontes primárias

Conferidas em **2026-10-05**:

- [Plugins Better Auth](https://better-auth.com/docs/concepts/plugins) e
  [genericOAuth 1.7.7](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/plugins/generic-oauth/index.ts):
  extensão pública de contexto/providers por `init` usada pela própria biblioteca.
- [Callback 1.7.7](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/api/routes/callback.ts) e
  [state 1.7.7](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/state.ts):
  ordem de validação e janela find/delete preservadas.
- [D1.batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch):
  transação sequencial com rollback se um statement falha;
  [relógio SQLite](https://www.sqlite.org/lang_datefunc.html) para `strftime`/UTC.
- [Web OAuth GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#2-users-are-redirected-back-to-your-site-by-github) e
  [GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app):
  prazo documentado e diferença de explicitude entre as fontes.
- [RFC 6749 §4.1.2](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.1.2) e
  [avaliação PKCE/CSRF](2026-10-05-dashboard-oauth-security-requirements.md):
  não reutilização de code é independente da defesa de CSRF.
