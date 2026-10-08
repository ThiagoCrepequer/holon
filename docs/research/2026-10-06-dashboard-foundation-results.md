---
id: RESEARCH-2026-10-06-DASHBOARD-FOUNDATIONS
kind: research
status: current
date: 2026-10-06
verified-at: 2026-10-06
owners:
  - core-team
related:
  - ../decisions/0054-establish-user-dashboard-foundations.md
  - ../architecture/user-dashboard.md
  - ../planning/dashboard-implementation-plan.md
  - 2026-10-05-dashboard-milestone-zero-results.md
---

# Evidência das fundações locais do dashboard

## Alcance

Registro do milestone GitHub **Dashboard 1 · Fundamentos e gates** (#132–#138),
partindo da main `31e5e9a` com M0 integrado. Dois Workers locais, UI/DB, contratos,
portas e gates estão materializados. Não há login/workspaces, convite, fila,
projeção funcional, dado privado ou novo deploy nessa entrega.

## Comandos e resultados locais

Ambiente: macOS, Node 24.19.0, pnpm 11.24.0, Docker 29.4.0. Engines do projeto
continuam >=24.11 <25; jsdom 29.1.1 foi fixado também como peer opcional do Vitest,
sem elevar silenciosamente o mínimo Node para 24.15 com jsdom 30.

| Comando                                                                       | Resultado observado                                                                                |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                              | 20 tarefas passaram, incluindo Wrangler/types e Router/typegen                                     |
| `pnpm test:architecture`                                                      | 12 testes passaram, com fixtures negativas                                                         |
| `pnpm --filter @holon/ui test:coverage`                                       | 4 cenários DOM; linhas/funções 100%, statements 96,15%, branches 97,61%                            |
| `pnpm --filter @holon/dashboard test:coverage` (Node)                         | 9 cenários Node; linhas/funções/statements 100%, branches 98,88%                                   |
| `pnpm --filter @holon/db test:coverage`                                       | 5 cenários D1 reais locais, cobertura 100%                                                         |
| `pnpm --filter @holon/dashboard test:coverage:workers`                        | 5 cenários HTTP Workerd, 100% linhas/funções, branches 98,33%                                      |
| `pnpm --filter @holon/email-delivery test:coverage`                           | 3 cenários HTTP/RPC, cobertura 100%                                                                |
| `pnpm --filter @holon/dashboard test:browser`                                 | 12 cenários passaram; ambos idiomas nos três engines, zero retries                                 |
| `pnpm --filter @holon/db migrate:identity:local` e `migrate:projection:local` | migrations aplicadas aos UUIDs sintéticos locais; nenhum banco remoto                              |
| `pnpm brand:check`                                                            | 46 pares de contraste e tokens passaram                                                            |
| `pnpm dlx shadcn@4.21.3 info` em dashboard e UI                               | aliases e paths resolvidos para o package UI; nenhuma geração executada                            |
| `pnpm verify`                                                                 | gate completo passou: 30 tarefas na etapa de cobertura e 16 na de build; inclui a regressão visual |

A matriz usa os browsers fornecidos pelo Playwright 1.63.0. Ela comprova esses
engines em desktop e emulação 375 px; não Safari/iOS ou Chrome/Android reais,
nem automaticamente as duas versões estáveis mais recentes do contrato de suporte.

## Primeiras falhas e correções

1. O resolver antigo `.js`→`.ts` ignorava `.tsx`. A regressão falhou; AST Babel
   e resolução TSX/aliases passaram a detectar ciclos, exports desconhecidos,
   imports entre internals e dependências servidor transitivas. Imports computados
   são negados para não contornar fronteiras estáticas. Strings/comentários não
   são tratados como imports.
2. A data 2026-10-01 não era suportada pelo Workerd da suite fixada. A configuração
   real dos novos Workers passou a 2026-08-29, também usada nos testes/core;
   nenhum override de teste mascara a data real.
3. Tipos gerados do Router modelam opcionais como `T | undefined`. A composição
   omite campos ausentes antes de fornecer `ServerBuild`, preservando as opções
   strict do projeto. O build do framework e o typecheck confirmam a integração.
4. Troca de idioma muda o nome acessível dos controles. Locators com o idioma
   anterior falhavam; o oráculo agora usa o idioma atual, conservando os asserts
   de foco. O dialog nativo deixa o browser controlar top layer e inert; testar
   Tab para controles existentes e impossibilidade de focar a página subjacente,
   sem confundir foco na UI do browser com foco em um controle da página.
5. URL desconhecida pelo Router perdia loader raiz, idioma e nonce e serializava
   a exceção padrão com o caminho. Uma rota wildcard devolve status 404 por
   `data()` e renderiza a mensagem localizada dentro do layout. A regressão lê
   HTML/DOM e headers do artefato real, sem expor o erro nativo.
6. Matcher `.rejects` aplicado diretamente à promise RPC com pipelining emitia
   rejeições não tratadas no runner. `Promise.resolve` adapta a promise RPC à
   promise nativa aguardada pelo matcher; falhas continuam obrigatórias. O RPC
   usa um Worker auxiliar construído, sem mocks do protocolo; a fonte também
   é instrumentada diretamente para cobertura. Nenhuma exceção foi ignorada.
7. A primeira tentativa do gate completo detectou a identidade do compilador
   desatualizada após alterar o lockfile, que é input intencional de geração.
   `pnpm config:schema:generate` regenera esse artefato; não enfraquecer o check.

8. O teste de plural revelou que CLDR usa categoria `one` para zero em pt-BR.
   A mensagem de contagem define `=0` explicitamente ("0 revisões"), preservando
   os ramos `one`/`other` e a gramática escolhida para o produto. O teste não foi
   enfraquecido para aceitar o singular inesperado.
9. O CLI shadcn não resolvia `@holon/ui` como diretório de geração porque o
   package expõe somente subpaths. Um alias exato no tsconfig indica esse
   diretório ao CLI; não cria export raiz nem wildcard que contorne a API do
   package. O checker rejeita import de produção do alias raiz. `info` passou
   nos dois workspaces, sem executar `add` ou sobrescrever componentes.
10. A inspeção visual revelou que o reset Tailwind removia a margem automática
    do dialog nativo. A nova regressão geométrica falhou com deslocamento de
    416 px antes da correção; o componente passou a definir sua margem. Os
    12 cenários de browser passaram, incluindo centralização desktop/celular,
    superfície opaca depois da animação e movimento reduzido.
11. A revisão do checker encontrou uma lacuna para rotas em arquivos avulsos,
    como `not-found.tsx`, e import de composição raiz por features. A fixture
    negativa falhou antes da correção. A resolução de dono agora inclui rotas
    em arquivo ou diretório; features não podem importar root/shell. Os 12
    testes de arquitetura passaram com esses novos casos.
12. `git diff --check` encontrou espaços emitidos pelo gerador Wrangler nos dois
    arquivos de tipos. Removê-los também mudou o marcador do runtime sem flags
    do email e fez `wrangler types --check` falhar. A saída original foi
    regenerada e os typechecks dos dois apps passaram. Tipos gerados seguem
    o verificador oficial; a revisão de whitespace dos arquivos autorais os
    exclui, assim como as configurações existentes de oxfmt/oxlint.

Essas repetições acompanharam correções de código/config/oráculo. A cadência
mantém zero retries; não classificar uma execução sem mudanças como correção
nem substituir a primeira falha por um resultado posterior silenciosamente.

## O que está provado

Contratos strict rejeitam extras/IDs/estados/páginas inválidos sem tokens ou rows.
As migrations identificam separadamente a autoridade de identidade e projeção;
D1 local valida constraints, upgrades preservados, concorrência, rollback e
manutenção limitada da reserva OAuth, sem persistir code bruto. A prova M0 usa
agora esse mesmo adapter canônico; não há duas implementações da reserva.

HTTP valida origem/redirect/método/JSON/CSRF vinculado a sessão confiável e limite
pelo stream, preserva cookies e não serializa exceção arbitrária. Ainda não há
endpoint de comando ou emissor de sessão/CSRF. API health é liveness, não readiness.
Email privado nega HTTP e valida wake por RPC; responde unavailable e não envia.

Browser prova HTML SSR no idioma solicitado, hidratação sem pageerror/CSP
violations, cache privado de documento/API e imutável de assets com hash,
nonce distinto por request, teclado/Escape/inert/retorno de foco, troca de idioma
sem perder filtros/foco, temas, centralização responsiva e movimento reduzido. Axe passa nos estados
exibidos; isso não equivale a conformidade WCAG completa.

## Gates que continuam nas issues donas

| Fundação / issue    | Evidência e limite                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #132 · arquitetura  | ADR, autoridades/portas/DTOs e grafo; `auth` só entra em M2 e projeção/Queue permanecem futuras                                                                                  |
| #133 · Workers      | configs/types/build/dry-run locais; sem recursos, secrets ou publicação                                                                                                          |
| #134 · persistência | factories/migrations/autoridade e reserva OAuth prontas; guards de child/outbox e colisão operation ID ator/payload precisam dos comandos reais M2/M3                            |
| #135 · UI           | exports específicos, shadcn config monorepo, tokens/fontes/Semente/Lucide, controles e dialog testados; não um catálogo completo de componentes                                  |
| #136 · i18n         | negociação isolada, Intl/UTC/plurais 0/1/2, catálogos sem fallback e CLI negativo; perfil persistido e timezone pessoal entram em M2                                             |
| #137 · HTTP         | primitives e negações testadas; vínculo cookie↔sessão↔CSRF/rate limits de auth M2, abuso/atomidade de convite M3, escaping email M4 e Markdown M5/M6 continuam gates específicos |
| #138 · qualidade    | Node/DOM/Workers/browser, imports negativos, marca em verify, artefatos sete dias; CI remota não inferida de execução local                                                      |

Não encerrar #134/#137 como se os cenários com comandos, convite e conteúdo externo
já estivessem implementados. A arquitetura não inventa schema ou endpoint sem
consumidor para produzir um teste verde. As provas sintéticas M0 conservam seus
gates de viabilidade; a composição SaaS deve revalidar os cenários com suas tabelas,
atores, permissões e transportes concretos nas entregas correspondentes.

## Performance e promoção

O build informa JS gzip (**126.756 bytes** nessa execução) e comprova
CSS/tokens/fontes e separação cliente/servidor, incluindo a inspeção de 81
identidades de módulos cliente antes da minificação. O valor é baseline da
página de fundação, não budget de lista/detalhe, latência,
Core Web Vitals ou promessa com 10 mil PRs/repo. Publicar protocolo e budgets de
rota/carga antes de promoção conforme o plano; não escolher limite arbitrário
só porque o bundle atual passa.

Auth/grants GitHub e envio Cloudflare reais, permissões Cloudflare, regiões,
backup/restore e produção continuam sem prova nesta execução. Dry-run não cria
Worker, banco, Queue, secret, DNS ou GitHub App. IDs locais não são configuração
remota homologada. A pipeline de deploy do core não foi ampliada.
