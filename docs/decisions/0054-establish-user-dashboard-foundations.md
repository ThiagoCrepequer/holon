---
id: ADR-0054
kind: decision
status: accepted
date: 2026-10-06
owners:
  - core-team
supersedes: []
related:
  - 0040-retire-admin-and-analytical-storage.md
  - ../planning/dashboard-engineering-decision-review.md
  - ../research/2026-10-05-dashboard-milestone-zero-results.md
  - ../architecture/user-dashboard.md
---

# Estabelecer as fundações do dashboard dos usuários

## Contexto e problema

Q1–Q37 definiram um dashboard para os usuários, com sessão GitHub, workspaces,
leitura autorizada e convites duráveis. O milestone 0 qualificou localmente React
Router/Hono, Lingui, a ponte manual TanStack Query, Better Auth/Drizzle/D1 com
reserva durável de code e recuperação por ledger/alarm. É necessário transformar
essas provas em fronteiras de implementação sem misturar SSR/API, adapters e UI.

A ADR-0040 permanece vigente: o admin, a projeção analítica e sua Queue foram
retirados. O dashboard é uma superfície nova; sua projeção funcional não restaura
custos, logs, retenção analítica ou endpoints antigos.

## Direcionadores

- Autorização compartilhada entre SSR e API, sem duplicar política de produto.
- Dependências externas concentradas em capacidades úteis dos packages.
- Transações locais para identidade, tenancy, convites e intenção de envio.
- Testes de comportamento na fronteira real e operações remotas explícitas.

## Opções consideradas

1. SPA e API em deployables separados: separa transporte, mas acrescenta origens,
   cookies e composição duplicada sem necessidade demonstrada para o MVP.
2. SSR/ações como única superfície de dados: simplifica algumas telas, mas mistura
   navegação com comandos e dificulta a política manual de requests acordada.
3. React Router SSR e Hono no mesmo Worker, por interfaces compartilhadas:
   mantém a origem única e responsabilidades explícitas. Exige testar hidratação,
   CSP e remoção de módulos de servidor no bundle.
4. Um D1 para todo o produto: simplifica bindings; busca/projeção disputa a
   autoridade de sessão/tenancy. Dois D1 separam carga e autoridade, mas não
   oferecem transação distribuída. A separação é uma decisão de responsabilidade,
   não um benchmark de throughput.
5. Importar bibliotecas diretamente em todas as rotas: reduz arquivos no início,
   mas espalha contratos de ORM/auth/ícones e política visual. Wrappers que só
   reexportam SDKs também preservam esse acoplamento.

## Decisão

Adotar a opção 3, dois D1 e packages com interfaces por capacidade:

- `apps/dashboard`: React Router Framework + Vite/Cloudflare para documento,
  navegação e bootstrap; Hono para `/api/*` e interações explícitas. SSR chama a
  capacidade autorizada diretamente, sem HTTP para a própria API. Mutação não
  ocorre por GET/HEAD ou por loaders; comandos futuros usam API POST validada.
- `packages/application/dashboard-ports` e `packages/contracts/dashboard`:
  identidade, membership, leitura de metadados e wake-up de entrega. Sessão não
  equivale a acesso ao repo; o escopo de leitura é composto no servidor depois
  de verificar sessão, membership, instalação e grants GitHub.
- `packages/db`: somente subpaths `identity/server` e `projection/server`.
  ORM, SQL, rows e migrations pertencem ao package. Identidade contém sessão,
  perfil, tenancy, convite/intenção/outbox; projeção contém metadados derivados.
  As tabelas de cada comportamento entram na issue dona, sem schema hipotético.
- `packages/ui`: controles e primitivas da marca com React, Lucide e tokens/fontes
  locais. Os exports são específicos por componente; sem auth, HTTP, tenancy ou
  Query. `components.json` prepara shadcn em monorepo; incorporar um componente
  exige adaptar tokens, acessibilidade e CSP, sem reexportar a biblioteca inteira.
- `packages/auth` será criado em M2, com exports servidor/cliente estritos e
  integração do plugin público aprovado em M0. Não há um package vazio em M1.
- `apps/email-delivery`: Worker privado. HTTP devolve 404; RPC `wake(operationId)`
  não aceita destinatário, conteúdo ou token. M4 introduz publisher, Queue/DLQ,
  consumer e reconciliação da intenção durável no D1 de identidade. A fila
  transporta uma referência, não a autoridade nem uma obrigação exclusiva.
- O ledger do core continua autoritativo para detalhe e mudanças observáveis.
  M5 adiciona projeção monotônica por obrigação/alarm existentes, sem nova Queue
  de projeção, chamadas ao core por linha da lista ou transação entre D1s.

React/Router/Hono são dependências diretas de composição. Lingui fica no app
porque negociação por request, catálogos e provider são próprios da superfície.
TanStack Query fica no app nas features de dados; nenhum dataset privado existe
na fundação. Motion, gráficos, Table e Form só entram com comportamento concreto.

A UI mínima usa controles HTML e `<dialog>` nativo: top layer, inert e foco são
responsabilidades do browser, testadas nos três engines. Isso evita introduzir
injeção de estilos que conflite com `style-src 'self'`. Não é um fallback para
uma lib bloqueada; novos overlays precisam demonstrar o mesmo contrato.

## Consequências

Positivas: origem única, regras reutilizadas, boundaries testáveis e migrations
com dono. UI usa a Semente e Lucide com stroke 1.75, fontes locais e movimento
semântico; a camada de persistência não chega ao navegador.

Negativas: dois bancos e um Worker de entrega exigirão configuração/operação
coordenada; ausência de transação distribuída requer obrigação e confirmação
idempotentes. Catálogos, hidratação e CSS compartilhado exigem gates próprios.
A matriz local automatizada não comprova dispositivos reais nem provedores.

## Critérios de confirmação

- Import/export/grafo e contratos rejeitam entradas e relações indevidas.
- DOM testa controles; Workerd testa D1, HTTP e RPC; Playwright comprova SSR,
  hidratação, CSP, idiomas, foco, tema e movimento reduzido com zero retries.
- `pnpm verify` inclui marca/contraste e conserva limites 90%/85% nas camadas
  instrumentadas; composições framework são exercitadas no artefato real.
- Builds e dry-runs isolados passam sem criar recursos ou publicar. Recursos
  sintéticos locais não podem ser usados para uma promoção remota.
- Os cenários de sessão/tenancy/idempotência, convites/email e leitura privada
  acompanham os fluxos donos em M2–M5; a fundação não encerra esses gates por tipos.

## Gatilhos para revisitar

Um novo consumidor, fluxo com outra origem, contenda medida ou limitação suportada
que altere segurança, persistência ou transporte exige evidência e novo ADR.
Upgrade de auth/runtime requalifica as provas, especialmente o callback OAuth;
a primitiva de adapter sozinha não prova consumo único de code.

## Fontes conferidas em 2026-10-06

- [React Router em Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/).
- [CSP do React Router](https://reactrouter.com/how-to/security).
- [shadcn em monorepo](https://ui.shadcn.com/docs/monorepo).
- [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
- [Service bindings RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/).
