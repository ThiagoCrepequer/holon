---
id: ARCH-RUNTIME-001
kind: architecture
status: current
owners:
  - core-team
last-reviewed: 2026-09-10
related:
  - ../decisions/0001-adopt-incremental-mvp-architecture.md
  - ../decisions/0003-adopt-initial-typescript-application-stack.md
  - ../decisions/0006-use-granular-workflow-checkpoints.md
  - ../decisions/0013-use-tiered-structural-and-textual-review.md
  - ../decisions/0014-version-executor-rpc-and-broker-github-credentials.md
  - ../decisions/0015-use-causal-admission-and-durable-terminal-cleanup.md
  - ../decisions/0016-require-complete-patches-and-host-verifiable-evidence.md
  - ../decisions/0018-adopt-two-phase-decoupled-review-generator.md
  - ../decisions/0024-persist-canonical-review-decision-for-feedback.md
  - ../decisions/0025-bound-structural-analysis-and-promote-verifiable-findings.md
  - ../decisions/0027-actively-supersede-obsolete-review-workflows.md
  - ../decisions/0028-adopt-declarative-repository-policy.md
---

# Fluxo de execução de uma review

Uma run é vinculada ao par head/base SHA observado no webhook. Se o PR mudar antes da
publicação, o resultado antigo não é publicado como se ainda fosse atual.

No primeiro deploy, IN, o producer/consumer de Q e a definição de CO pertencem
ao mesmo `apps/control-plane`. A sequência os mantém como participantes lógicos
distintos porque a Queue introduz uma fronteira assíncrona e Workflows preserva
seu próprio ciclo durável.

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant IN as C01 Ingress
    participant Q as C02 Queue
    participant CO as C03 Coordinator
    participant LE as C04 Ledger
    participant AN as C05 Analyzer
    participant RE as C06 Review Engine
    participant AI as C07 AI Gateway
    participant PU as C08 Publisher

    GH->>IN: pull_request webhook + raw body + signature
    IN->>IN: validate HMAC and event schema
    IN->>Q: enqueue normalized envelope
    IN-->>GH: 2xx
    Q->>CO: at-least-once delivery
    CO->>LE: claim run(repo, PR, head SHA, base SHA)
    alt already claimed or obsolete
        LE-->>CO: duplicate/obsolete
        CO-->>Q: acknowledge without effects
    else new run
        LE->>LE: persist authority + obsolete prior active runs
        LE-->>CO: pending superseded Workflow IDs
        CO->>CO: terminate prior instances with rollback
        CO->>GH: compile configuration at exact base SHA
        CO->>CO: validate YAML AST + strict policy schema
        CO->>GH: fetch canonical PR diff
        CO->>AN: step prepare-repository
        AN-->>CO: small metadata; context stays in Sandbox
        CO->>AN: verify context; reprepare if the Sandbox was replaced
        CO->>RE: steps analyze-shard-N + tool handles
        loop at most six investigation steps
            RE->>AN: read/search/parse allowed content
            AN-->>RE: evidence with provenance
            RE->>AI: prompt redigido + selected evidence
            AI-->>RE: tool request or candidate findings
        end
        RE->>AI: final structured step without tools
        AI-->>RE: JSON Schema response
        opt successful transport without usable object
            RE->>AI: one tool-free recovery
            AI-->>RE: bounded JSON Schema response
        end
        RE-->>CO: validated structured findings
        CO->>GH: fetch current head and base SHAs
        alt head or base changed
            CO->>LE: mark obsolete
        else head unchanged
            CO->>PU: one durable step per publication
            PU->>GH: review comments + summary
            PU->>LE: record external IDs
            CO->>LE: mark completed
        end
    end
```

## Etapas e invariantes

1. **Authenticate:** nenhuma informação do payload é confiável antes do HMAC.
2. **Normalize:** a fila recebe um envelope pequeno, estrito e sem token.
3. **Claim:** somente uma run efetiva pode possuir a mesma chave lógica; a
   promoção persiste obsolescência, cleanup aplicável e supersession antes de
   qualquer cancelamento externo.
4. **Acquire:** o diff canônico é obtido pela API do PR; código é obtido no
   head exato com token de instalação emitido sob demanda.
5. **Investigate:** ferramentas são read-only por padrão e o loop tem orçamento.
6. **Validate:** a saída do modelo é validada contra contrato estrutural e diff.
7. **Reconcile:** o par `{headSha, baseSha}` e a autoridade da run são relidos
   antes de cada mutação externa.
8. **Publish:** inline comments e uma review `COMMENT` têm identidade
   determinística e são registrados.
9. **Complete:** métricas registram cobertura e limitações, inclusive zero findings.

## Checkpoints implementados

Na ordem normal, o Workflow executa `claim-run`, zero ou mais
`terminate-superseded-workflow-N`, `start-run`,
`revalidate-initial-refs`, `resolve-repository-config`, `load-repository-scope`,
`start-check-run`,
`prepare-repository`, identificação por projeto, `plan-review`,
`analyze-shard-N`, `analyze-review`, `begin-publication`,
`revalidate-current-refs`, zero ou mais `publish-inline-N`,
respostas de resolução, `publish-summary`, `save-pr-findings`,
`format-check-run-output`, `record-review-decision`, `complete-check-run`,
`completed-snapshot-accounting`,
`complete-run-and-schedule-cleanup` e o
registro durável de cleanup.

O ciclo de vida no GitHub Check Runs é mantido de forma idempotente:

- Ao iniciar a execução da run (`start-check-run`), cria um Check Run com `status: "in_progress"`, ancorado ao `runId` via `external_id` e armazenado na tabela `runs` do ledger.
- Se o head for substituído (`completeObsolete`), o Check Run é atualizado para `status: "completed"` com `conclusion: "cancelled"`.
- Se a instância for terminada ativamente, o rollback registrado em
  `start-check-run` faz a mesma conclusão `cancelled` para o ID conhecido.
- Ao concluir a publicação (`complete-check-run`), o Check Run é atualizado para `status: "completed"` com `conclusion: "success"` para `APPROVE`, `"failure"` para `REQUEST_CHANGES` e `"neutral"` para `COMMENT`, detalhando achados e limitações de cobertura.
- Em caso de falha terminal (`fail-check-run`), o Check Run é concluído com `conclusion: "failure"`.

Obsolescência e falha registram a mesma obrigação de cleanup durável. Em uma
promoção causal, o ledger também persiste a obrigação de terminar cada Workflow
anterior. A run nova tenta `terminate({ rollback: true })` antes de preparar o
repositório. A confirmação antecipa o cleanup; sem confirmação, após 30 segundos
o alarm prioriza cleanup e retoma cancelamentos pendentes com backoff. Cada
classe de tarefa possui seu próprio `next_attempt_at`. Os nomes são
determinísticos; transições usam operation IDs derivados da instância e do nome
da etapa.

Se o evento já estiver obsoleto, `mark-obsolete-before-preparation` encerra a
run antes de iniciar um container faturável. A revalidação final continua
obrigatória para cobrir force-push ou avanço da base durante a análise. Cada
finding, resposta de resolução, resumo e Check Run terminal revalida os dois
refs imediatamente antes da mutação. Após detectar obsolescência, apenas o
Check Run ancorado ao SHA antigo pode ser concluído como `cancelled`, sem
resultado da análise.

O control-plane obtém do GitHub o diff canônico bruto e o transporta no request
do executor, limitado a 2 MB. Esse conteúdo não vira output persistido do
checkpoint: o executor o divide em patches completos, sem executar
`git diff baseSha headSha`, e aplica a classificação antes de persistir o
contexto completo. JS/TS recebe modo `structural`; outros patches textuais elegíveis
recebem modo `textual`. Binários, lockfiles, gerados, vendorizados, minificados,
artefatos de build e caminhos potencialmente sensíveis reconhecidos pelas
heurísticas são descartados antes do contexto e do modelo.

A mesma classificação autoriza as tools. Leituras rejeitam paths ignorados;
buscas limitam roots e resultados a arquivos elegíveis; ast-grep opera somente
sobre paths `structural`. `read_file` primeiro autoriza o path real e depois
executa no container uma página fixa construída pelo host com `sed`, limitada a
500 linhas e 100 kB, sem materializar o arquivo inteiro no Worker. As
heurísticas reduzem ruído e exposição, mas não são um secret scanner e não
tornam conteúdo elegível confiável.

Na preparação, o executor também extrai lexicalmente símbolos exportados
modificados ou removidos e consulta o checkout exato com `rg`. Essa busca usa os
mesmos globs de exclusão, no máximo 100 arquivos candidatos, 64 kB por arquivo e
1 MB total. `repositoryScanTruncated` torna timeout, falha ou estouro de limite
visível; inventário vazio sob truncamento nunca prova ausência de dependentes.
Essa camada não é AST nem resolve tipos. `ast-grep` continua sendo a ferramenta
estrutural disponível ao modelo durante a investigação.

Antes da preparação, o control plane lê a política exclusivamente no
`baseSha`. O resultado validado é output durável de
`load-repository-scope`, derivado do snapshot selado, e acompanha toda
reconstrução do Sandbox; não
depende de estado em memória entre callbacks. Uma política customizada exige
`prepareRepository` e `loadContext`, sem downgrade. Exclusões adicionais
produzem waivers visíveis, mas não interrompem a análise dos shards elegíveis
restantes; paths protegidos têm precedência sobre essas exclusões.

O contexto filtrado preserva patches completos por arquivo. Para PRs maiores,
o algoritmo de sharding (`buildReviewPlan`) agrupa arquivos elegíveis por localidade
de diretório/módulo em shards bounded (`maxShardDiffBytes: 60 kB`, `maxShardFiles: 20`,
`maxShardLines: 1500`), priorizando arquivos estruturais sobre textuais e nunca cortando
hunks no meio de um arquivo.

Cada shard é analisado isoladamente pelo generator (investigação contextual em duas fases),
e seus resultados são consolidados pelo agregador de aplicação (`aggregateShardReviews`),
que deduplica achados, ordena por severidade, valida contra o Host Evidence Verification Gate
(garantindo que path, linha `RIGHT` e excerpt existam no patch canônico) e sintetiza o
sumário executivo com a classificação de escopo (`complete`, `partial_by_policy`, `partial_by_failure`
ou `unsupported`).

Sinais lexicais são pistas investigativas, não findings automáticos. Mesmo com
linha `RIGHT` e excerpt válidos, a remoção de export ou alteração SQL requer
investigação de impacto causal. A busca parcial não prova ausência de consumidores.
Depois da reconciliação, somente findings canônicos ativos derivam o veredito final
e orientam a síntese; findings dispensados, resolvidos ou obsoletos não bloqueiam.

O [ADR-0033](../decisions/0033-investigate-structural-leads-and-preserve-review-output.md)
define limites compartilhados de retenção, oito findings e quatro evidências por
finding, resumo por shard de 10.000 e publicação de 16.000 unidades UTF-16.
`outputLimitations` registra perdas antes da normalização do SDK. Redação de
segredos preserva esses indicadores; cobertura e ciclo de vida têm espaço
reservado antes da narrativa. Falha de finalização após recuperação resulta em
review incompleta, nunca publicação da investigação livre. Sharding por si só
não marca truncamento. `model.output_limits` informa códigos de perda, e uso da
investigação contabiliza todas as etapas via `totalUsage`.

O contexto filtrado é gravado no filesystem efêmero do Sandbox; apenas
contagens, tamanho e flag de truncamento voltam ao Workflow. A etapa de análise
relê esse arquivo e retorna somente a saída estruturada e limitada do modelo.
Antes da leitura e de cada tool call, o control-plane verifica a existência do
artefato. Se o container tiver sido substituído, repete a preparação exata e
idempotente com o mesmo par de SHAs.

O request leva apenas identidades não secretas e a política validada ao executor. No outbound
handler, o `containerId` fornecido pela plataforma e o scope registrado no
ledger autorizam uma credencial JIT no broker do control plane. O token é
restrito ao repository ID e não entra em parâmetros, filesystem ou storage do
Sandbox. O host usa somente contratos atuais conforme ADR-0036.

## Falhas esperadas

- Assinatura inválida: rejeitar sem enfileirar.
- Evento duplicado: reconhecer sem repetir efeitos.
- Rate limit do GitHub: retry com `Retry-After` ou reset de quota e limite nos
  steps pequenos e idempotentes; 4xx permanente não é repetido.
- Falha de provider/modelo: a Dynamic Route tenta fallbacks de transporte por
  requisição; o Workflow não reinicia a sessão agentiva completa.
- Ferramenta se aproxima do orçamento: retirar tools no passo final e exigir a
  resposta estruturada com a evidência já coletada.
- Head ou base SHA mudou: marcar run obsoleta e aguardar o evento mais novo.
- Falha de cancelamento ativo: manter a run antiga sem autoridade, continuar a
  run nova e repetir a obrigação persistida pelo alarm.
- Linha não pertence mais ao diff: não publicar aquele finding.
- Resposta ausente ou estruturalmente inválida depois de HTTP 200: executar no
  máximo uma síntese sem tools; uma segunda falha encerra a run e publica uma
  notificação idempotente sem detalhes sensíveis.
- Nenhuma mudança elegível depois das exclusões: publicar resumo determinístico
  sem chamar o modelo. Remoções, renames e metadata elegíveis ainda chamam o
  modelo, mas sem linha `RIGHT` só podem influenciar o resumo.
- Contexto acima do budget: analisar somente patches completos selecionados e
  marcar o resumo como parcial.
- Finding estruturalmente válido em linha não alterada: descartar o finding e
  continuar com o resumo validado.
- Falha depois de preparar o repositório: marcar terminal e persistir a tarefa
  de cleanup na mesma transação; alarm repete sem substituir o erro causal.
- Checkout transitório: destruir o Sandbox imediatamente e repetir uma vez;
  checkout permanente: destruir e falhar sem repetição.

## Identificação de versões (2026-09-05)

A [arquitetura de identificação](project-version-identification.md), governada pela [ADR-0030](../decisions/0030-identify-project-versions-from-snapshot-evidence.md), descreve o package reutilizável, coleta de metadados por SHA, cache DO por instalação/repositório, checkpoints e snapshot de auditoria no ledger. Conteúdo integral dos manifests não é persistido; versões são dados, nunca instruções de review.

## Checkpoints e revalidação — 2026-09-08

A [ADR-0034](../decisions/0034-make-review-checkpoints-and-revalidation-durable.md)
define checkpoints por shard, manifesto limitado e artefato privado temporário
no ledger. Publicações leem esse artefato dentro de seus callbacks e reaplicam
feedback humano atual. Tempos e uso são reconstruídos do ledger; decisões por
relógio da identificação ficam dentro de steps, preservando resultados em replay.

A análise executa até cinco shards em paralelo sob um deadline comum de 15 minutos,
fixado no checkpoint de planejamento. O gerador reserva 3 minutos para finalização,
3 para recuperação e 2 para consolidação/persistência; a investigação pode consumir
até 7 minutos. Cada rodada de inferência tem teto de 3 minutos, sempre subordinado
ao prazo restante da fase. O step de modelo no Workflow tem 17 minutos, com margem
para preparação do shard e persistência; não reinicia automaticamente toda a análise.
A síntese usa até 90 segundos do mesmo prazo compartilhado e preserva 30 segundos
para persistência. Esses valores são tetos, não tempos mínimos de espera.

Timeout ou erro transitório do provider permite uma única retomada da investigação,
somente com pelo menos 60 segundos restantes na fase. Mensagens e resultados de
ferramentas das rodadas concluídas são mantidos em memória durante o step; a retomada
não repete essas rodadas nem renova o orçamento de ferramentas. Os seis passos de
investigação continuam sendo um limite conjunto. Isso não é um checkpoint durável
para falhas do runtime. Se a investigação não termina, a finalização recebe apenas o
progresso concluído e o resultado fica obrigatoriamente degradado. A finalização pode
fazer uma única recuperação sem ferramentas, inclusive após timeout, se restam pelo
menos 60 segundos no orçamento reservado. Se não conclui, retorna `finalization_failed`
e nenhuma aprovação. Erros desconhecidos e falhas de ledger/executor não são
convertidos em falhas transitórias do modelo. Uso conhecido de rodadas concluídas
é registrado também quando uma rodada posterior falha; uso da chamada interrompida
pode permanecer desconhecido.
Cada shard tem 12 chamadas de ferramenta com reserva durável antes da chamada. Erro de evidência ou
orçamento esgotado degrada o resultado. Ausência de finding anterior não prova
correção: exige resolução explícita com evidência atual verificada; pendências
sem revalidação impedem aprovação. Respostas de resolução têm marcador e
reconciliação idempotente. O cleanup terminal apaga o artefato agregado após
confirmar destruição do executor.

## Seleção e narrativa — ADR-0035

O planner recebe o diff canônico elegível antes de limitar os shards; o executor
persiste os patches inteiros selecionados no contexto completo (até 300 kB em cinco shards de
60 kB, 50 arquivos, 5.000 coordenadas e 500 kB de JSON). Toda omissão marca cobertura
parcial. Mesmo sem arquivos selecionados, `truncated` impede classificar a execução
como ausência de mudanças elegíveis. A publicação de revisão parcial, degradada ou
com revalidação pendente usa narrativa determinística de incompletude e mantém os
findings verificados; não solicita síntese adicional ao modelo.

A [ADR-0036](../decisions/0036-use-single-current-development-contracts.md) governa nomes e evolução dos contratos: um formato atual por responsabilidade, sem APIs de compatibilidade.

## Configuração por execução — 2026-09-09

`resolve-repository-config` precede preparação, credenciais de Sandbox e
inferência. O leitor obrigatório prova ausência na árvore Git do base SHA,
resolve fontes limitadas e sela o snapshot no ledger. Depois o workflow carrega
uma projeção de escopo; o Check Run inicial usa o idioma materializado. Antes de
qualquer shard de review, projeta guidance para todos os shards e valida seus
limites. Referências não dão autoridade a instruções embutidas no documento.
Identificação mantém IDs e evidências detectadas; compatibilidade configurada é
uma projeção separada. A seleção inline determinística aplica o cap somente na
publicação, com revalidação de refs e claims intactos. Resultados integrais vão
para o histórico autenticado, não para o checkpoint sanitizado. Consulte a
[operação](../operations/repository-configuration.md) e a
[ADR-0037](../decisions/0037-compile-repository-configuration-per-run.md).

## Endurecimento do core (2026-09-27)

A [ADR-0038](../decisions/0038-harden-parallel-review-and-publication.md) define a execução concorrente dos shards no mesmo Sandbox, autoridade transacional de achados, reconciliação durável dos checks e evidências de CI, e os limites do contexto de documentação. Consulte também a [configuração de contexto](../operations/review-context-configuration.md).
