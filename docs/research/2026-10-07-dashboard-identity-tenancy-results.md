---
id: RESEARCH-2026-10-07-DASHBOARD-IDENTITY-TENANCY
kind: research
status: current
date: 2026-10-07
verified-at: 2026-10-07
owners:
  - core-team
related:
  - ../architecture/user-dashboard.md
  - ../engineering/dashboard-identity-and-workspaces.md
  - ../operations/dashboard-environments-and-recovery.md
  - 2026-10-06-dashboard-foundation-results.md
---

# Primeiro recorte M2: identidade e tenancy locais

## Escopo e dependência

A branch `codex/dashboard-milestone-two` parte do PR #171, branch
`codex/dashboard-milestone-one`, no commit
`f46edbd13fd94faffe4a9c35b21771cdbb9f89d7`. A entrega usa um PR stacked
contra essa branch; não modifica o PR pai. O recorte implementa #139, #140 e
#142 para completar os cenários de persistência de #134.

O milestone 1 inteiro não está encerrado: #137 mantém convites e conteúdo
dependentes de entregas posteriores. Sessões/dispositivos (#141), governança e
reauth (#143) e preferências (#144) continuam PRs separados de M2.

Antigravity foi o autor primário do código produtivo. A revisão independente
adicionou testes que observaram falhas antes das correções, sem substituir a
biblioteca nativa nem reproduzir o algoritmo de autorização.

## Implementação

- `packages/auth` encapsula Better Auth/core/adapter 1.7.7 e Drizzle 0.45.3;
  só exporta a interface servidor Holon e validação de configuração.
- DTOs públicos não contêm token de sessão, email nem token OAuth. A admissão
  exige sessão nativa atual e Account GitHub vinculada. Tokens OAuth são
  criptografados desde a primeira persistência pela biblioteca.
- Callback usa o plugin público aprovado em M0: reserva D1 por digest antes da
  troca de code, depois da validação nativa de state/cookie/prazo. Nova tentativa
  de cadastro interrompido usa novo OAuth e linking nativo verificado.
- Migration `0003_auth_and_tenancy.sql` preserva migrations anteriores e separa
  identidade da projeção. Workspace pessoal tem unicidade/exclusividade;
  criação de equipe, owner e receipt são atômicos por D1 batch.
- Operation ID pertence ao ator/payload. Replay não duplica workspace e não
  recria membership removida. Papel é local ao vínculo e revalidado na leitura.
- HTTP mantém as fronteiras M1 e adiciona allowlist de auth/tenancy. Ator vem
  da sessão, comandos usam CSRF vinculado à sessão e payloads strict. Cookies
  de renovação são preservados também nos erros posteriores à autenticação.

## Primeiras falhas da revisão independente

As primeiras execuções usaram Node 24.11.0, pnpm 11.24.0 e Workerd/D1 locais.
O provedor GitHub foi controlado; os adapters, SQL, cookies nativos e transições
foram reais no runtime local.

| Fronteira e comando                                                                                             | Falha observada antes da correção                                                                                                                                 | Oráculo                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm --filter @holon/db exec vitest run --config vitest.config.ts test/tenancy-review.test.ts`                 | Batch com admissão revogada e ID de parent existente criou membership; dados persistidos inválidos eram aceitos; constraints permitiam demotion/conversão pessoal | SQL independente após a operação, rejeição da leitura e constraint real      |
| `pnpm --filter @holon/auth exec vitest run --config vitest.config.ts test/config-review.test.ts`                | Três configurações aceitaram loopback remoto ou origem compartilhada preview/produção                                                                             | Interface pública de validação, sem copiar o validator                       |
| `pnpm --filter @holon/auth exec vitest run --config vitest.config.ts test/auth-review.test.ts`                  | Body anônimo acima de 20 KiB recebeu 200 e criou state OAuth                                                                                                      | HTTP 413 esperado e zero linhas em Verification                              |
| `pnpm --filter @holon/dashboard exec vitest run --config vitest.config.ts test/http-composition-review.test.ts` | 404 de membership e 403 de CSRF perderam dois cookies renovados; personal aceitou ator extra                                                                      | Headers HTTP e zero chamadas de mutação                                      |
| Mesmo comando de composição, casos adicionais                                                                   | Personal aceitou `null`, array, string e number com HTTP 200                                                                                                      | HTTP 400 e zero chamadas de persistência                                     |
| `pnpm verify`, cenários de browser preservados de M1                                                            | GET `/api/workspaces/leave` caiu na leitura genérica de workspace e retornou 503                                                                                  | HTTP 404 para GET/HEAD e 405 para POST; regressão com e sem auth configurado |

O teste `packages/auth/test/http-tenancy-review.test.ts` atravessa o handler HTTP,
Better Auth nativo e D1 com dois usuários. Prova OAuth, CSRF por sessão,
provisionamento pessoal concorrente, replay de equipe, ator/escopo forjados e
remoção de membership com sessão ainda válida. Só provider externo e renderer
SSR são substituídos nesse teste; ele não substitui a prova de browser.

## Resultados locais e gate final

| Comando                                                                                  | Resultado observado                                                                                            |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @holon/auth test:coverage`                                                | 28 testes passaram, exit 0; linhas 94,26%, statements 94,40%, funções 100%, branches 88,57%                    |
| `pnpm --filter @holon/dashboard build`                                                   | Bundle cliente sem SDK/DB/auth servidor; build e deploy dry-run locais passaram                                |
| `pnpm --filter @holon/dashboard exec playwright test --config playwright.auth.config.ts` | 6 cenários passaram em Chromium/Firefox/WebKit, pt-BR/en e zero retries                                        |
| `pnpm verify`                                                                            | Exit 0: marca, schema/config, formatação, lint, typecheck, arquitetura, cobertura, browsers, builds e dry-runs |
| Cobertura de `packages/db` no gate completo                                              | 26 testes passaram; linhas 95,07%, statements 95,30%, funções 100%, branches 90,47%                            |

O harness de browser carrega todos os módulos do Worker compilado, assets reais
e migrations D1, com secrets sintéticos e egress restrito ao provider controlado.
A ponte HTTPS preserva respostas 302 e todos os Set-Cookie. A navegação de
GitHub authorization usa um provider local de teste que devolve redirect HTTP
real; isso também evita a limitação de Playwright/WebKit para fulfill 302.
Nenhuma rota ou flag de teste foi adicionada ao Worker produtivo.

A prova observa cookies HttpOnly/Secure/host-only/SameSite=Lax, CSRFTokens por
sessão, hidratação pelo teclado após retorno OAuth, exclusão de tokens de
HTML/JSON, tenancy idempotente, CSRF/ator inválidos, endpoints nativos negados,
code replay sem outra troca e logout. Quatro composições inválidas do mesmo
Worker compilado retornam 503 private/no-store com erro sanitizado: origem
ausente, trio incompleto, banco ausente e auth secret de tipo inválido.

O gate completo terminou com sucesso em 2026-10-07, com Node 24.11.0 e pnpm
11.24.0. O dashboard preservou os 12 cenários de browser de M1 e acrescentou os
6 cenários nativos de auth, totalizando 18 em Chromium/Firefox/WebKit. A
verificação também incluiu os demais workspaces; tarefas não alteradas usaram
o cache oficial do Turbo. Isso não comprova CI remota ou ambiente publicado.

A mudança do lockfile exigiu `pnpm config:schema:generate` para atualizar o
digest de identidade do compilador em `packages/contracts`. O JSON schema não
mudou.

Algumas invocações do runner na sandbox do escritor falharam na inicialização
de Workerd (`cloudflare:test-internal`) ou no fechamento do Vite. Reexecutar no
contexto local permitido resolveu a invocação; nenhum threshold, teste ou
timeout foi enfraquecido para mascarar a falha de ambiente.

## Limites

Não houve GitHub App real, OAuth real, provisionamento de recurso, troca de
secret, DNS, migration remota, envio de email ou deploy. Preview/produção não
têm domínios/IDs/credenciais homologados. Liveness não comprova auth/provider.
Login não instala a App, não concede grant privado e não conecta repositórios.
Refresh/grants, convites, outbox e leitura de reviews continuam entregas donas.
Os detalhes operacionais estão no [runbook](../operations/dashboard-environments-and-recovery.md).
