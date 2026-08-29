---
id: ADR-0003
kind: decision
status: accepted
date: 2026-08-29
owners:
  - core-team
supersedes: []
related:
  - 0001-adopt-incremental-mvp-architecture.md
  - 0002-adopt-typescript-monorepo-toolchain.md
  - ../architecture/technical-ecosystem.md
  - ../architecture/container-view.md
---

# Adotar stack TypeScript inicial e um unico control-plane Worker

## Contexto e problema

ADR-0001 define responsabilidades de ingress, Queue consumer, coordenacao,
analise, modelo e publicacao. Isso nao implica que cada responsabilidade precise
ser um deploy separado. Tambem precisamos selecionar bibliotecas de fronteira
sem deixa-las atravessar o dominio.

## Direcionadores

- Minimizar deploys, bindings e secrets no primeiro slice.
- Preservar corpo bruto para validar HMAC antes de parsear o webhook.
- Validar em runtime toda entrada externa e saida do modelo.
- Manter SDKs de GitHub e LLM atras de portas da aplicacao.
- Nao permitir que o modelo publique efeitos externos diretamente.
- Adiar dependencias cuja API ainda depende de spike.

## Opcoes consideradas

### A. Um Worker por responsabilidade

Webhook, Queue consumer e Workflow seriam scripts e deploys separados.

- Pros: isolamento operacional imediato.
- Contras: mais configuracao, bindings, observabilidade e deploys antes de haver
  perfis de escala ou seguranca diferentes.

### B. Um control-plane Worker e um executor separado quando validado

O mesmo script hospeda `fetch`, `queue` e a definicao do Workflow. Dominio e
adaptadores ficam em pacotes internos. O executor e outro deployable porque usa
container e politica de recursos distinta.

- Pros: menor superficie operacional sem misturar execucao nao confiavel ao
  control plane.
- Contras: ingress e consumidor compartilham ciclo de deploy e limites do mesmo
  script.

### C. Aplicacao Node baseada em Probot fora de Workers

- Pros: abstracoes prontas para GitHub Apps.
- Contras: desalinha o runtime escolhido, introduz middleware Node e reduz o uso
  direto de bindings Cloudflare.

## Decisao

Escolhemos a opcao B.

`apps/control-plane` sera o primeiro deployable. Ele reunira o handler HTTP, o
consumer da Queue e, se o spike confirmar ADR-0001, a definicao de Workflow. O
codigo compartilhado ficara em pacotes internos; aplicacoes nunca serao
dependencias de outras aplicacoes.

As bibliotecas iniciais serao:

- Hono apenas para roteamento e middleware HTTP do ingress;
- Zod 4 para schemas nas fronteiras de webhook, Queue, Workflow, ferramentas e
  findings;
- Octokit modular, com `@octokit/auth-app`, `@octokit/core`, tipos de webhook e
  metodos de verificacao de assinatura;
- AI SDK Core e `ai-gateway-provider`, encapsulados por `ModelClient`;
- a biblioteca `diff`, encapsulada por um adapter de unified diff e coberta por
  fixtures Git reais;
- Vitest e `@cloudflare/vitest-plugin` conforme ADR-0002.

Hono, Octokit, AI SDK, o parser de diff e APIs Cloudflare nao podem ser importados
por `domain`. O modelo recebe ferramentas read-only e devolve candidatos. A
aplicacao valida coordenadas, head SHA, deduplicacao e politica antes de chamar o
publicador GitHub.

Nao adotaremos framework de dependency injection, ORM, Probot ou framework de
agentes no primeiro slice. Composicao sera explicita no entrypoint. A versao do
Sandbox SDK e a implementacao do `ReviewLedger` continuam em aberto conforme os
spikes de ADR-0001.

## Consequencias

### Positivas

- Um deploy cobre a entrada e coordenacao sem adicionar chamadas Worker-to-Worker.
- O executor mantem trust boundary e perfil de recursos proprios.
- SDKs externos podem ser substituidos sem alterar dominio ou casos de uso.
- Schemas de ferramentas e findings servem simultaneamente para runtime e IA.
- O modelo nao possui autoridade para produzir efeitos no GitHub.

### Negativas

- Mudanca em ingress ou consumer publica o mesmo script.
- Hono e uma dependencia adicional para poucos endpoints iniciais.
- Zod em toda fronteira exige mapeamento explicito para tipos de dominio.
- `diff` precisa de adapter e corpus de fixtures para cobrir o dialeto Git.

## Criterios de confirmacao

- O Worker valida a assinatura sobre o body bruto antes do parse.
- Um teste local cobre `fetch` e outro cobre o Queue consumer no runtime Workers.
- Nenhum pacote de dominio importa Cloudflare, Hono, Octokit, Zod ou AI SDK.
- Trocar o fake de `ModelClient` pelo adapter real nao altera o caso de uso.
- A saida invalida do modelo nao chega ao GitHub publisher.
- Comentarios usam coordenadas `line` e `side`, nunca `position` como contrato
  interno.

## Gatilhos para revisitar

- Ingress e consumidor passam a exigir escalabilidade, secrets ou deploys
  independentes.
- Hono deixa de oferecer valor frente a Fetch direto.
- Uma biblioteca selecionada nao suporta o runtime Workers ou TypeScript 7.
- O executor pode ser incorporado com isolamento equivalente, ou precisa sair da
  Cloudflare.
- A fase conversacional justifica Agents SDK e estado persistente por PR.
