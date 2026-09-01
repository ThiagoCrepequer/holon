---
id: ADR-0018
kind: decision
status: accepted
date: 2026-09-01
owners:
  - core-team
supersedes:
  - 0017-select-review-output-harness-from-evidence.md
related:
  - 0001-adopt-incremental-mvp-architecture.md
  - 0005-use-ai-gateway-rest-api-with-ai-sdk.md
  - 0011-centralize-model-fallback-in-dynamic-route.md
  - 0016-require-complete-patches-and-host-verifiable-evidence.md
  - ../architecture/review-runtime-flow.md
  - ../operations/evaluations.md
  - ../planning/review-core-evolution-roadmap.md
---

# Adotar gerador de review desacoplado em duas fases com gate de verificação no host

## Contexto e problema

A avaliação comparativa de harnesses proposta no [ADR-0017](0017-select-review-output-harness-from-evidence.md) foi executada contra o corpus `baseline-v3` em 3 trials independentes para investigar a causa raiz de falhas recorrentes de parsing e conclusão. Os dados observados demonstraram:

1. **`live-think-workflow-v1` (Cloudflare Think / Agents SDK)**: apresentou custo desproporcional (130.951 input tokens e 694s de latência agregada), gerou erro terminal `model_output_invalid` e não apresentou ganho de precisão (50%) ou recall (21.43%) que justificasse a complexidade de Worker, Durable Object e Workflow aninhados.
2. **`live-terminal-tool-v1` (AI SDK ToolLoopAgent com `submit_review`)**: alcançou o maior recall bruto (37.50%), mas falhou em 3 casos com `model_output_missing` devido ao esgotamento de passos/tokens quando forçado a emitir payloads complexos de múltiplos findings dentro do loop de ferramentas.
3. **`live-structured-output-portable-v1`**: obteve zero erros de subject e zero quebras de schema Zod, comprovando a eficácia do schema compatível com Strict JSON Schema (`nullable` em vez de `optional` puro), mas teve recall deprimido (6.67%) por exigir raciocínio analítico e serialização estrita em um único turno monolítico sem ferramentas.
4. **`live-structured-output-v1`**: confirmou a fragilidade de schemas Zod com refinamentos e campos opcionais diretos contra provedores estritos.

A conclusão é que **acoplar a investigação com ferramentas à serialização JSON final em uma única chamada gera falhas de parsing ou omissão silenciosa**.

## Decisão

1. **Adotar a arquitetura desacoplada em duas fases (_Two-Phase Decoupled Review Generator_)**:
   - **Fase 1 (Investigação Contextual Dirigida)**: O modelo investiga o diff com orçamento delimitado de ferramentas (`read_file`, `search_structure`, `search_text`), registrando hipóteses e evidências em formato analítico livre (texto). Não há exigência de conformidade com JSON Schema nesta etapa, eliminando falhas de serialização no meio da investigação.
   - **Fase 2 (Finalização Estruturada Dedicada)**: Uma inferência isolada de passo único (`temperature: 0`, sem ferramentas) recebe o contexto e o relatório da Fase 1 e emite exclusivamente o objeto estruturado usando o contrato portável (`modelReviewTransportSchema`).
2. **Adotar o Gate Determinístico de Validação de Evidências no Host (_Host Verification Layer_)**:
   - O host verifica deterministamente se a linha do finding pertence ao lado `RIGHT` das linhas modificadas e se o trecho citado em `evidence.excerpt` existe literalmente no patch/arquivo. Findings que violam essas regras de ancoragem são descartados pelo host antes da publicação.
3. **Encerrar e Descomissionar o Spike de Avaliação Cloudflare Think**:
   - O Worker `apps/harness-evaluation`, o workflow de comparação e as dependências `@cloudflare/think` e `agents` são formalmente removidos do repositório. O runtime do Holon permanece estritamente baseado em Cloudflare Workflows, Durable Objects (para o ledger) e Cloudflare Sandbox, sem Agents SDK.

## Consequências

### Positivas

- **Zero erros de parse e zero `model_output_missing`**: A fase de finalização dedica 100% da sua janela de output e atenção à conformidade com o schema JSON.
- **Maior recall e precisão**: O modelo tem liberdade para investigar antes de formatar a saída, e alucinações de linha ou excerto são eliminadas pelo validador do host.
- **Simplicidade operacional e menor latência**: Elimina a sobrecarga de Durable Objects extras e Workflows aninhados do Think, reduzindo latência média de ~700s para ~30-45s.
- **Portabilidade multi-provedor**: O contrato portável com normalização no host funciona confiavelmente em OpenAI, Anthropic, Gemini e modelos open-source via OpenRouter/AI Gateway.

### Negativas

- A fase de finalização adiciona uma segunda chamada de LLM ao fluxo quando há investigação prévia (embora sem o overhead de Durable Objects ou loops de retentativa com falha).

## Evidência

Evidência empírica obtida em 2026-09-01 via `pnpm evaluate:compare` (3 trials em `baseline-v3`):

- `live-structured-output-v1`: 6/15 aprovados, precisão 60.00%, recall 20.00%, 0 subject errors, 18.938 input tokens, 151.320 ms.
- `live-structured-output-portable-v1`: 7/15 aprovados, precisão 25.00%, recall 6.67%, 0 subject errors, 18.228 input tokens, 211.162 ms.
- `live-terminal-tool-v1`: 8/15 aprovados, precisão 60.00%, recall 37.50%, 3 subject errors (`model_output_missing`), 48.726 input tokens, 171.080 ms.
- `live-think-workflow-v1`: 8/15 aprovados, precisão 50.00%, recall 21.43%, 1 subject error (`model_output_invalid`), 130.951 input tokens, 694.442 ms.
