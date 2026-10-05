# Prova local de autenticação do dashboard

Workspace privado, sem Worker implantável, rota produtiva, secrets reais ou scripts
para deploy. Executa Better Auth/Drizzle reais em Workerd e D1 locais pelo plugin
oficial Cloudflare. Somente a rede do GitHub é sintética e todo outro fetch é negado.

A política aprovada em **2026-10-05** usa linking implícito nativo, exigindo email
verificado no provider e no User local, sem `trustedProviders` que dispensem
verificação. Recuperação usa novo OAuth, nunca replay do callback anterior.
Drizzle com `transaction: false` e D1 nativo oficial recuperam Account interrompida
preservando o User original quando o email verificado é o mesmo.

`pnpm --filter @holon/dashboard-auth-proof test` executa **59 cenários** de
recuperação, linking permitido/negado, corridas, state/cookie inválido ou expirado,
code consumido, sessão, criptografia e fronteira HTTP. `test:coverage` instrumenta
somente `src/**/*.ts` deste harness: 100% linhas/funções/statements e 96,42%
branches; não mede cobertura interna das bibliotecas. `typecheck` verifica os tipos.

`test:viability` é um gate **separado** com quatro asserts comuns: as duas provas
de recuperação passam e as duas de não reutilização concorrente de code falham.
Replay sequencial com cookie ORIGINAL é negado. O concorrente envia o mesmo código
duas vezes ao provider; o GitHub sintético valida S256 e uso único e só cria uma
sessão. Isso não demonstra takeover, mas não satisfaz a obrigação do cliente
na RFC 6749 §4.1.2. Atomicidade de state é um mecanismo possível, não a garantia
universal exigida pela RFC 9700 quando PKCE vincula corretamente o fluxo.
O comando termina **exit 1**; não há `it.fails`, skip ou inversão da expectativa.

Os INSERTs User/Account continuam separados; os testes observam queries e ausência
de batch no callback real. Triggers temporárias abortam INSERT para injetar falha;
não são mecanismo de recuperação. Se o email muda antes da criação de Account,
o novo OAuth pode deixar um User sem Account/Session. Onboarding e limpeza de
órfãos não foram implementados. Signup nativo com email não verificado é possível,
mas não autoriza linking de outro subject nem comprova destinatário de convite.

Um resultado diagnóstico verde não fecha #129 nem o milestone 0. Schema,
credenciais, rate-limit desligado e handler mínimo são fixtures, não configuração
produtiva. O relatório distingue a política anterior, a atualização aprovada,
a prova local e a integração GitHub/Cloudflare remota ainda não exercitada.

Os 17 casos adicionais observam challenge/verifier nativos, injeção de outro
fluxo, downgrade e replay com PKCE. Um caso adversarial desliga deliberadamente
a defesa de downgrade no provider sintético: demonstra a dependência dessa
premissa, sem provar comportamento ou vulnerabilidade do GitHub real.

Fontes, comandos e limites:
[relatório da prova](../../docs/research/2026-10-05-dashboard-auth-proof.md) e
[avaliação do requisito OAuth](../../docs/research/2026-10-05-dashboard-oauth-security-requirements.md).
