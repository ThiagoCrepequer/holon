# Prova local de autenticação do dashboard

Workspace privado, sem Worker implantável, auth produtiva, secrets reais ou
scripts de deploy. Better Auth 1.7.7/Drizzle 0.45.3 são executados em Workerd/D1
locais pelo plugin oficial Cloudflare; somente a rede GitHub é sintética.

A composição aprovada em **2026-10-05** usa linking nativo com email verificado
recebido/local (`trustedProviders: []`) e plugin Holon de reserva atômica do
code. `init(context)` decora o provider GitHub nativo após validação de state,
cookie e prazo. D1 persiste apenas digest e expiração antes da token request;
conflito/falha nega egress. Resultado incerto não libera a reserva: novo OAuth
recupera. Não há patch/copiação de core ou transação interativa D1.

`pnpm --filter @holon/dashboard-auth-proof test` executa **101 cenários**,
incluindo os quatro asserts de viabilidade. `test:viability` é o comando focado
e agora passa; não existe exclusão desse arquivo em `test`/`test:coverage`.
`test:coverage` instrumenta todo `src/**/*.ts`: 100% linhas/funções/statements,
96,87% branches, mantendo thresholds 90/90/90/85. Não mede core de terceiros.
`typecheck` verifica os tipos da composição e do ponto de extensão público.

`createNativeProofAuth` existe apenas para conservar a reprodução nativa nos
dois adapters: sem plugin, duas requests concorrentes chegam ao token endpoint.
Não é um modo/fallback de auth produtiva. A composição candidata faz uma troca
e mantém PKCE, perfil, criptografia e sessão nativos. As provas incluem falhas
D1, resposta perdida, instâncias independentes, replay com novo state, configuração
ambígua, limpeza limitada e recuperação. Triggers são injeção de falhas, nunca
mecanismo de recuperação.

A reserva dura 24 h pelo relógio D1. Cada callback limpa até 100 marcadores
expirados na mesma transação; `pruneExpiredGithubCodes` permite manutenção após
ociosidade. A fixture não tem scheduler: sua integração/migração pertence a
#140. Não reabrir código válido ou prometer deduplicação eterna. A garantia de
prazo externo e a diferença de explicitude entre docs OAuth App/GitHub App estão
registradas no relatório do plugin e devem ser qualificadas antes da promoção.

User/Account continuam com INSERTs separados; linking com mesmo email verificado
recupera conservando o User original. Email alterado antes de criar Account pode
deixar User incompleto. Onboarding, limpeza de órfãos e tenancy não foram
implementados. Signup não verificado não comprova destinatário de convite.
Rate-limit desligado, schema, credenciais e handler mínimo são fixtures.

GO é local da composição M0; encerramento de #129 depende da revisão/merge.
Não há OAuth/GitHub App real, deploy, benchmark ou prova regional. Um caso
adversarial desliga downgrade no fake para demonstrar a premissa externa,
sem alegar vulnerabilidade do GitHub real.

Fontes, comandos e limites:
[relatório auth](../../docs/research/2026-10-05-dashboard-auth-proof.md),
[política de reserva](../../docs/research/2026-10-05-dashboard-code-redemption-plugin.md) e
[avaliação OAuth](../../docs/research/2026-10-05-dashboard-oauth-security-requirements.md).

A fundação M1 extraiu a persistência da reserva para
[`packages/db`](../../packages/db/src/github-code-redemption.server.ts). O módulo
local de reserva delega a esse adapter; toda a suite OAuth continua exercitando
a mesma primitiva D1 canônica, sem duplicar o algoritmo. Auth/plugin permanecem
nesta prova até a composição de produção em M2.
