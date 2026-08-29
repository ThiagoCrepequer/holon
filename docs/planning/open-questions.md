---
id: PLAN-OPEN-QUESTIONS
kind: planning
status: current
owners:
  - core-team
last-reviewed: 2026-08-29
---

# Questões em aberto

Questões aqui não são decisões. Cada item deve sair da lista por evidência,
decisão explícita ou remoção de escopo.

## P0 — Bloqueiam a implementação do fluxo

Nenhuma questão aberta. Findings, resumo em Pull Request Review e reconciliação
por marcador foram definidos e implementados.

## P1 — Bloqueiam o piloto privado

- Quais provedores e modelos podem receber código privado?
- Quais dados o AI Gateway registrará e por quanto tempo?
- Quais classes adicionais de segredo e política organizacional precisam
  complementar a redação heurística já implementada?
- Quais permissões exatas e eventos serão registrados no GitHub App?
- Como o usuário desabilita review por repositório, caminho ou PR?
- Qual orçamento monetário e de tokens por run no modelo escolhido? O limite
  técnico atual é 4.000 tokens de saída, oito passos e doze tool calls.

## P2 — Qualidade e evolução

- O limiar inicial de confiança 0,8 deve ser recalibrado após qual tamanho de corpus?
- Como coletar feedback de falso positivo sem poluir o PR?
- Quando busca semântica supera busca estrutural no corpus?
- Quais tarefas auxiliares justificam Workers AI?
- Quando respostas em comentários justificam Agents SDK/Think e DO por PR?
- Como ampliar o suporte a monorepos e código gerado? Submódulos não são
  obtidos e filtros Git LFS permanecem desativados no MVP.
- Como cancelar trabalho antigo após force-push?

## Decisões já tomadas

- O MVP é uma fatia vertical assíncrona e one-shot.
- O código é organizado como monorepo TypeScript 7 ESM, com Node.js 24 LTS,
  pnpm workspaces e Turborepo.
- O toolchain de qualidade usa Oxfmt, Oxlint type-aware, `tsc --noEmit`, Vitest,
  `@cloudflare/vitest-plugin` e Wrangler.
- `apps/control-plane` reúne ingress, Queue consumer, Workflow e ledger.
- Hono fica restrito à fronteira HTTP; Zod valida fronteiras; Octokit modular e
  AI SDK ficam encapsulados em adapters.
- Workflows coordena as runs e um Durable Object SQLite por PR implementa o
  ledger idempotente.
- O executor é um deployable separado usando Sandbox `@next` com versão
  fixada, egress deny-by-default e destruição ao final da run.
- O piloto estrutural cobre JavaScript, TypeScript, JSX e TSX.
- `CLAUDE.md` e customização de Copilot não serão criados agora.
- Vectorize, R2, Workers AI, Tunnel e conversa persistente não fazem parte da
  primeira entrega.
- O resumo é uma Pull Request Review `COMMENT`; inline comments usam line/side.
- Marcadores determinísticos e ledger reconciliam efeitos externos ambíguos.
