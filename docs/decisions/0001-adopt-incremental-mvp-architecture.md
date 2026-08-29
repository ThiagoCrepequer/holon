---
id: ADR-0001
kind: decision
status: accepted
date: 2026-08-29
owners:
  - core-team
supersedes: []
related:
  - ../research/2026-08-29-cloudflare-pr-review-feasibility.md
  - ../product/mvp-scope.md
---

# Adotar arquitetura incremental para o MVP

## Contexto e problema

A visão inicial combina Worker, Queue, Workflows, Agents SDK, Durable Objects,
Sandbox, MCP, AI Gateway, Workers AI, Vectorize, R2, KV e Tunnel. Todos podem ter
um papel no produto final, mas adotá-los simultaneamente dificultaria descobrir
se a review contextual produz valor e tornaria falhas difíceis de localizar.

Precisamos escolher a menor fatia que valide o diferencial do produto: detectar
um problema que exige investigar código fora do diff e publicar feedback correto
no GitHub.

## Direcionadores

- Validar qualidade da review antes de otimizar escala e memória de longo prazo.
- Processar webhooks sem bloquear a resposta ao GitHub.
- Sobreviver a falhas transitórias e redeliveries.
- Isolar análise de código não confiável.
- Manter liberdade para trocar modelo e executor.
- Evitar componentes sem requisito ou benchmark comprovado.

## Opções consideradas

### A. Plataforma completa desde o primeiro release

Inclui todos os produtos propostos e conversa persistente.

- Prós: aproxima imediatamente a visão final.
- Contras: muitas fronteiras novas, custo operacional alto e pouca capacidade de
  atribuir ganho de qualidade a um componente.

### B. Review síncrona em um único Worker

O webhook baixa o diff, chama o modelo e publica comentários na mesma request.

- Prós: implementação pequena.
- Contras: acopla latência e falha ao webhook, não oferece backpressure e é
  inadequada para análise com ferramentas e retries.

### C. Fatia vertical assíncrona e incremental

Worker valida e enfileira; um coordenador durável executa etapas delimitadas;
um executor isolado investiga o repositório; AI Gateway chama o modelo; um
adaptador publica no GitHub. Capacidades avançadas entram somente após evidência.

- Prós: prova o valor central com fronteiras testáveis e substituíveis.
- Contras: conversa, RAG e memória rica ficam para depois; ainda exige desenho
  explícito de idempotência.

## Decisão

Escolhemos a opção C.

O primeiro MVP será uma review one-shot por head SHA. Workers e Queues formam a
entrada; Workflows é a opção preferida para coordenar etapas, condicionada a um
spike; o executor de repositório terá interface própria; AI Gateway abstrairá os
modelos; e a GitHub REST API publicará findings e resumo.

O desenho deve conter um `ReviewLedger` abstrato. A implementação concreta será
decidida após o spike de idempotência. Durable Object SQLite continua candidato,
mas não deve ser introduzido apenas para manter memória conversacional que ainda
está fora do escopo.

Agents SDK e `@cloudflare/think` serão reavaliados quando respostas em comentários
e memória persistente por PR entrarem no produto. Vectorize, R2, Workers AI e
Tunnel permanecem adiados até haver requisito mensurável.

## Consequências

### Positivas

- O primeiro teste de valor cobre o fluxo real de ponta a ponta.
- Cada integração pode ser simulada e validada separadamente.
- Falhas do modelo não bloqueiam o recebimento do webhook.
- Produtos adicionais precisam justificar seu custo com evidência.

### Negativas

- O MVP não cumpre ainda toda a visão de agente conversacional.
- Idempotência de comentários exige trabalho explícito.
- A interface do executor precisa antecipar mais de uma implementação.
- Uma adoção posterior de Agents SDK pode exigir migrar estado.

## Critérios de confirmação

- O mesmo webhook entregue duas vezes produz no máximo uma run efetiva.
- Retry após timeout de publicação não duplica comentário.
- Um novo head SHA cancela ou torna obsoleta a run anterior.
- O sistema encontra pelo menos uma regressão que dependa de arquivo fora do
  diff no conjunto de avaliação.
- Um repositório malicioso não executa comandos fora da política do sandbox.
- O modelo pode ser trocado sem alterar o domínio de findings.

## Gatilhos para revisitar

- Inclusão de respostas do desenvolvedor como entrada conversacional.
- Necessidade de serializar múltiplas runs por PR.
- Necessidade comprovada de busca semântica além da busca estrutural.
- Sandbox não atende limites, isolamento ou custo.
- Workflows não oferece as garantias necessárias no spike.
