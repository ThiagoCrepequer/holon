---
id: ARCH-RUNTIME-001
kind: architecture
status: current
owners:
  - core-team
last-reviewed: 2026-08-30
related:
  - ../decisions/0001-adopt-incremental-mvp-architecture.md
  - ../decisions/0003-adopt-initial-typescript-application-stack.md
  - ../decisions/0006-use-granular-workflow-checkpoints.md
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
3. **Claim:** somente uma run efetiva pode possuir a mesma chave lógica.
4. **Acquire:** código é obtido com token de instalação emitido sob demanda.
5. **Investigate:** ferramentas são read-only por padrão e o loop tem orçamento.
6. **Validate:** a saída do modelo é validada contra contrato estrutural e diff.
7. **Reconcile:** o head SHA é relido imediatamente antes da publicação.
8. **Publish:** inline comments e uma review `COMMENT` têm identidade
   determinística e são registrados.
9. **Complete:** métricas registram cobertura e limitações, inclusive zero findings.

## Checkpoints implementados

Na ordem normal, o Workflow executa `claim-run`, `start-run`,
`prepare-repository`, `analyze-review`, `begin-publication`,
`revalidate-current-head`, zero ou mais `publish-inline-N`, `publish-summary`,
`complete-run` e `cleanup-completed-repository`. Obsolescência e falha possuem
cleanup próprio. Os nomes são determinísticos; transições usam operation IDs
derivados da instância e do nome da etapa.

O contexto bruto não atravessa o checkpoint de preparação. Ele é validado e
gravado no filesystem efêmero do Sandbox; apenas contagens, tamanho e flag de
truncamento voltam ao Workflow. A etapa de análise relê esse arquivo e retorna
somente a saída estruturada e limitada do modelo. Antes da leitura, o
control-plane verifica a existência do artefato antes da leitura e de cada tool
call. Se o container tiver sido substituído, repete a preparação exata e
idempotente com o mesmo par de SHAs.

## Falhas esperadas

- Assinatura inválida: rejeitar sem enfileirar.
- Evento duplicado: reconhecer sem repetir efeitos.
- Rate limit GitHub/modelo: retry com backoff e limite.
- Ferramenta se aproxima do orçamento: retirar tools no passo final e exigir a
  resposta estruturada com a evidência já coletada.
- Head SHA mudou: marcar run obsoleta e aguardar o evento mais novo.
- Linha não pertence mais ao diff: não publicar aquele finding.
- Resposta ausente ou estruturalmente inválida: falhar sem retry e sem
  comentários especulativos; repetir a mesma inferência determinística só
  multiplica tokens e tempo.
- Finding estruturalmente válido em linha não alterada: descartar o finding e
  continuar com o resumo validado.
- Falha depois de preparar o repositório: marcar terminal e executar cleanup em
  etapas independentes, preservando o erro causal se cleanup também falhar.
- Checkout transitório: destruir o Sandbox imediatamente e repetir uma vez;
  checkout permanente: destruir e falhar sem repetição.
