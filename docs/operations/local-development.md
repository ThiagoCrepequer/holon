---
id: OPERATIONS-LOCAL-DEVELOPMENT
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-08-29
---

# Desenvolvimento local

## Requisitos

- Node.js 24; CI usa 24.4.0 e o manifesto rejeita majors diferentes.
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

Última prova local em 2026-08-29: 170 testes passaram, todos os pacotes
respeitaram 90% de statements/lines/functions e 85% de branches, ambos os
Workers produziram bundle em dry-run e a imagem fixada por digest foi
construída. Esses números são snapshot, não meta de produto.

Na mesma data, `pnpm outdated -r` não encontrou versões mais novas no registry
e `pnpm audit --prod` não encontrou vulnerabilidades conhecidas. Esses
resultados também são snapshots e devem ser refeitos antes de um release.

Comandos focados:

```bash
pnpm --filter @holon/application test:coverage
pnpm --filter @holon/control-plane test
pnpm --filter @holon/repository-executor test:coverage
pnpm --filter @holon/control-plane build
pnpm --filter @holon/repository-executor build
```

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
  run --json=stream --lang typescript --pattern 'return $A' -- \
  /workspace/tool-smoke.ts
```

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
GITHUB_APP_PRIVATE_KEY
AI_GATEWAY_ACCOUNT_ID
AI_GATEWAY_ID
AI_GATEWAY_API_TOKEN
AI_MODEL_ID
```

O executor recebe somente um token de instalação efêmero por RPC. Ele não
recebe segredo de webhook, chave do App ou credencial do modelo.

## Limites da prova local

- O Workerd prova handlers, Queue dispatcher, Workflow e Durable Object SQLite.
- Fakes provam a composição executor -> modelo -> publisher e a idempotência.
- O dry-run prova bundle e construção do Dockerfile; o smoke prova `rg` e
  `ast-grep run` dentro dessa imagem.
- Nada disso prova um webhook público, GitHub App real, modelo compatível, cota,
  latência, retenção ou publicação remota.
