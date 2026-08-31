---
id: ADR-0004
kind: decision
status: accepted
date: 2026-08-29
owners:
  - core-team
supersedes: []
related:
  - 0001-adopt-incremental-mvp-architecture.md
  - 0003-adopt-initial-typescript-application-stack.md
  - ../architecture/state-and-idempotency.md
  - ../architecture/security-and-trust-boundaries.md
---

# Adotar Workflows, ledger por PR e executor Sandbox isolado

## Contexto e problema

ADR-0001 deixou três decisões condicionadas a spikes: a coordenação durável, a
implementação do `ReviewLedger` e o executor com filesystem. O MVP completo
precisa resolver essas fronteiras sem confiar na entrega única da Queue, na
memória de um isolate ou no retorno inequívoco de uma API externa.

## Evidência verificada

Verificada em 2026-08-29:

- Workflows é GA, persiste resultados de passos e permite retries isolados. A
  documentação exige efeitos dentro de `step.do`, nomes determinísticos e
  operações idempotentes.
- Durable Objects oferecem roteamento determinístico, consistência forte e
  SQLite síncrono por instância. Uma instância por PR é a unidade de coordenação
  necessária para eleger a run mais recente e registrar publicações.
- Sandbox SDK executa processos em Containers isolados. Para projetos novos, a
  Cloudflare recomenda a prévia 1.0 em `@cloudflare/sandbox@next`, mantendo o
  pacote e a imagem na mesma versão.
- Sandbox permite egress deny-by-default e handlers confiáveis para injetar
  credenciais sem expô-las ao processo do repositório.
- Workflows e Durable Objects possuem suporte local; Sandbox local exige Docker.

Fontes primárias:

- [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Workflows Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Durable Objects best practices](https://developers.cloudflare.com/durable-objects/best-practices/)
- [Sandbox SDK 1.0 preview](https://developers.cloudflare.com/sandbox/1-0-preview/)
- [Sandbox outbound traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)

## Opções consideradas

### Coordenação somente por Queue consumer

Rejeitada porque retries de uma operação longa e multi-step precisariam ser
reimplementados, e o progresso durável ficaria acoplado ao ledger.

### Ledger em D1

Viável para consultas globais, mas introduz contenção e transações distribuídas
onde o átomo real é um único PR. Relatórios globais não são requisito do MVP.

### Ledger somente pela identidade do Workflow

Rejeitado porque identidade de execução não substitui reconciliação de efeitos
GitHub nem oferece um histórico de publicações por PR.

### Sandbox estável 0.12

Rejeitado para código novo porque a própria Cloudflare recomenda a linha
`@next`, cuja API de processos elimina sessões implícitas e superfícies já
depreciadas. O risco de preview será controlado por pin exato e testes de
contrato.

## Decisão

- `ReviewWorkflow` coordenará cada run. Todo efeito ficará dentro de um passo
  determinístico e idempotente.
- `ReviewLedgerObject`, um Durable Object SQLite identificado por
  `github:<repository-id>:pr:<number>`, armazenará runs e publicações.
- O ledger oferecerá RPC tipado para claim, transição condicional, eleição da
  run mais recente, reserva e confirmação de publicação.
- `apps/repository-executor` será um deployable separado com Sandbox SDK
  `@next`, fixado por versão exata e imagem correspondente.
- O Sandbox usará egress deny-by-default. Somente GitHub poderá ser liberado
  durante aquisição; credenciais serão adicionadas no handler confiável e não
  entregues ao processo analisado.
- O executor será read-only em relação ao repositório: clone raso do commit
  exato, leitura, `git grep`, `rg` e busca estrutural allowlisted. Instalação de
  dependências e execução de scripts do repositório ficam proibidas no MVP.
- O workspace será destruído ao final da run, inclusive em falha.

> Detalhamento operacional vigente em
> [segurança e trust boundaries](../architecture/security-and-trust-boundaries.md):
> a allowlist construída pelo host inclui `git`, `rg`, `ast-grep run`,
> `realpath` e `sed`. `read_file` usa `realpath` seguido de uma página `sed`
> limitada, sem materializar o arquivo inteiro no Worker.

O piloto inicial analisará JavaScript, TypeScript, JSX e TSX. Outros arquivos
podem fornecer contexto textual, mas não recebem promessa de análise estrutural.

> Escopo de arquivos evoluído pelo [ADR-0013](0013-use-tiered-structural-and-textual-review.md):
> JS/TS mantém análise estrutural e demais patches textuais elegíveis recebem
> review textual.

## Consequências

### Positivas

- Redelivery da Queue e retry de Workflow não criam uma segunda publicação.
- Runs concorrentes do mesmo PR são serializadas no ledger sem criar gargalo
  global.
- Código não confiável não compartilha runtime, credenciais ou autoridade de
  publicação com o control plane.
- A separação permite substituir Sandbox sem alterar domínio e casos de uso.

### Negativas

- O MVP passa a ter dois deployables e duas classes Durable Object.
- Testes completos do executor dependem de Docker e a prévia do Sandbox pode
  exigir atualização coordenada.
- Consultas agregadas entre PRs exigirão outro armazenamento no futuro.
- A autenticação GitHub no egress precisa de contrato e testes próprios.

## Critérios de confirmação

- Duas entregas iguais iniciam no máximo uma run lógica.
- Uma run antiga não publica depois que o head SHA muda.
- Retry após timeout ambíguo encontra a review pelo marcador antes de criar outra.
- O token de instalação não aparece em argv, ambiente, stdout, stderr ou arquivo
  do Sandbox.
- O executor nega hosts não autorizados e não executa lifecycle scripts.
- Testes de Durable Object provam claim atômico e transições condicionais.
- Teste local de Workflow prova retomada sem duplicar efeitos.
- O Dockerfile e o pacote Sandbox usam exatamente a mesma versão.

## Gatilhos para revisitar

- Sandbox 1.0 torna-se estável.
- Consultas globais e retenção exigem D1 ou armazenamento analítico.
- Workflows não atende um limite medido no corpus do piloto.
- Outra tecnologia oferece isolamento equivalente com menor custo comprovado.
