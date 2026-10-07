---
id: RESEARCH-2026-10-07-DASHBOARD-MILESTONE-ONE-FINAL-REVIEW
kind: research
status: current
date: 2026-10-07
verified-at: 2026-10-07
owners:
  - core-team
related:
  - ../architecture/user-dashboard.md
  - ../engineering/web-security-and-data-boundaries.md
  - 2026-10-06-dashboard-foundation-results.md
  - 2026-10-07-dashboard-identity-tenancy-results.md
---

# Revisão final do milestone 1 do dashboard

## Escopo e ponto de partida

Revisão das issues #132–#138 e conclusão de #137 no PR #171, autorizadas em
2026-10-07. O checkout isolado parte de
`80b7223604f8d0dd4287bc74117db2701813cd1d`, que incorpora o merge do PR stacked
#174. Antigravity permanece autor primário do código; a revisão independente
confere requisitos, fronteiras produtivas e testes com oráculos externos à
implementação. Nenhuma operação remota de infraestrutura está autorizada por
esse escopo.

O merge real de `main` (`ac9f80d`) está em `85fdc66`, com dois pais. O ADR
aceito de orçamento de revisão conserva o número 0053 de main; a decisão do
dashboard foi renumerada mecanicamente para 0054, sem mudança de decisão.
O gate final abaixo qualifica a implementação local no escopo aprovado.

## Matriz de critérios e evidências

| Issue              | Fronteira revisada                                                                             | Evidência revisada                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| #132 · arquitetura | ADR-0054, donos de estado, DTOs e grafo sem ciclos/import app→app                              | `tooling/architecture/*.test.mjs`, `packages/contracts/test/dashboard.test.ts` e arquitetura do dashboard; grafo e contratos conferidos com #137      |
| #133 · composição  | Workers independentes, bindings sintéticos, isolamento de ambiente e sender privado            | Builds/dry-runs, inspeção de chunks cliente e `apps/email-delivery/test/entrypoint.test.ts`, inclusive RPC do Worker compilado                        |
| #134 · D1          | Autoridades distintas, migrations preservadas, rows validadas, atomicidade/guarda/idempotência | `packages/db/test/persistence.test.ts`, `tenancy.test.ts` e `tenancy-review.test.ts`; as mutações reais de #174 completam os cenários antes pendentes |
| #135 · UI          | Tokens, controles, overlays, ícones, CSP e hidratação                                          | `packages/ui/test/components.test.tsx`, marca no gate e `apps/dashboard/test/browser/foundations.spec.ts` com ambos idiomas/três engines              |
| #136 · i18n        | Negociação por request, catálogos, plurais, Intl, fallback e continuidade ao trocar idioma     | `apps/dashboard/test/i18n.test.ts`, CLI de catálogo e cenários de browser; perfil persistido permanece responsabilidade de M2                         |
| #137 · HTTP        | Sessão/CSRF, allowlist, origens/redirects, limites, conteúdo e erros classificados             | HTTP nativo+D1, handlers Workerd e browser; gates de fluxos futuros registrados nas issues donas                                                      |
| #138 · qualidade   | Descoberta de fontes, imports negativos, cobertura, zero retries e retenção de artefatos       | Checkers AST/bundle, configs Vitest/Playwright e `.github/workflows/ci.yml`; gate local e CI do novo head relatados separadamente                     |

## Primeiras falhas independentes da #137

Com Node 24.11.0 e pnpm 11.24.0, o comando
`pnpm --filter @holon/auth exec vitest run --config vitest.config.ts test/http-boundary-review.test.ts`
falhou com quatro casos em 2026-10-07, antes das correções. O teste usa Better Auth
nativo, migrations e D1 reais locais, passando pelo handler Hono; somente o
provider GitHub e o renderer SSR são controlados.

| Critério                                                                       | Resultado anterior                                           | Oráculo independente                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Logout cookie-authenticated exige CSRF ligado à sessão                         | Origin correto e body `{}` sem CSRF retornaram 200           | Esperado 403; a tabela nativa Session deve permanecer intacta até comando válido                   |
| Colisão de operation ID distingue requisição incompatível de indisponibilidade | Mesmo operation ID com payload diferente retornou 503        | Esperado 409 `invalid_request`; SQL deve conservar exatamente um workspace/receipt                 |
| Fetch Metadata complementa a origem de login                                   | `Sec-Fetch-Site: cross-site` com Origin correto retornou 200 | Esperado 403 e zero registros novos em Verification                                                |
| Sessão nativa sem Account GitHub exige reconexão                               | Retornou 403 `denied`                                        | Esperado 401 `reconnect_required`, sem workspace privado; sessão existente não representa admissão |

## Provas adicionais da política técnica

A revisão independente exercita também:

- 40 factories D1 concorrentes, budget compartilhado de sete permissões e chaves
  sem identificador cru; isolamento de atores/ações e recuperação após a janela.
- Resultado ambíguo de persistência (primeira execução retornou negação por taxa,
  confundindo indisponibilidade) e expurgo limitado (primeira execução removeu
  todos os 200 registros antigos, excedendo o limite esperado).
- Contador persistido corrompido negativo (primeira execução concedeu permissão).
- Budget HTTP de mutações 30/60 s preservado ao recriar serviços/handler
  (primeira execução admitiu a requisição 31).
- Login nativo com a regra 10/60 s (primeira execução usou a regra default 3/10 s
  porque o SDK normaliza o prefixo `/api/auth` antes de selecionar customRules).
- Commit real de equipe com confirmação indisponível, com ou sem perda de ack;
  responder `command_unknown` e recuperar a mesma intenção, sem duplicação.
- Leitura pública de sessão/workspaces: a primeira execução admitiu todas as
  125 requisições; agora o budget 120/60 s persiste entre factories e retorna
  429 antes da requisição 125, sem criar workspace na leitura.
- Revogação da sessão exata entre preflight e batch: a primeira execução
  retornou 200 porque uma sessão válida de outro dispositivo substituía a
  sessão revogada. Personal e equipe agora retornam 403 com zero efeitos.
- Expiração depois de preparar os statements: a primeira execução retornou
  200 com o relógio JS capturado anteriormente. O relógio SQLite na admissão
  transacional fecha os dois comandos, mesmo com outra sessão válida.
- Marcador de admissão removido após sucesso, negação e rollback, observado
  diretamente por SQL; pai, membership e receipt compartilham a mesma decisão.
- CSRF/schema inválidos consumiam o budget do ator; a revisão falhou nos seis
  cenários negativos antes de mover o consumo para depois da validação. Leitura
  negada usava `command_unknown`, reservado a mutações de resultado incerto.
- Storage do rate limit nativo indisponível: erro sanitizado e zero estado OAuth,
  sem gravar payload arbitrário do erro.

Os testes estão em `packages/auth/test/http-boundary-review.test.ts` e
`packages/db/test/rate-limit-review.test.ts`. Provider controlado não substitui
D1 ou o handler nativo; as falhas são injetadas no transporte/resposta da
persistência, depois de observar os efeitos reais locais.

## Gates de integração e escopo aprovado

Em 2026-10-07, o responsável escolheu separar os gates de integração nas issues
donas e concluir a fronteira HTTP de M1. Essa reconciliação elimina a dependência
circular, conserva os requisitos e segue a ADR-0054. Não antecipa os fluxos
futuros nem usa implementações placeholder como evidência.

| Gate que exige fluxo futuro                                    | Issue dona |
| -------------------------------------------------------------- | ---------- |
| Criação de convite/outbox e abuso durável por ator/workspace   | #148       |
| GET/HEAD de scanner sem efeito, alvo/CSRF/transição de convite | #149       |
| Templates HTML/texto hostis e consumer privado                 | #152       |
| Limites reais de filtros/cursor/página                         | #157       |
| SSR/API privados, bootstrap e autorização compartilhada        | #158       |
| Toasts e erros de jornadas completas                           | #159       |
| Markdown/HTML/URLs/SVG/tracking em review real                 | #161       |
| Integração das jornadas, idiomas/engines e promoção            | #163       |

O texto histórico de #137 é conservado na reconciliação da issue. Cada owner
recebe referência explícita ao gate transferido, sem alterar suas dependências,
milestone ou critérios anteriores.

## Verificação final

Os resultados finais são registrados após o gate do artefato final. Os testes
anteriores à correção permanecem como regressões; cobertura, retries e
fronteiras produtivas não foram enfraquecidos.

Implementação produtiva: `8faaf1841fce75febf01d2782b60a14352762d43`; as correções do arranjo de teste de CI abaixo
conservam esse runtime. O gate local completo foi executado novamente com
esse arranjo e passou, com os mesmos cenários e thresholds.

Ambiente: Node 24.11.0 e pnpm 11.24.0. `pnpm verify` concluiu com sucesso:
21 tarefas de types, 32 de cobertura e 17 de build, com cache válido onde
aplicável. Inclui marca/config/schema, formatação, lint, arquitetura, thresholds,
bundles cliente/servidor, imagem Sandbox e dry-runs. Não faz deploy.

| Comando / camada                                                          | Resultado final                                                                               |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm --filter @holon/auth test:coverage`                                 | 43 testes; linhas 93,43%, statements 93,57%, branches 87,28%, funções 100%                    |
| `pnpm --filter @holon/db test:coverage`                                   | 32 testes; linhas 94,05%, statements 94,27%, branches 88,13%, funções 100%                    |
| `pnpm --filter @holon/dashboard test:coverage:workers` (incluído no gate) | 31 testes Workerd; linhas 96,49%, statements 96,15%, branches 92,05%, funções 96,77%          |
| Dashboard Node/DOM (incluído no gate)                                     | 35 testes; linhas 96,86%, statements 96,60%, branches 93,37%, funções 97,61%                  |
| Dashboard browser (incluído no gate)                                      | 12 cenários de fundação + 6 de auth/tenancy, pt-BR/en × Chromium/Firefox/WebKit, zero retries |
| Provas M0 (incluídas no gate)                                             | 101 testes de auth/D1 e 60 cenários browser preservados                                       |
| Core (incluído no gate)                                                   | 341 testes control-plane; demais workspaces e thresholds preservados                          |
| `pnpm verify`                                                             | Gate completo aprovado, incluindo builds/dry-runs                                             |

Uma execução anterior do gate falhou no teste preexistente
`purges documentation metadata on signed installation deleted`, por exceder
15 s. O gate parou e não chegou ao build. A execução diagnóstica do arquivo
`pnpm --filter @holon/control-plane exec vitest run --config vitest.config.ts test/webhook-handler.test.ts`
passou com 16 testes; o caso levou 3,928 s. A execução seguinte do gate completo
passou com 341 testes do core; o mesmo caso levou 4,997 s. O código/teste do
webhook corresponde a `main` e não foi alterado; timeout, retries e thresholds
permaneceram intactos. A falha inicial não foi reclassificada como sucesso.
Não foi determinada uma causa conclusiva para a variação de duração.

A primeira CI do head `3c24c2d` (run `37702702577`) falhou no teste novo de
budget de leitura de workspaces: as 120 chamadas HTTP sequenciais de preparação
excederam 5 s no runner. A correção prepara o contador persistido em 119 após
uma primeira leitura real, e prova por HTTP/D1 o último ingresso (contador 120),
a negação seguinte (121), o bucket compartilhado com IDs distintos e a negação
após recriar serviços. Não altera política, timeout, retries ou runtime e não
usa fake do limiter. A execução inicial permanece falha; o novo artefato recebe
outra CI, em vez de reclassificar/repetir a execução antiga.

A revisão final de #132–#138 não deixa achados de implementação pendentes
no escopo M1 reconciliado. O PR #171 inclui as dependências #139/#140/#142 do
recorte M2 incorporado por #174 e critérios de fechamento de #134/#137.
As issues permanecem abertas até o merge no branch padrão; a conclusão local
não substitui CI/revisão remota nem fecha os gates futuros transferidos.

## Limites remotos

O check `Holon Review` de `80b7223` falhou por sistema e declarou revisão não
concluída; não publicou achados verificáveis de código. A conclusão local não
deve ser apresentada como aprovação dessa revisão automática.

Não houve GitHub App/OAuth reais, envio de email, recursos/secrets/DNS,
migration remota ou deploy nesta revisão. Configuração e testes locais não
comprovam disponibilidade de serviços nem promoção em preview/produção.
