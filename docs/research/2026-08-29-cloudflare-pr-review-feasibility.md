---
id: RESEARCH-CF-PR-REVIEW-2026-08-29
kind: research
status: current
owners:
  - core-team
verified-at: 2026-08-29
evidence-level: primary-sources
related:
  - ../decisions/0001-adopt-incremental-mvp-architecture.md
---

# Viabilidade da Cloudflare para review contextual de PRs

## Conclusão executiva

A plataforma é tecnicamente compatível com o produto, mas a arquitetura inicial
superestimava algumas capacidades e reunia produtos demais na primeira entrega.
A recomendação é provar uma review assíncrona de ponta a ponta e adiar a camada
conversacional e o RAG contínuo.

O núcleo viável é: GitHub App, Worker de entrada, fila, coordenador durável,
análise isolada, AI Gateway e publicador GitHub. Workflows é a opção preferida
para o coordenador determinístico do primeiro MVP, sujeita a spike. Agents SDK e
`@cloudflare/think` tornam-se mais valiosos quando houver conversa persistente,
memória por PR e um loop de ferramentas de longa duração.

## Pergunta investigada

Os produtos Cloudflare propostos oferecem as primitivas necessárias para
receber eventos do GitHub, investigar código com contexto, executar modelos,
persistir estado e publicar comentários de review com segurança?

## Escopo e método

- Data de corte: 2026-08-29.
- Fontes: documentação oficial atual da Cloudflare e do GitHub.
- Fora do escopo: benchmark de custo, prova de carga, execução do Sandbox,
  qualidade de modelos e validação de limites por plano.
- Os estados da tabela significam `confirmed`, `partially-confirmed`,
  `incorrect`, `unknown`, `proposal` ou `superseded`.

## Registro de afirmações

| ID     | Afirmação original                                                            | Resultado             | Evidência e correção                                                                                                                                                                                                                                                                                                                       | Impacto                                                                                                         |
| ------ | ----------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| CF-001 | O Agents SDK fornece uma abstração de agente com estado sobre Durable Objects | `confirmed`           | Agents exigem Durable Objects e oferecem estado, SQL, scheduling, execução durável, Workflows e cliente MCP. O pacote documentado é `agents`, não `@cloudflare/agents`. [Agents API](https://developers.cloudflare.com/agents/runtime/agents-api/)                                                                                         | Corrigir o nome do pacote e avaliar a API real em spike                                                         |
| CF-002 | `@cloudflare/think` implementa o loop de raciocínio e ferramentas             | `confirmed`           | Think fornece loop com ferramentas, persistência de mensagens, streaming e estado em Durable Object SQLite. [Think](https://developers.cloudflare.com/agents/harnesses/think/)                                                                                                                                                             | Candidato forte para a fase conversacional; não é obrigatório no primeiro MVP                                   |
| CF-003 | Cada PR pode ser uma instância isolada com SQLite                             | `confirmed`           | Um Durable Object é globalmente único, single-threaded e possui armazenamento privado; Cloudflare recomenda SQLite para novos namespaces e modelagem por átomo de coordenação. [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)                                      | `repo_id:pr_number` é uma boa chave caso o MVP precise de coordenação por PR                                    |
| CF-004 | A Hibernation API pausa o agente enquanto aguarda LLM ou comandos externos    | `incorrect`           | Hibernação preserva WebSockets aceitos pela API hibernável quando o objeto fica ocioso. Um `fetch()` aguardado ou evento ainda em processamento impede hibernação. [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)                                                        | Não justificar chamadas longas de LLM com Hibernation; usar execução durável/Workflow e medir custo             |
| CF-005 | Workers podem validar e despachar webhooks GitHub                             | `confirmed`           | O GitHub exige HMAC-SHA256 sobre o corpo original, cabeçalho `X-Hub-Signature-256` e comparação em tempo constante. [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)                                                                                                      | O Worker de entrada deve validar antes de confiar no JSON                                                       |
| CF-006 | Queues garante entrega e retries                                              | `partially-confirmed` | A garantia padrão é at-least-once; duplicatas podem ocorrer e a ordem não é garantida. [Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)                                                                                                                                                      | Idempotência é requisito obrigatório, não otimização                                                            |
| CF-007 | Workflows oferece pipeline com checkpoints e retry por etapa                  | `confirmed`           | `step.do` persiste resultado, retoma do último passo concluído e aceita retry; Workflows também espera eventos externos. [Workflows](https://developers.cloudflare.com/workflows/)                                                                                                                                                         | Melhor candidato para a review one-shot determinística                                                          |
| CF-008 | AI Gateway oferece observabilidade, limites e fallback                        | `confirmed`           | A documentação atual lista logging/analytics, rate limiting, spend limits, dynamic routing e fallbacks. [AI Gateway features](https://developers.cloudflare.com/ai-gateway/features/)                                                                                                                                                      | Manter no MVP e configurar por metadados de run                                                                 |
| CF-009 | AI Gateway possui cache semântico                                             | `incorrect`           | O cache atual é por requisição idêntica; qualquer diferença em body, ferramentas ou parâmetros gera outra entrada. Cache semântico é descrito como evolução futura. [AI Gateway caching](https://developers.cloudflare.com/ai-gateway/features/caching/)                                                                                   | Hash de conteúdo e cache de análise devem ser responsabilidade explícita da aplicação                           |
| CF-010 | Workers AI pode executar modelos e embeddings                                 | `confirmed`           | Workers AI executa modelos em GPUs serverless e inclui tarefas como geração, classificação e embeddings. [Workers AI](https://developers.cloudflare.com/workers-ai/)                                                                                                                                                                       | Útil para triagem/embeddings somente após benchmark de qualidade e custo                                        |
| CF-011 | MCP remoto permite ferramentas padronizadas                                   | `confirmed`           | Agents podem conectar servidores MCP remotos, descobrir ferramentas e passá-las ao modelo. Para novos servidores remotos, Streamable HTTP é o transporte recomendado. [MCP client](https://developers.cloudflare.com/agents/tools/mcp/) e [transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/) | Manter uma interface de ferramentas; MCP não elimina a necessidade de construir e autorizar os servidores       |
| CF-012 | Vectorize serve para RAG do repositório                                       | `confirmed`           | Vectorize é um banco vetorial distribuído e suporta busca semântica/RAG com embeddings. [Vectorize](https://developers.cloudflare.com/vectorize/)                                                                                                                                                                                          | Capacidade válida, mas prematura até provar que busca textual/estrutural é insuficiente                         |
| CF-013 | R2 armazena snapshots e artefatos sem egress fees                             | `confirmed`           | R2 é S3-compatible, fortemente consistente e sem taxa de egress da Cloudflare. [How R2 works](https://developers.cloudflare.com/r2/how-r2-works/)                                                                                                                                                                                          | Adiar até existir artefato grande ou política de retenção concreta                                              |
| CF-014 | KV é adequado para configuração global                                        | `partially-confirmed` | KV é otimizado para leitura global, mas é eventualmente consistente e pode servir valor anterior durante o TTL. [Workers KV FAQ](https://developers.cloudflare.com/kv/reference/faq/)                                                                                                                                                      | Usar apenas para configuração tolerante a atraso, nunca para coordenação ou dedupe forte                        |
| CF-015 | KV deve armazenar tokens de repositório                                       | `incorrect`           | Workers Secrets são bindings criptografados para chaves e tokens; Secrets Store centraliza segredos por conta. [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) e [Secrets Store](https://developers.cloudflare.com/secrets-store/)                                                                     | Chave privada, webhook secret e credenciais de modelo nunca vão para KV                                         |
| CF-016 | Sandbox executa clone, parsers e linters em Linux isolado                     | `confirmed`           | Cada sandbox possui filesystem isolado e container Linux, mas o estado é perdido quando o container para. A documentação atual anuncia uma futura versão 1.0. [Sandbox lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/)                                                                                           | Spike deve validar cold start, rede, clonagem, limites, limpeza e custo antes de aceitar dependência            |
| CF-017 | Tunnel conecta runners ou MCP privados                                        | `confirmed`           | Cloudflare Tunnel cria conexões somente de saída entre `cloudflared` e a rede Cloudflare, sem IP público de origem. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)                                                                                                           | Adiar junto com runners privados                                                                                |
| GH-001 | A API GitHub publica comentários inline por coordenadas                       | `confirmed`           | O endpoint aceita `commit_id`, `path`, `line`, `side` e ranges; `position` está sendo descontinuado. Requer Pull requests: write e pode sofrer secondary rate limiting. [Review comments API](https://docs.github.com/en/rest/pulls/comments)                                                                                              | Persistir head SHA e validar coordenadas imediatamente antes de publicar                                        |
| GH-002 | Tokens de instalação podem ser persistidos como configuração                  | `incorrect`           | Tokens de instalação expiram em uma hora e devem ser emitidos sob demanda. [GitHub Apps REST API](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)                                                                                                                                                | Persistir somente identificadores e credenciais de origem; nunca tratar token efêmero como configuração durável |

## Avaliação por camada

### Entrada e backpressure

Worker e Queues formam uma fronteira adequada. O endpoint deve fazer pouco:
validar assinatura, validar tipo e tamanho, derivar uma chave de idempotência,
registrar metadados mínimos e publicar na fila. Como Queues é at-least-once, o
consumidor precisa assumir redelivery em todos os caminhos.

### Coordenação e estado

Há sobreposição real entre Workflows, Durable Objects e Agents SDK:

- Workflows resolve etapas duráveis, retries e espera por eventos.
- Durable Objects resolve serialização e estado fortemente consistente por PR.
- Agents SDK/Think resolve sessões, memória e loop conversacional.

Usar os três desde a primeira run aumenta o custo de entendimento. A primeira
implementação deve começar com Workflow e um contrato abstrato de ledger. Um
spike de idempotência decidirá se o ledger exige Durable Object SQLite. A
conversa por respostas em comentários, quando entrar no escopo, deve reavaliar
Agents SDK e Think.

### Execução de análise

Sandbox é a solução mais direta para `git`, tree-sitter, Semgrep e linters, mas
é também a dependência com maior incerteza operacional. O produto deve esconder
a execução atrás de uma interface para permitir substituição por runner externo
ou análise sem clone. Nenhum código de repositório deve ser executado fora de
uma política explícita de rede, CPU, memória, tempo e comandos permitidos.

### IA e recuperação

AI Gateway agrega provedores, telemetria e controles de custo. Workers AI e
Vectorize são complementos, não pré-requisitos. Antes de indexar todo o
repositório, o MVP deve medir quanto contexto é recuperado com diff, busca de
símbolos, busca textual e leitura dirigida.

### Publicação no GitHub

Findings precisam ser convertidos para coordenadas do diff atual. Um force-push
entre análise e publicação invalida o head SHA e deve cancelar ou reiniciar a
run. Comentários devem carregar um marcador invisível ou ID persistido para
permitir reconciliação após timeout ambíguo.

## Riscos ainda não validados

- Limites e custo reais de Sandbox para repositórios grandes.
- Estratégia segura para dependências e submódulos privados.
- Capacidade dos modelos escolhidos em reviews multilíngues e multi-stack.
- Política de retenção de código, prompts, respostas e logs de AI Gateway.
- Comportamento sob bursts, force-push e múltiplas runs concorrentes.
- Precisão da resolução de símbolos nas linguagens inicialmente suportadas.
- Limites de criação e retenção de Workflows no plano contratado.
- Necessidade real de DO SQLite para dedupe e conversa por PR.

## Decisão derivada

A investigação sustenta a abordagem incremental registrada em
[ADR-0001](../decisions/0001-adopt-incremental-mvp-architecture.md). Ela não
sustenta a adoção imediata de todos os produtos inicialmente listados.

## Erratas

Nenhuma até 2026-08-29.
