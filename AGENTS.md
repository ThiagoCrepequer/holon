# Holon repository instructions

## Project status

Holon has an executable MVP implementation for one-shot contextual Pull Request
reviews. It is locally verified but has not been proven against a live GitHub
App, Cloudflare account, private repository, or model provider. Preserve that
distinction in code and documentation.

## Canonical documentation

Start at `docs/README.md` and load only the documents relevant to the task.

- Product intent and boundaries: `docs/product/`
- Time-bound evidence and source validation: `docs/research/`
- Accepted and proposed decisions: `docs/decisions/`
- Current or proposed system design: `docs/architecture/`
- Machine-readable interface contracts: `docs/contracts/`
- Delivery sequencing and unresolved questions: `docs/planning/`

## Authority and terminology

- An accepted ADR is authoritative for a decision.
- Architecture documents describe the current intended design but must not
  contradict accepted ADRs.
- Research documents are dated evidence snapshots, not project decisions.
- Planning documents are non-normative until a decision is accepted.
- Use terms defined in `docs/glossary.md` consistently.
- When sources disagree, prefer current primary documentation and record the
  discrepancy in the relevant research document.

## Documentation rules

- Keep facts, inferences, proposals, and accepted decisions visibly separate.
- Add a verification date to claims about external products or APIs.
- Prefer primary sources such as Cloudflare and GitHub documentation.
- Use stable relative links for repository documents and direct URLs for
  external sources.
- Every diagram must have an equivalent textual explanation.
- Do not place secrets, private repository contents, real access tokens, or
  personal data in documentation or examples.
- Do not silently rewrite an accepted ADR. Supersede it with a new ADR.
- If a change affects behavior, trust boundaries, persisted state, or an
  external contract, update the corresponding documentation in the same change.

## Current architectural boundary

ADR-0001 through ADR-0006 define the current boundary. The implementation is a
TypeScript 7 ESM monorepo with two deployables: `apps/control-plane` and
`apps/repository-executor`. Workflows coordinates retries, a Durable Object
SQLite instance per PR owns the ledger, and the executor uses Cloudflare
Sandbox with deny-by-default egress.

Package boundaries and commands are documented in
`docs/architecture/technical-ecosystem.md` and
`docs/operations/local-development.md`.

Cloudflare Agents SDK, `@cloudflare/think`, conversational follow-ups,
Vectorize-based RAG, and private MCP infrastructure remain deferred or subject
to focused validation unless a later ADR changes their status.

## Engineering rules

- Consult applicable skills and current primary documentation before complex or
  unstable platform decisions. Do not treat model memory or old research as
  current evidence.
- Keep `domain` pure; infrastructure adapters implement ports from
  `application`; validate every untrusted boundary with contracts.
- Never add arbitrary shell execution, dependency installation, lifecycle
  scripts, broad egress, or repository write access to the executor.
- Preserve exact-SHA checkout, live head revalidation, idempotent conditional
  transitions, deterministic publication markers, and explicit durable cleanup
  steps for every terminal path.
- Do not log prompts, diffs, file contents, authorization headers, private keys,
  installation tokens, or arbitrary exception messages.
- Add a focused failing test before a behavioral fix. Pure policies should be
  tested without the runtime; Workers behavior should use the official
  Cloudflare Vitest plugin.
- Do not weaken coverage thresholds or exclude production files merely to make
  a gate green.

## Commands

- `pnpm format` writes formatting; `pnpm format:check` only checks it.
- `pnpm lint` runs Oxlint; `pnpm typecheck` checks all workspaces.
- `pnpm test` runs tests; `pnpm test:coverage` enforces coverage thresholds.
- `pnpm build` performs Wrangler dry-runs and builds the Sandbox image; it needs
  Docker but does not deploy.
- `pnpm verify` is the complete local/CI gate.

Real deploys, secrets, GitHub App registration and remote resource creation are
external effects and require explicit authorization. Follow `docs/operations/`.
