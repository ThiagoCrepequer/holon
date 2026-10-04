---
id: PRODUCT-MVP-SCOPE
kind: product
status: accepted
owners:
  - core-team
last-reviewed: 2026-10-04
related:
  - ../decisions/0001-adopt-incremental-mvp-architecture.md
  - ../decisions/0013-use-tiered-structural-and-textual-review.md
---

# Escopo do MVP

O MVP e uma fatia vertical de review automatizada e assincorna para GitHub. Ele
prova a qualidade do ciclo diff -> investigacao -> finding -> comentario antes
de introduzir memoria conversacional, RAG de repositorio ou multiagentes.

## Incluido

- GitHub App instalado em repositorios explicitamente autorizados.
- Eventos `pull_request` para abertura e atualizacao do head SHA.
- Validacao HMAC do corpo bruto do webhook antes de qualquer parsing confiavel.
- Desacoplamento assincorno entre recebimento e processamento.
- Uma `review run` por repositorio, PR e head SHA.
- Obtencao do diff canonico e do contexto estritamente necessario do repositorio.
- Review estrutural de JavaScript, TypeScript, JSX e TSX.
- Review textual de patches elegiveis em documentacao, configuracao e outras
  linguagens, sem promessa de compreensao de AST.
- Exclusao heuristica de binarios, lockfiles, minificados, sourcemaps, artefatos
  gerados, vendorizados, builds e caminhos potencialmente sensiveis.
- Busca textual e estrutural por usos relacionados a mudancas criticas, limitada
  pelo modo e pela mesma politica de exclusao do contexto inicial.
- Loop de analise com numero limitado de passos e ferramentas permitidas.
- Findings estruturados com evidencia, severidade e coordenadas do diff.
- Comentarios inline e um resumo por run.
- Perguntas e contestações explícitas na discussão de findings, com investigação limitada e evidência verificável (ADR-0051).
- Protecao contra redelivery e duplicacao de efeitos externos.
- Logs e metricas minimos de tempo, falhas, tokens e findings publicados.

## Explicitamente fora do primeiro MVP

- Conversa persistente quando um desenvolvedor responde ao bot.
- Review automatizada de GitLab.
- RAG completo e indexacao continua com Vectorize.
- Cache de ASTs e snapshots historicos em R2.
- Runners on-premise acessados por Cloudflare Tunnel.
- Multiagentes e delegacao dinamica.
- Correcao automatica ou push de commits para a branch do desenvolvedor.
- Bloqueio automatico de merge.
- Relatorios PDF ou HTML extensos.

## Componentes selecionados para a primeira fatia

| Capacidade             | Opcao atual                    | Estado                                                         |
| ---------------------- | ------------------------------ | -------------------------------------------------------------- |
| Entrada HTTP           | Cloudflare Worker              | Incluida                                                       |
| Buffer e backpressure  | Cloudflare Queues              | Incluida                                                       |
| Etapas duraveis        | Cloudflare Workflows           | Implementada e coberta no runtime local                        |
| Coordenacao por PR     | Durable Object com SQLite      | Implementada como ledger atomico por PR                        |
| Analise com filesystem | Cloudflare Sandbox SDK         | Implementada em deployable isolado; imagem validada localmente |
| Chamadas de modelo     | Cloudflare AI Gateway          | Incluida                                                       |
| Modelo principal       | ID configuravel via AI Gateway | Provedor/modelo final do piloto ainda em aberto                |
| Modelo auxiliar        | Workers AI                     | Adiado ate existir tarefa e benchmark claros                   |
| Publicacao             | GitHub REST API                | Incluida                                                       |

## Criterio de sucesso

O MVP sera considerado validado quando uma bateria de PRs representativos
mostrar que o sistema encontra regressões contextuais reais, publica comentarios
nas linhas corretas, nao duplica efeitos em redeliveries e mantem uma taxa de
falsos positivos aceitavel definida pelo contrato de qualidade.
