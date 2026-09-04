---
id: OPERATIONS-LOCAL-DEVELOPMENT
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-09-04
---

# Desenvolvimento local

## Requisitos

- Node.js 24 ou posterior dentro da major 24.
- pnpm 11.24.0 habilitado por Corepack.
- Docker CLI e daemon compatível para construir o Sandbox.

## Bootstrap e gate completo

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

O gate executa Oxfmt, Oxlint, TypeScript, cobertura, testes Workerd, dry-run dos
Workers e build da imagem. Ele não usa GitHub, AI Gateway nem Cloudflare remotos.

Última prova local em 2026-08-31: 395 testes passaram, todos os pacotes
respeitaram 90% de statements/lines/functions e 85% de branches, ambos os
Workers produziram bundle em dry-run e a imagem fixada por digest foi
construída. Esses números são snapshot, não meta de produto.

Na mesma data, `pnpm outdated -r` não encontrou versões mais novas no registry
e `pnpm audit --prod` não encontrou vulnerabilidades conhecidas. Esses
resultados também são snapshots e devem ser refeitos antes de um release.

Comandos focados:

```bash
pnpm --filter @holon/application test:coverage
pnpm --filter @holon/evaluation test:coverage
pnpm --filter @holon/evaluation evaluate:recorded
pnpm --filter @holon/control-plane test
pnpm --filter @holon/repository-executor test:coverage
pnpm --filter @holon/ui test:coverage
pnpm --filter @holon/admin test:coverage
pnpm --filter @holon/control-plane build
pnpm --filter @holon/repository-executor build
pnpm --filter @holon/admin build
```

`evaluate:recorded` executa o corpus V3 contra outputs sintéticos versionados,
grava `artifacts/evaluation/recorded-output.json` e não usa rede. O diretório de
artifacts é ignorado pelo Git. A execução live é deliberadamente remota e
manual; siga [avaliações](evaluations.md) em vez de copiar secrets para o shell.

Após o build da imagem, o smoke manual usa a fixture versionada para provar as
CLIs reais. Em host ARM, Docker pode avisar que a imagem é `linux/amd64`:

```bash
docker run --rm --entrypoint rg \
  -v "$PWD/apps/repository-executor/test/fixtures/tool-smoke.ts:/workspace/tool-smoke.ts:ro" \
  holon-repository-executor-holonsandbox:worker \
  --json --fixed-strings --max-count 1 -- readAnswer /workspace/tool-smoke.ts

docker run --rm --entrypoint ast-grep \
  -v "$PWD/apps/repository-executor/test/fixtures/tool-smoke.ts:/workspace/tool-smoke.ts:ro" \
  holon-repository-executor-holonsandbox:worker \
  run --config /opt/holon/sgconfig.yml --json=stream --lang typescript --pattern 'return $A' -- \
  /workspace/tool-smoke.ts

docker run --rm --entrypoint sed \
  -v "$PWD/apps/repository-executor/test/fixtures/tool-smoke.ts:/workspace/tool-smoke.ts:ro" \
  holon-repository-executor-holonsandbox:worker \
  -n '1,20p' /workspace/tool-smoke.ts
```

No runtime, `read_file` não usa uma API que materialize o arquivo inteiro. O
host resolve o path com `realpath`, aplica elegibilidade e containment e só então
constrói uma paginação inclusiva com `sed` dentro do container. Cada chamada
aceita no máximo 500 linhas e retorna no máximo 100 kB; páginas posteriores
exigem novas chamadas explícitas. `git`, `rg`, `ast-grep run`, `realpath` e
`sed` formam a allowlist de comandos construída pelo host.

Os testes do control plane usam Istanbul porque o plugin Workers não oferece
V8 coverage. Pacotes Node usam o provider V8. Os limiares globais são 90% para
statements/lines/functions e 85% para branches, com exceção de functions também
fixada em 90% no Workerd.

## Secrets locais

Se for necessário iniciar desenvolvimento interativo, use `.dev.vars`, que é
ignorado pelo Git. Nunca copie valores reais para exemplos, testes ou logs.

Nomes esperados pelo control plane:

```text
GITHUB_WEBHOOK_SECRET
GITHUB_APP_ID
GITHUB_APP_SLUG
GITHUB_APP_PRIVATE_KEY_CURRENT
GITHUB_APP_PRIVATE_KEY_PREVIOUS
GITHUB_APP_PRIVATE_KEY
AI_GATEWAY_ACCOUNT_ID
AI_GATEWAY_ID
AI_GATEWAY_API_TOKEN
AI_MODEL_ID
```

`GITHUB_APP_PRIVATE_KEY_CURRENT` é o nome preferencial;
`GITHUB_APP_PRIVATE_KEY_PREVIOUS` é opcional durante rotação. O nome legado
`GITHUB_APP_PRIVATE_KEY` permanece como alternativa ao atual para compatibilidade
com versões N-1.

O control plane espera a rota de review neste binding:

```text
AI_MODEL_ID=dynamic/pr-review
```

Em desenvolvimento, defina esse nome em `.dev.vars`. Em produção, mantenha o
mesmo valor no secret binding já provisionado. O prefixo `dynamic/` é
obrigatório: o adapter usa `/compat` e envia o identificador completo no campo
`model`.

`AI_GATEWAY_API_TOKEN` autentica o gateway e precisa de `AI Gateway Run`. A
chave OpenRouter não entra em `.dev.vars` nem no Worker quando BYOK estiver
configurado; o gateway a injeta depois que a rota seleciona o provider.

O executor V2 recebe somente identidades não secretas. O outbound handler pede
um token repo-scoped JIT ao broker nomeado do control plane usando o
`containerId` da plataforma; o token não entra em parâmetros ou filesystem do
Sandbox. O argumento token de V1 existe apenas para N-1 e é ignorado pelo
executor dual-stack. O executor não recebe segredo de webhook, chave do App ou
credencial do modelo.

## Limites da prova local

- O Workerd prova handlers, Queue dispatcher, Workflow e Durable Object SQLite.
- Fakes provam a composição executor -> modelo -> publisher e a idempotência.
- O dry-run prova bundle e construção do Dockerfile; o smoke prova `rg`,
  `ast-grep run` e a paginação `sed` dentro dessa imagem.
- O gate local não prova webhook público, GitHub App real, modelo compatível,
  cota, latência, retenção ou publicação remota. Smokes separados comprovaram
  parcialmente o caminho remoto em 2026-08-31; consulte o
  [snapshot datado](../research/2026-08-31-live-github-app-review-smoke.md) sem
  generalizar essa amostra para o gate local.
