# Prova local de autenticação do dashboard

Workspace privado, sem Worker implantável, rota produtiva, secrets reais ou scripts
para deploy. Executa Better Auth/Drizzle reais em Workerd e D1 locais pelo plugin
oficial Cloudflare. Somente a rede do GitHub é sintética e todo outro fetch é negado.

`pnpm --filter @holon/dashboard-auth-proof test` verifica diagnósticos e garantias
observáveis. `test:viability` é um gate **separado**: falha quando o candidato não
recupera cadastro interrompido mediante novo OAuth. Um diagnóstico verde não
significa viabilidade nem autoriza implementar login de usuários.

`typecheck` verifica este harness. O relatório em `docs/research/` distingue prova
local de suporte de integração GitHub/Cloudflare remota. Schema, credenciais,
rate-limit desligado e handler mínimo aqui são fixtures, não configuração produtiva.

O D1 nativo oficial (`database: env.AUTH_DB`) também está incluído e tem o mesmo
bloqueio de recuperação. Falhas no D1 são injetadas por triggers temporárias
que abortam INSERT, removidas antes de novo OAuth; elas não implementam a
recuperação. Replay é testado com o cookie ORIGINAL: sequencial é negado;
concorrente chega duas vezes ao provider, que aplica código único. Esse achado
não é isoladamente uma vulnerabilidade demonstrada.

A suite de viabilidade usa asserts comuns: quatro falhas bloqueantes nos dois
candidatos. Não há `it.fails`. As 15 provas diagnósticas e sua cobertura não
fecham a issue #129 nem satisfazem automaticamente o milestone 0.

Fontes, alternativas suportadas, comandos e limites:
[relatório da prova](../../docs/research/2026-10-05-dashboard-auth-proof.md).
