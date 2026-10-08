# Prova local de SSR, API, Query e i18n

Workspace privado de investigação da DASH-03. Não é o dashboard nem um
mecanismo de autenticação. Todo usuário, recurso, payload e header de identidade
é sintético; o Worker aceita somente hostname de loopback, não possui recursos
Cloudflare/GitHub, rotas públicas ou script de deploy. Não importar este harness
em aplicações ou packages de produção.

O React Router Framework gera o documento e serializa o loader. O loader lê o
caso de uso diretamente. Depois da hidratação, `clientLoader` e refresh chamam o
mesmo reader explícito em `app/bridge.ts`; Hono atende `/api/read/*`. O Query
mantém um único snapshot de dataset e um observer passivo. O reader controla
request, validação, cancelamento e commit usando APIs públicas do Query. Os
controles visíveis servem apenas aos oráculos de rede, foco e scroll.

Na raiz, após `pnpm install --frozen-lockfile` com Node 24 e pnpm 11.24.0:

```sh
pnpm --filter @holon/dashboard-browser-proof exec playwright install chromium firefox webkit
pnpm --filter @holon/dashboard-browser-proof typecheck
pnpm --filter @holon/dashboard-browser-proof lint
pnpm --filter @holon/dashboard-browser-proof test:coverage
```

`test:coverage` executa build e prova comportamental em browser porque esse é o
gate invocado pelo monorepo. Não gera nem alega percentual de cobertura de
código. Não reduz os limites de cobertura dos outros workspaces. `proof` exige
build anterior; inicia Wrangler local sobre `build/server/wrangler.json`, em
`127.0.0.1:8793`, e encerra o servidor após os testes. Nunca usa Vite dev para
alegar evidência do build de produção.

`i18n:extract` atualiza catálogos. `i18n:check` não os corrige: exige sincronismo
com a fonte, tradução completa antes de fallback e compilação estrita; também
prova em cópia temporária que tradução ausente falha. Catálogos compilados,
build, dados Wrangler e resultados de teste são ignorados. JUnit e traces de
falha ficam em `proof-results/`.

Os oráculos de troca A → B → A aguardam a resposta nova de A e confirmam que
o getter do harness expõe esse mesmo DTO no cache antes de capturar o snapshot
que uma resposta antiga deve preservar. Texto atualizado no DOM não comprova
que os efeitos React já publicaram o contexto novo do getter. Essa espera usa
`expect.poll` com o timeout existente; as verificações de cancelamento, ausência
de erros e CSP permanecem no gate. Fonte oficial, conferida em 2026-10-08:
[assertions assíncronas do Playwright](https://playwright.dev/docs/test-assertions#expectpoll).

O [relatório datado](../../docs/research/2026-10-05-dashboard-browser-proof.md)
descreve versões, resultados, escolhas e limites. As fixtures não comprovam
GitHub OAuth, sessões reais, autorização por workspace, D1, email ou deploy.
