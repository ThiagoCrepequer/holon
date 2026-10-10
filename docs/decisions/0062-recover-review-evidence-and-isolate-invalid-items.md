---
id: ADR-0062
kind: decision
status: accepted
date: 2026-10-10
owners: [core-team]
related:
  - 0056-preserve-review-evidence-and-schedule-stable-lanes.md
  - 0060-separate-review-inventory-and-pack-contract-windows.md
  - 0061-pack-review-shards-with-structural-context-budget.md
---

# Recuperar evidência e isolar itens inválidos da revisão

## Contexto

A [auditoria do PR #186](../research/2026-10-10-pr186-review-failures.md)
encontrou leitura de evidência falhando depois da conclusão do modelo. O pai
tratava essa falha como perda geral de infraestrutura e cancelava as lanes.
Uma observação auxiliar curta também podia invalidar a resposta inteira.
As sete runs tinham varredura parcial e checks de contrato omitidos; isso não
é prova de incapacidade do modelo nem de cobertura completa das runs concluídas.

## Decisão

Esta decisão substitui os tetos de **100 candidatos de inventário** e **oito
checks adicionais** das ADRs 0060/0061 e a localização da coleta pós-modelo da
ADR-0056. Preserva as demais decisões, incluindo seus tetos financeiros.

1. Cada `ReviewShardWorkflow` coleta a evidência em `step.do("collect-evidence")`
   depois da resposta durável. São uma tentativa e dois retries, com backoff
   exponencial iniciado em 1 s. Cada tentativa usa deadline de até 60 s, nunca
   além do prazo original da análise; o step limita a tentativa a 90 s.
   Recuperar evidência não repete inferência. Autoridade é revalidada antes e
   depois da leitura e antes do retorno do Workflow.
2. O único resultado interno atual do filho é `{ output, evidence }`. O host
   valida schema, identidade e hashes dos receipts. O pacote continua limitado
   a oito entradas e 20.000 bytes; não é o contexto completo do repositório.
   O step usa saída sensível e a saída final contém conteúdo privado, como a
   resposta do modelo. Não imprimir step output, pacote ou prompts na operação.
   Produtor, consumidor e harness mudam juntos, sem fallback de contrato antigo.
3. Esgotamento da coleta registra `evidence_collection_failed`. Como falha
   limitada de um filho, conserva resultados dos outros shards e permite
   trabalho posterior nas lanes; a revisão permanece parcial. Isso não torna
   toleráveis falhas gerais de preparação, ledger, identidade ou orçamento.
   Quando todos os shards falham, a análise continua falhando.
4. Após o schema portátil do prompt, validar candidatos, resoluções e
   observações individualmente no transporte. Rejeições usam
   `candidate_rejected`, `evidence_rejected` e `investigation_rejected`, sem
   inventar coordenadas, completar evidência, elevar confiança ou produzir
   resoluções fictícias. O resumo deixa de afirmar itens rejeitados e a revisão
   fica degradada. Envelope inválido, overflow e violação do schema do Think
   continuam sendo falhas; candidatos retidos ainda passam pelo gate causal.
5. O inventário admite até 256 candidatos entre módulos alterados e consumidores,
   mantendo 64.000 bytes por arquivo, 1.000.000 bytes total e validação dos blobs
   regulares no HEAD. Checks de contrato podem usar os slots restantes até 64
   partes totais. Mantêm janelas canônicas, teto estrutural de 24.000 bytes,
   concorrência três e admissão/orçamento duráveis. Ausência de janela e
   esgotamento de recursos continuam explícitos; mais capacidade não demonstra
   fechamento semântico nem financiamento suficiente para qualquer PR.
6. Pistas de símbolos removidos usam os namespaces da AST completa do HEAD,
   compartilhados com o detector de quebra de contrato. Um nome explicitamente
   reexportado no namespace adequado é modificado; export somente de tipo não
   preserva um valor. Erro de parse, módulo ausente e estrela não resolvida não
   provam preservação. O verificador causal deve conferir a cadeia de exports.
7. Notificações tardias do Think são reconhecidas sem envio a filhos
   comprovadamente `complete`, `errored` ou `terminated`, pelo método público
   `sendWorkflowEvent`. Status indisponível não autoriza descarte. Não alterar
   callbacks privados nem o backoff interno do SDK.
8. Liberar capacidades RPC copiadas ou recebidas após cancelamento, incluindo
   handles de processo. Classificar streams encerrados em `other`/`error` sem
   tools como `model_tool_protocol_invalid`; não escolher outro provedor nem
   consumir novas inferências automaticamente. Diagnósticos de deadline,
   inventário e projeção usam códigos e números, sem payloads ou exceções livres.

## Consequências e confirmação

Mais candidatos/checks podem aumentar leitura, latência e consumo dentro dos
mesmos tetos. O resultado do filho persiste um pacote privado limitado; promover
os Workers exige drenar Workflows/cleanup segundo o runbook, pois não há
compatibilidade com resultados internos antigos.

Regressões locais cobrem retry sem nova geração, esgotamento, continuidade das
lanes, perda de autoridade, observação curta, rejeição por candidato, namespaces
de reexport, capacidade e descarte RPC tardio. Isso não qualifica a precisão do
Gemma/NextBit, não demonstra recuperação em produção e não estabelece a causa
exata dos requests sem resposta encontrados no relatório.

Fontes oficiais conferidas em **2026-10-10**:
[Think Workflows](https://developers.cloudflare.com/agents/harnesses/think/workflows/)
e [ciclo de vida RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/).
