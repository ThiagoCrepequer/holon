---
id: RESEARCH-DASHBOARD-BROWSER-PROOF-2026-10-05
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-05
---

# Prova local da ponte SSR, API, Query e i18n

**Resultado: go para esta composição local na DASH-03**, com as versões abaixo
e o reader explícito descrito neste documento. O build real do React Router
Framework foi servido por Workerd via Wrangler local; 20 cenários passaram nos
três engines Playwright, totalizando **60 testes**, sem retries. Isso permite
continuar a implementação planejada; não constitui liberação de um dashboard,
validação de autenticação real ou evidência de desempenho Cloudflare remoto.

A prova está em [tooling/dashboard-browser-proof](../../tooling/dashboard-browser-proof/README.md).
É um workspace privado sem deploy, recursos remotos ou código reutilizável de
produção. Usuários `alice`/`bob`, recursos `a`/`b` e headers de identidade são
fixtures sintéticas de loopback. SSR e Hono estão juntos apenas neste harness;
a separação dos Workers de produção continua definida pelo plano.

## Versões e compatibilidade verificadas

Verificação em 2026-10-05 por documentação primária, manifests publicados,
lockfile instalado e execução local. Os manifests das versões candidatas ficam no workspace de prova; não houve
alteração dos manifests/código dos apps nem deploy. A resolução compartilhada
e a identidade gerada de configuração estão descritas no
[relatório consolidado](2026-10-05-dashboard-milestone-zero-results.md).

| Dependência                    | Versão exercitada                 | Evidência e implicação                                                        |
| ------------------------------ | --------------------------------- | ----------------------------------------------------------------------------- |
| Node / pnpm                    | 24.19.0 / 11.24.0                 | Scripts do monorepo, sem mudar Node global                                    |
| React / React DOM              | 19.3.0                            | Build e SSR `renderToReadableStream` reais                                    |
| React Router / dev             | 8.4.0                             | Framework Mode, typegen, loader, clientLoader, serialização e navegação reais |
| Cloudflare Vite plugin         | 1.62.5                            | Plugin oficial com ambiente `ssr`; peer Wrangler `^4.147.0`, Vite 8 aceito    |
| Vite                           | 8.2.2                             | Alinhado à versão existente do monorepo; não exige 8.3.2                      |
| Workerd / Miniflare            | 1.20261001.1 / 5.20261001.0-alpha | Runtime local resolvido pelo Wrangler da prova                                |
| Wrangler                       | 4.147.0                           | Restrito à prova por requisito do plugin; catálogo de produção preservado     |
| Hono                           | 4.13.5                            | API HTTP sintética no handler Workers                                         |
| TanStack Query                 | 5.104.1                           | `setQueryData`, `removeQueries`, `clear`, dehydrate e observer passivo        |
| Lingui core / React / CLI / PO | 6.9.0                             | Instância por SSR, catálogos compilados en/pt-BR, plural e gate negativo      |
| Playwright                     | 1.63.0                            | Chromium, Firefox e WebKit disponíveis e executados                           |

O [guia Cloudflare](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)
apresenta React Router com o plugin oficial. Os peers instalados aceitam Vite 8
e exigem o Wrangler da prova. O artefato final fixa `compatibility_date: 2026-10-01`, com `nodejs_compat`, conforme a data padrão suportada pelo Wrangler instalado. A coleta inicial de 60 testes usou configuração 2026-10-05 e o mesmo Workerd, sem aviso de fallback no startup/GET local; isso não é prova de suporte a flags futuras. A data foi limitada a 2026-10-01; o gate integrado `pnpm verify` reconstruiu o artefato final e repetiu os 60 testes com sucesso nessa configuração. A versão e a data do runtime não são a data de verificação deste relatório. A [API Hono Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
foi exercitada com `fetch`; não se presume um adapter Node para o Worker.

## Quem possui a leitura

O loader servidor chama diretamente o caso de uso, cria um QueryClient local à
requisição e transporta somente o snapshot autorizado desidratado e seu
`updatedAt`. O provider SSR e a instância Lingui também são criados por request;
nenhum cliente global do servidor compartilha dados entre usuários. Dois SSRs
simultâneos com usuário, locale e timezone diferentes retornam conteúdo isolado.
O timestamp observado no servidor segue junto com o snapshot.

O framework transporta bootstrap/contexto em loader data. Após a hidratação,
bootstrap não é reaplicado em renders posteriores: um cache privado removido
não pode voltar por replay da metadata SSR. `HydrationBoundary` não é dono da
leitura nem store paralelo de dados da feature.
[HydrationBoundary](https://tanstack.com/query/latest/docs/framework/react/reference/functions/HydrationBoundary)
e [QueryClient](https://tanstack.com/query/latest/docs/framework/react/reference/classes/QueryClient)
definem as APIs públicas usadas.

`clientLoader` não é marcado para executar na hidratação e não chama também
`serverLoader` para o dataset. Em navegação, filtro, página, voltar e refresh,
o reader da feature executa um request para `/api/read/*`. Somente depois de
validar payload, identidade, key, sinal e intenção faz `setQueryData`.
O dataset ativo fica no Query, observado com `enabled: false`; não há `queryFn`
no observer nem refetch autônomo de mount, focus, reconnect ou invalidation.
A UI conserva apenas estado de controle, draft e apresentação de erro.
[Client data](https://reactrouter.com/how-to/client-data) e
[queries desabilitadas](https://tanstack.com/query/latest/docs/framework/react/guides/disabling-queries)
sustentam essa composição restrita ao frescor explícito acordado em Q8.

A tentativa inicial com execução imperativa pelo Query mostrou por que não se
deve inferir ownership a partir de um Promise: ao consumir o signal, o
cancelamento do último observer pode reverter ao snapshot anterior; na versão
instalada, essa reversão também pôde resolver a chamada com dados anteriores.
O [cancelamento documentado](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
descreve a reversão. Deduplicar uma nova intenção à promise da leitura anterior
também não comprova nova autorização. O reader explícito evita essas semânticas
usando o transporte HTTP com AbortController próprio e as APIs públicas de
commit/remoção do Query. Não acessa estado interno da biblioteca, não desativa
revalidação global do Router e não adiciona outro dono de rede.

## Cancelamento, negação e cache privado

Cada key possui uma intenção ativa e AbortController. Nova intenção na mesma
key aborta a anterior e começa outra leitura. Um signal do Router é combinado
com o signal da intenção. Após o JSON, o commit ainda confere geração de
identidade, key/intenção ativa e revogação do escopo. A→B→A inicia uma segunda
leitura de A; sucesso ou 403 da requisição substituída não altera o A novo.
O browser observa cancelamento real de request.

403 válido remove snapshots do recurso negado, incluindo filtros/páginas, e
aborta leituras anteriores desse escopo. Um epoch causal impede sucesso antigo
de repovoar cache após negação atual. Se uma confirmação mais recente do mesmo
recurso já ocorreu, o erro antigo só pode expulsar sua própria key obsoleta;
não remove o snapshot novo. A negado não esconde B permitido. 401 invalida a
sessão sintética inteira: avança geração, aborta pendências e limpa todos os
snapshots da identidade, inclusive B visitado anteriormente.

A troca sintética de identidade também aborta todas as pendências e limpa o
cache. Controllers e ownership por key saem em `finally`; metadata de
confirmação/revogação existe somente enquanto leituras do escopo ainda podem
terminar. Depois das intenções concluídas, o teste exige ausência dessa
metadata. O Query conserva snapshots concluídos conforme seu próprio GC.
Esses tokens são locais ao harness; não substituem revisão de sessão, vínculos
ou autorização do backend real.

JSON malformado, usuário/recurso/parâmetros incompatíveis e tipos inválidos
são falhas de contrato: não entram no cache, não repetem request e fecham a
apresentação privada do escopo. O Dataset é construído com campos permitidos;
um campo extra sintético não é gravado. Falha transitória 503 conserva somente
o snapshot atual ainda autorizado e apresenta erro, sem retry automático.
Não é uma promessa de tolerância a falhas de autenticação/provedor reais.

## SSR, CSP e i18n

A geração usa `createRequestHandler`, `ServerRouter` e streaming React; não
simula o Router com HTML montado manualmente. Contexto usa as APIs tipadas
[createContext](https://reactrouter.com/api/utils/createContext) e
[RouterContextProvider](https://reactrouter.com/api/utils/RouterContextProvider)
do React Router 8. A nonce aleatória por request é aplicada à resposta,
`ServerRouter`, renderer React, `Scripts` e `ScrollRestoration` conforme o
[guia de segurança](https://reactrouter.com/how-to/security).

A CSP usa nonce + `strict-dynamic`, recursos same-origin, `object-src 'none'`,
`base-uri 'none'` e `frame-ancestors 'none'`; não usa `unsafe-inline`,
`unsafe-eval` nem allowlist ampla de scripts. Documentos e API são `no-store`.
Em todos os cenários nos três engines não houve violação CSP. Payload contendo
`</script>`, script e SVG com evento continua texto, não executa e não cria SVG
no DOM. URLs `javascript:`, `data:`, host falso, credenciais e URL relativa
hostil não recebem href; a fixture permite apenas a origem HTTPS GitHub.

O gate de bundle exige canary realmente presente no servidor e ausente dos
assets cliente, junto da ausência dos identificadores/SDKs restritos checados.
É evidência da fronteira do artefato construído, não um scanner universal de
segredos nem prova de que uma API real jamais entregará campo sensível.

Lingui usa `setupI18n` por request, quatro mensagens do recorte sintético,
catálogos compilados en/pt-BR e `Intl` com timezone explícita. Extração é comando
separado de atualização. O gate exige catálogo sincronizado com fonte,
`check missing --mode catalog` antes de fallback e compile estrito. Uma cópia
em diretório temporário com tradução pt-BR ausente tem de falhar; o gate prova
que compile/fallback não mascaram ausência. A [CLI Lingui](https://lingui.dev/ref/cli)
e a [API core](https://lingui.dev/ref/core) foram revalidadas; Lingui 6 usa
formatter PO fornecido por pacote separado, não `format: 'po'`.

## Oráculos e reprodução

`pnpm --filter @holon/dashboard-browser-proof typecheck`, `lint` e
`test:coverage` passaram. O último executa build e a matriz de 60 browser tests;
não há percentual fictício de cobertura de código. Os limites de cobertura dos
workspaces de produção permanecem próprios. O [README do harness](../../tooling/dashboard-browser-proof/README.md)
contém instalação de browsers e comandos completos.

Os oráculos observam requests reais, UI, foco/scroll, cache privado e cancelamento:

- Documento inicial: uma chamada direta do caso de uso; hidratação: zero API.
- Navegação/filtro/página/refresh/voltar: cinco intenções, cinco API requests.
  Headers por request confirmam uma leitura na API e zero do dataset nos frames
  `.data` do Router. Isso também detecta uma eventual dupla leitura oculta no SSR.
- Mount/remount, focus, reconnect e invalidação não produzem leitura.
- Sucesso/403 antigos, mesma key revisitada, identidade trocada, negação atual
  seguida de sucesso de outra página antiga e owner de refresh substituído.
- 401 global, 403 por recurso, JSON inválido, DTO incompatível e campos extras.
- SSR concorrente en/pt-BR e UTC/São Paulo; plural compilado singular/plural.
- Foco no título e anúncio curto em página nova; filtro/refresh por teclado
  mantêm foco e scroll pertinente; voltar restaura a posição salva pelo Router.

Respostas concorrentes são liberadas por barreiras explícitas de rede. Não há
sleep arbitrário; assertions aguardam estados observáveis. Pointer click pode
mover scroll/foco antes da navegação segundo o browser: a prova de conservação
estabelece o foco por teclado e verifica a posição realmente salva. O CSS é
apenas fixture de altura de documento, não layout de produto.

JUnit está em `tooling/dashboard-browser-proof/proof-results/junit.xml`, traces
em falhas na pasta `browser/`. Esses artefatos locais são ignorados; a CI deve
executar a prova e reter seus resultados, não reutilizar sucesso cacheado.

## Limites e próximo uso

Não foram implantados dashboard, login, workspace, API pública ou packages UI.
Não foram exercitados GitHub, D1, service binding entre dois Workers, SMTP,
email, sessão/cookies reais, controle de acesso de produção ou leitor de tela.
A troca de geração de identidade é controlada pelo harness; a ligação com
sessão real pertence à implementação de autenticação. O mesmo usuário
reauthenticado requer uma geração de sessão nova no produto, não reset silencioso
da fixture inválida.

Não há benchmark de cold start, latência/CPU Cloudflare, bundle final com UI,
reduced motion ou animações; esses itens continuam nos respectivos gates do
plano. Os três engines foram testados nas builds Playwright instaladas, não em
todas as versões da matriz de browsers. Não houve concessão ampla CSP para
contornar build nem alteração do catálogo de dependências de produção.

A implementação futura deve preservar este único dono de leitura, a validação
no backend e os oráculos. A prova autoriza refinar o candidato documentado;
não copiar headers, globals ou identidade sintética para o dashboard real.
