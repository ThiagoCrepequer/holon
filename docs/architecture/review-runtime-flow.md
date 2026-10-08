---
id: ARCH-RUNTIME-001
kind: architecture
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
related:
  - ../decisions/0004-adopt-workflows-do-ledger-and-sandbox-executor.md
  - ../decisions/0037-compile-repository-configuration-per-run.md
  - ../decisions/0039-partition-large-reviews-and-bound-concurrency.md
  - ../decisions/0049-use-cloudflare-think-for-pr-review.md
  - ../decisions/0050-verify-finding-causality-before-publication.md
  - ../decisions/0055-fund-large-reviews-with-protected-investigation.md
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
      loop Investigação Think, até quatro passos
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
      opt Resumo vazio
        AW->>AG: recuperar narrativa em um step.prompt durável
        AG->>LE: reservar uma inferência no mesmo orçamento
        AG->>GW: um passo, somente final answer
        AG-->>AW: resumo e limitações, sem alterar candidatos
      end
      AW-->>WF: candidatos do shard
      WF->>WF: validar evidência no diff canônico
      opt Há candidatos válidos
        WF->>AG: startReview em conversa isolada, fase causal_verification
        AG->>AW: Workflow com identidade por fase
        AW->>AG: step.prompt para tentar refutar candidatos
        AG->>LE: reservar inferências e tools no mesmo saldo
        AG->>GW: até dois passos de verificação
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
com no máximo 64 shards estruturais e três análises simultâneas. Antes do
despacho, a [ADR-0055](../decisions/0055-fund-large-reviews-with-protected-investigation.md)
admite todas as partes e fixa um perfil por quantidade e tamanho estimado dos
prompts. O plano efetivo fixa `totalShards` antes do digest e conserva os totais
elegíveis. Referências estruturais unem produtor/consumidor alterados; até oito
partes adicionais investigam relações separadas por limites, com janelas
canônicas de até 80 linhas por arquivo. `contract_checks` registra relações que
não couberam; contexto omitido permanece explícito e não conta como cobertura.

O coordenador mantém contexto validado, plano e digest apenas na memória da
invocação de análise. Cada onda compartilha uma barreira de preparação: verifica
a presença do contexto e adquire o lease antes de iniciar peers. Se o Sandbox
precisar ser reconstruído, o snapshot é invalidado e relido; uma retomada do
Workflow começa com memória nova. O digest precisa coincidir com o checkpoint
do planejamento antes de qualquer shard vivo e antes da agregação. O contexto
completo não é serializado como resultado de step. Sem reconstrução, 50 shards
usam uma leitura completa e um cálculo do digest nessa invocação.

O analisador estrutural produz pistas para investigar contratos, não findings.
A verificação de símbolos exportados removidos utiliza a AST completa do módulo
em HEAD (`@babel/parser`): declarações movidas e reexportadas (inclusive via
fachadas multiline e aliases públicos) não disparam alerta se o nome público e o
namespace correspondente continuarem expostos no módulo original. `interface` e
`type` exigem o namespace type; `class`, `function` e `const` exigem o namespace
value. Classes e enums podem expor ambos; funções e variáveis não preservam um
tipo homônimo. Reexportar uma classe somente como tipo não preserva seu valor.
Declarações `declare` não comprovam um valor implementado; uma variável ambiente
também não cria um tipo homônimo.
Arquivo ausente do inventário, erro de parse ou
namespace incerto conservam o alerta. O inventário do repositório prioriza a
leitura dos módulos alterados antes dos consumidores downstream, respeitando os
tetos de 100 arquivos, 64 kB por arquivo e 1 MB total; o esgotamento da cota
pelos módulos alterados marca truncamento de downstream. Arquivos que excedem
os tetos não entram no inventário. Antes de ler conteúdo, o inventário consulta
modo e tamanho no HEAD com `git ls-tree`: somente blobs regulares cabem nessa
prova. Symlinks, submódulos, metadados ausentes ou inválidos e arquivos maiores
que o teto não autorizam leitura; a omissão conserva a pista e marca truncamento.
Esse comando não faz checkout, fetch ou execução de código do repositório.
Fonte oficial, consultada em 2026-10-08:
[Git ls-tree](https://git-scm.com/docs/git-ls-tree).
Isso não substitui a verificação de
consumidores, a compatibilidade do contrato nem comprova que uma reexportação
aponta para um destino válido. Os plugins seguem a extensão do arquivo; erro
de sintaxe não é recuperado para suprimir uma pista. Fonte oficial, consultada
em 2026-10-08: [Babel Parser](https://babeljs.io/docs/babel-parser).

## Agent e tools

Um `ReviewAgent` isolado por run/shard/fase deriva de `Think`. `ReviewShardWorkflow`
usa `ThinkWorkflow.step.prompt` para investigação e, quando há candidatos
válidos, outro Agent e Workflow para verificação causal (ADR-0050). A identidade do Workflow é
estável em retries. Antes de cada turno, tool e conclusão, o Agent consulta o
ledger e o deadline. `getTools` registra somente `read_file`, `search_text` e
`search_structure`. MCP, bash e edição não são expostos. O executor revalida
path, escopo, política de egress, tamanho, deadline e autoridade no limite de
confiança próprio. Código e resultado de busca são dados não confiáveis.

Quando o resultado estruturado tem resumo vazio, o Workflow conserva o draft
validado e registra `summary_missing`. Uma única chamada a `step.prompt` com
nome `recover-summary` pede apenas narrativa, degradação e limitações; seu
schema estrito não aceita findings, resoluções ou observações. O Agent persiste
o modo de recuperação no estado durável e restringe o turno a um passo e
`think_final_answer`, com no máximo 1.024 tokens de saída. O middleware existente
reserva essa inferência no orçamento agregado da fase `investigation`. O wait
é limitado ao menor valor entre 60 segundos e o deadline restante.

Uma narrativa válida remove somente `summary_missing`; outras limitações e
degradação declarada no draft ou na recuperação permanecem. Falha de schema,
provider, orçamento ou timeout conserva o draft e o motivo explícito. Run
obsoleta ou expirada continua abortando antes de devolver um resultado. O
step idempotente do Think mantém a mesma identidade em retomadas do Workflow;
não há loop próprio de modelo nem síntese agregada adicional.

O verificador tenta refutar cada candidato, lendo guardas, chamadores e contratos
fora do patch quando necessários. Sua saída estrita não contém findings novos:
apenas índice, resultado, confiança, justificativa e resumo corrigido. O host
exige exatamente uma avaliação por candidato e conserva somente `confirmed`
com confiança de pelo menos 0,8, usando o menor valor entre as duas fases.
Refutação confiável descarta o candidato; incerteza ou resposta inválida bloqueia
sua publicação e marca a revisão parcial. Limitações anteriores não são apagadas.
Resoluções anteriores seguem seu gate existente de evidência positiva.

O provider é AI SDK por AI Gateway Dynamic Route. `stream_options.include_usage`
é solicitado em streaming para obter o uso reportado pelo provedor; uso ausente
mantém a reserva de saída. O hook
`transformRequestBody` impõe `provider.require_parameters=true` (restringindo a
seleção a nós que suportam os parâmetros enviados, incluindo `tool_choice`) e define
`reasoning: { enabled: false }` (removendo parâmetros contraditórios de esforço/teto
para prevenir reativação implícita de raciocínio). `AGENT_TRACE_PAYLOADS` está
`enabled` durante o beta; **desabilitar quando o usuário solicitar**. Os spans
do Agent podem conter mensagens e outputs de tools. O Gateway mantém coleta
de payload desligada. O hook `onStepEnd` do Agent emite o evento
`model.step_finished` com telemetria allowlisted (stepNumber, finishReason, tools
permitidas e contagens seguras de tokens), sem expor texto, diffs ou raciocínio.

## Causas de falha no filho

O Agent persiste somente códigos allowlisted, sem prompt ou mensagem arbitrária.
Na inicialização, `onStart` adiciona duravelmente o campo `reviewFailure: null`
quando ausente no estado já persistido, preservando os demais dados antes da
retomada de submissions pelo Think. Os RPCs de causa são assíncronos para iniciar
o lifecycle quando a chamada acorda um objeto frio, conforme Agents 0.26.0.
O adapter consulta `getReviewFailure()` quando o filho falha; não depende da
mensagem de `Workflow.status()`, que pode virar `WorkflowFatalError`. Orçamento
agregado e da parte são distinguidos, assim como `model_output_missing`,
`model_schema_invalid` e `agent_deadline_exceeded`. Falhas sem causa reconhecida
continuam `agent_workflow_failed`. Ausência da ferramenta final não prova a causa
no modelo ou na rota; não há parser de texto nem resposta limpa fabricada.

## Orçamento, falhas e idempotência

O ledger sela perfil, estimativa de entrada e pesos antes do despacho. Os perfis
`normal`, `large` e `very_large` permitem respectivamente 64/192/512 inferências,
4/12/32 MB de entrada cumulativa, 120/360/960 mil tokens de saída e 96/288/768
tools. Retry e eviction não renovam saldo; uso incerto mantém a reserva.
Cada parte protege quatro inferências, três tools e uma parcela igual de 70%
da entrada/saída; o saldo é ponderado por pistas de risco. O checkpoint do
resultado precede a liberação durável de sobra para partes ainda abertas.
Chamadas e entrada gastas não são recuperadas. Perfis não estimam faturamento.

Tools recebem até 1.000 tokens de saída; a finalização forçada recebe até 5.000
na investigação e 2.500 na verificação causal. Recuperação mantém 1.024. Think
continua controlando `toolChoice` e finalização. Recusas locais falham somente
a parte atual; cobertura incompleta ou saída degradada nunca aprova o PR.

A primeira recusa de teto agregado persiste sua dimensão em
`model_generation_plans.stop_reason`, na mesma transação da decisão de admissão
(migração aditiva 22). Antes de admitir cada nova onda, um step consulta o
ledger da run atual em execução. Havendo recusa, nenhum novo Agent é iniciado:
os shards ainda não admitidos recebem `model_budget_exhausted`. A onda já
admitida é aguardada integralmente; seus peers podem terminar dentro dos tetos
originais. Settlement não apaga a parada, mesmo se liberar saída reservada.
Isso é uma política conservadora de admissão, não uma afirmação de saldo zero.

Uma recusa na última onda também é lida em checkpoint antes da agregação. A
publicação conserva achados verificados, informa o orçamento esgotado no idioma
configurado e permanece parcial; não produz aprovação limpa nem resolução por
silêncio. Falhas de ledger, contexto ou preparação continuam terminais. Sem
recusa durável, o caso em que todos os shards falham no modelo continua erro.

O `holon-control-plane` configura `limits.cpu_ms=60000`. O limite pertence ao
script e suas invocações, não é um saldo independente por callback de análise.
A margem acompanha a redução de leituras/planejamento repetidos e mantém teto
finito; waits de rede não são CPU. O valor não substitui medição remota. Veja
[evidência e limites do ajuste](../research/2026-10-07-pr171-cpu-and-budget-exhaustion.md)
e [limites oficiais de Workflows](https://developers.cloudflare.com/workflows/reference/limits/)
(verificados em 2026-10-07).

As duas fases compartilham esses tetos e o mesmo deadline. A investigação
admite quatro passos; a verificação admite dois e um timeout de cinco minutos,
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
