---
id: ARCH-RUNTIME-001
kind: architecture
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
related:
  - ../decisions/0004-adopt-workflows-do-ledger-and-sandbox-executor.md
  - ../decisions/0037-compile-repository-configuration-per-run.md
  - ../decisions/0039-partition-large-reviews-and-bound-concurrency.md
  - ../decisions/0049-use-cloudflare-think-for-pr-review.md
  - ../decisions/0050-verify-finding-causality-before-publication.md
---

# Fluxo de execução de uma review

Uma run pertence ao par head/base SHA do PR. O ledger SQLite por PR decide qual
run é a mais recente e registra a autoridade para análise, publicação e cleanup.
O resultado de uma run obsoleta não é publicado.

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant IN as Webhook Worker
    participant Q as Review Queue
    participant WF as ReviewWorkflow
    participant LE as Ledger por PR
    participant EX as Executor Sandbox
    participant AW as ReviewShardWorkflow
    participant AG as ReviewAgent Think
    participant GW as AI Gateway

    GH->>IN: pull_request assinado
    IN->>IN: HMAC e schema
    IN->>Q: envelope sem token
    Q->>WF: iniciar/reconciliar run
    WF->>LE: claim e supersede run anterior
    WF->>GH: configuração e diff canônico
    WF->>EX: preparar checkout no head exato
    WF->>WF: planejar shards e ondas
    loop Cada shard admitido (até três simultâneos)
      WF->>AG: startReview(run, shard, deadline)
      AG->>LE: validar autoridade
      AG->>AW: runWorkflow com ID determinístico
      AW->>AG: step.prompt com schema
      loop Turno Think, até 16 passos
        AG->>LE: reservar inferência
        AG->>GW: AI SDK via rota dinâmica
        GW-->>AG: stream/tool call
        opt read_file/search_text/search_structure
          AG->>LE: reservar tool por run
          AG->>EX: executar leitura ou busca autorizada
          EX-->>AG: resultado limitado
        end
      end
      AG-->>AW: resposta estruturada
      AW-->>WF: candidatos do shard
      WF->>WF: validar evidência no diff canônico
      opt Há candidatos válidos
        WF->>AG: startReview em conversa isolada, fase causal_verification
        AG->>AW: Workflow com identidade por fase
        AW->>AG: step.prompt para tentar refutar candidatos
        AG->>LE: reservar inferências e tools no mesmo saldo
        AG->>GW: até oito passos de verificação
        AG->>EX: inspecionar guardas, chamadores e contratos
        AG-->>AW: confirmed/refuted/inconclusive por candidato
        AW-->>WF: avaliações e resumo corrigido
        WF->>WF: liberar apenas confirmados; incerteza gera parcialidade
      end
    end
    WF->>WF: validar schema e evidência no diff
    WF->>GH: reler head/base
    alt SHAs iguais e run ainda atual
      WF->>GH: publicar uma review com veredito e achados inline
      WF->>GH: publicar Check Run
      WF->>LE: registrar IDs e concluir
    else run obsoleta
      WF->>LE: terminalizar sem publicar
    end
    WF->>EX: cleanup durável
```

O `ReviewWorkflow` continua coordenador. O Think controla o turno agentivo e a
saída estruturada; o executor controla acesso ao repositório. O ledger decide
causalidade e orçamento. A publicação permanece exclusivamente no host.

## Admissão e contexto

O webhook valida assinatura, tamanho e evento antes de normalizar a Queue.
Duplicatas e ordem de entrega não dão autoridade. A configuração do repositório
é compilada para a run e ancorada na base; o checkout ocorre no head exato. O
executor classifica patches como estruturais ou textuais e produz contexto
limitado. O plano admite até 16 arquivos, 768 linhas e 96 kB de patch por shard,
com no máximo 64 shards e três análises simultâneas. Contexto omitido gera
limitação explícita; não é tratado como cobertura.

O analisador estrutural produz pistas para investigar contratos, não findings.
Uma declaração de `interface` ou `type` movida e reexportada como tipo no mesmo
módulo não recebe a pista de símbolo exportado removido. Isso não substitui a
verificação de consumidores nem comprova que uma reexportação aponta para um
destino válido.

## Agent e tools

Um `ReviewAgent` isolado por run/shard/fase deriva de `Think`. `ReviewShardWorkflow`
usa `ThinkWorkflow.step.prompt` para investigação e, quando há candidatos
válidos, outro Agent e Workflow para verificação causal (ADR-0050). A identidade do Workflow é
estável em retries. Antes de cada turno, tool e conclusão, o Agent consulta o
ledger e o deadline. `getTools` registra somente `read_file`, `search_text` e
`search_structure`. MCP, bash e edição não são expostos. O executor revalida
path, escopo, política de egress, tamanho, deadline e autoridade no limite de
confiança próprio. Código e resultado de busca são dados não confiáveis.

O verificador tenta refutar cada candidato, lendo guardas, chamadores e contratos
fora do patch quando necessários. Sua saída estrita não contém findings novos:
apenas índice, resultado, confiança, justificativa e resumo corrigido. O host
exige exatamente uma avaliação por candidato e conserva somente `confirmed`
com confiança de pelo menos 0,8, usando o menor valor entre as duas fases.
Refutação confiável descarta o candidato; incerteza ou resposta inválida bloqueia
sua publicação e marca a revisão parcial. Limitações anteriores não são apagadas.
Resoluções anteriores seguem seu gate existente de evidência positiva.

O provider é AI SDK por AI Gateway Dynamic Route. `AGENT_TRACE_PAYLOADS` está
`enabled` durante o beta; **desabilitar quando o usuário solicitar**. Os spans
do Agent podem conter mensagens e outputs de tools. O Gateway mantém coleta
de payload desligada.

## Orçamento, falhas e idempotência

O ledger reserva recursos antes da inferência, incluindo chamadas, bytes de
entrada e máximo de saída. São 64 chamadas, 4.000.000 bytes e 120.000 tokens
de saída por run; uso incerto mantém a reserva. Tools compartilham 96 chamadas
por run entre todos os shards. Esses limites não são uma estimativa exata de
tokens de entrada ou custo monetário. Retry e eviction não renovam saldo.
As duas fases compartilham esses tetos e o mesmo deadline. A investigação
admite 16 passos; a verificação admite oito e um timeout de cinco minutos,
sempre subordinado ao deadline da análise. Sem candidatos não há fase extra.

O adapter espera o estado do Workflow do shard até o deadline da análise.
Cancelamento ou deadline terminam o Workflow filho; run obsoleta bloqueia novos
turnos e tools. Falhas terminais do shard viram resultado parcial explícito.
Falha de preparação, ledger ou Sandbox continua erro de infraestrutura do
Workflow pai. A análise nunca aprova uma área não examinada apenas porque os
shards concluídos não encontraram problemas.
Falha da verificação retém os candidatos e acrescenta
`causal_verification_incomplete`; cancelamento do pai é propagado sem resultado
publicável. Uma saída degradada não pode gerar `APPROVE`, mesmo sem findings.

O host valida a saída do Think com Zod e verifica cada finding e resolução
contra linhas RIGHT do diff canônico. Resolve um finding anterior apenas com
evidência positiva da correção. Antes de publicar, relê head/base, compara com a
run, usa claim condicional no ledger e reconcilia IDs externos após resposta
ambígua. Todos os caminhos terminais exigem cleanup durável do Sandbox.

O schema da resposta estruturada exige o campo `summary`, mas permite texto
vazio. Nesse caso, a normalização marca o shard como degradado, conserva os
candidatos a finding para a verificação de evidência e impede aprovação por
ausência de narrativa. Campos inválidos de finding continuam rejeitados.

A review enviada ao GitHub reúne o veredito e os novos achados inline na mesma
submissão. O host consulta os comentários dessa review para salvar seus IDs no
ledger e reconciliar retries. A primeira aprovação sem achados usa um resumo
estruturado das mudanças; aprovações posteriores sem achados novos usam uma
mensagem curta com o SHA. O Check Run continua com o resultado completo.
Todos os resumos de review usam cabeçalho `Holon` com resultado, contagem e
cobertura, seguido por seções para mudanças revisadas ou limites da análise.
Uma falha ou degradação de shard aparece como revisão incompleta, mesmo com
zero achados verificados; arquivos sem alterações elegíveis recebem um estado
próprio, sem aprovação implícita. O mesmo formato é aplicado após feedback
humano e nas aprovações curtas posteriores.
Sinais heurísticos de ausência de teste correspondente não são calculados nem
publicados.

## Funcionalidades retiradas

O control plane ignora `workflow_run`. Não baixa ZIP/LCOV/JUnit, não persiste
novas evidências de CI e não acrescenta esse bloco ao comentário. Tabelas
históricas do ledger permanecem sem leitores. A avaliação live do motor antigo
foi retirada; a avaliação offline recorded permanece. Um smoke remoto com a
rota e o modelo reais ainda é necessário para provar streaming, tool calling e
`think_final_answer`; build local e testes Workerd não comprovam essa integração.

## Memória incremental — 2026-10-04

Pela [ADR-0051](../decisions/0051-learn-repository-rules-with-maintainer-approval.md), antes da análise a run sela memória relevante aos paths preparados. Shards recebem regras aprovadas e pistas históricas com origem. Análise e feedback criam outbox transacional para memória por repositório, entregue pelo alarm do ledger. A memória orienta investigação e não altera a validação causal, a evidência ou o veredito. Consulte [o fluxo de memória](repository-memory.md).

## Perguntas posteriores à publicação

Após uma review concluída, uma resposta explícita ao finding segue webhook HMAC → Queue → validação autenticada da discussão e autorização → admissão no ledger → `FindingClarificationAgent`/`FindingClarificationWorkflow`. O Agent lê arquivos regulares do snapshot GitHub no head SHA fixado, aplica exclusões recompiladas no base SHA e reservas próprias. O Workflow valida trechos contra leituras, registra a conclusão e reconcilia a resposta no comentário raiz. Uma refutação retira o finding e recalcula o Check Run canônico; não publica nova review nem apaga o diagnóstico original. Novo head/base ou perda de autoridade impedem a mutação/publicação. Veja a [ADR-0052](../decisions/0052-answer-finding-questions-in-pr-threads.md).
