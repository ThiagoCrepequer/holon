---
id: ARCH-RUNTIME-001
kind: architecture
status: current
owners:
  - core-team
last-reviewed: 2026-09-03
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
---

# Fluxo de execução de uma review

Uma run é vinculada ao head SHA observado no webhook. Se o PR mudar antes da
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
    CO->>LE: claim run(repo, PR, head SHA)
    alt already claimed or obsolete
        LE-->>CO: duplicate/obsolete
        CO-->>Q: acknowledge without effects
    else new run
        LE->>LE: persist authority + obsolete prior active runs
        LE-->>CO: pending superseded Workflow IDs
        CO->>CO: terminate prior instances with rollback
        CO->>GH: fetch canonical PR diff
        CO->>AN: step prepare-repository
        AN-->>CO: small metadata; context stays in Sandbox
        CO->>AN: verify context; reprepare if the Sandbox was replaced
        CO->>RE: step analyze-review + tool handles
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
        CO->>GH: fetch current head SHA
        alt head changed
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
2. **Normalize:** a fila recebe um envelope pequeno, versionado e sem token.
3. **Claim:** somente uma run efetiva pode possuir a mesma chave lógica; a
   promoção persiste obsolescência, cleanup aplicável e supersession antes de
   qualquer cancelamento externo.
4. **Acquire:** o diff canônico é obtido pela API do PR; código é obtido no
   head exato com token de instalação emitido sob demanda.
5. **Investigate:** ferramentas são read-only por padrão e o loop tem orçamento.
6. **Validate:** a saída do modelo é validada contra contrato estrutural e diff.
7. **Reconcile:** o head SHA e a autoridade da run são relidos antes de cada
   mutação externa.
8. **Publish:** inline comments e uma review `COMMENT` têm identidade
   determinística e são registrados.
9. **Complete:** métricas registram cobertura e limitações, inclusive zero findings.

## Checkpoints implementados

Na ordem normal, o Workflow executa `claim-run`, zero ou mais
`terminate-superseded-workflow-N`, `start-run`,
`revalidate-initial-head`, `start-check-run`, `prepare-repository`, `analyze-review`,
`begin-publication`, `revalidate-current-head`, zero ou mais `publish-inline-N`,
`publish-summary`, `save-pr-findings`, `record-review-decision`, `complete-check-run`,
`complete-run-and-schedule-cleanup` e o
registro durável de cleanup.

O ciclo de vida no GitHub Check Runs é mantido de forma idempotente:

- Ao iniciar a execução da run (`start-check-run`), cria um Check Run com `status: "in_progress"`, ancorado ao `runId` via `external_id` e armazenado na tabela `runs` do ledger.
- Se o head for substituído (`completeObsolete`), o Check Run é atualizado para `status: "completed"` com `conclusion: "cancelled"`.
- Se a instância for terminada ativamente, o rollback registrado em
  `start-check-run` faz a mesma conclusão `cancelled` para o ID conhecido.
- Ao concluir a publicação (`complete-check-run`), o Check Run é atualizado para `status: "completed"` com `conclusion: "success"` (0 findings) ou `conclusion: "neutral"` (achados identificados ou escopo parcial), detalhando contagem de achados, arquivos e duração.
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
obrigatória para cobrir force-push durante a análise.

O control-plane obtém do GitHub o diff canônico bruto e o transporta no request
do executor, limitado a 2 MB. Esse conteúdo não vira output persistido do
checkpoint: o executor o divide em patches completos, sem executar
`git diff baseSha headSha`, e aplica a classificação antes de persistir o
contexto V2. JS/TS recebe modo `structural`; outros patches textuais elegíveis
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

Quebras determinísticas com linha `RIGHT` e excerpt verificáveis entram como
candidatas no mesmo agregador e podem influenciar o veredito. Sinais sem âncora,
incluindo remoções puras, ficam apenas no contexto e no resumo. Depois da
reconciliação, somente findings canônicos ativos derivam o veredito final;
findings dispensados, resolvidos ou obsoletos não permanecem bloqueando a run.

O contexto filtrado é gravado no filesystem efêmero do Sandbox; apenas
contagens, tamanho e flag de truncamento voltam ao Workflow. A etapa de análise
relê esse arquivo e retorna somente a saída estruturada e limitada do modelo.
Antes da leitura e de cada tool call, o control-plane verifica a existência do
artefato. Se o container tiver sido substituído, repete a preparação exata e
idempotente com o mesmo par de SHAs.

O request V2 leva apenas identidades não secretas ao executor. No outbound
handler, o `containerId` fornecido pela plataforma e o scope registrado no
ledger autorizam uma credencial JIT no broker do control plane. O token é
restrito ao repository ID e não entra em parâmetros, filesystem ou storage do
Sandbox. Os métodos V1 permanecem somente para rollout N-1 conforme ADR-0014.

## Falhas esperadas

- Assinatura inválida: rejeitar sem enfileirar.
- Evento duplicado: reconhecer sem repetir efeitos.
- Rate limit do GitHub: retry com `Retry-After` ou reset de quota e limite nos
  steps pequenos e idempotentes; 4xx permanente não é repetido.
- Falha de provider/modelo: a Dynamic Route tenta fallbacks de transporte por
  requisição; o Workflow não reinicia a sessão agentiva completa.
- Ferramenta se aproxima do orçamento: retirar tools no passo final e exigir a
  resposta estruturada com a evidência já coletada.
- Head SHA mudou: marcar run obsoleta e aguardar o evento mais novo.
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
