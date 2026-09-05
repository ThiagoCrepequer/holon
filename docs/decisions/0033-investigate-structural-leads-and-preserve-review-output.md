---
id: ADR-0033
kind: decision
status: accepted
date: 2026-09-05
owners:
  - core-team
supersedes:
  - 0025-bound-structural-analysis-and-promote-verifiable-findings.md
related:
  - 0018-adopt-two-phase-decoupled-review-generator.md
  - 0019-derive-deterministic-review-verdict-by-policy.md
---

# Investigar sinais estruturais e preservar a saída da review

## Contexto

Uma remoção de export recebia um finding crítico automaticamente, mesmo quando
os consumidores haviam migrado. Uma âncora válida prova a localização do código,
mas não prova uma regressão. Além disso, cortes silenciosos de texto e a publicação
da investigação livre após falha de finalização tornavam a conclusão incompleta.

## Decisão

- Preservar a análise lexical, o checkout exato, a busca downstream limitada e
  `repositoryScanTruncated` do ADR-0025. Substituir a promoção automática: sinais
  estruturais são pistas para investigar consumidores, migrações e contratos
  suportados. Não geram findings nem severidade automaticamente. O host continua
  verificando evidência e derivando o veredito dos findings canônicos ativos.
- Compartilhar os limites entre normalização, contratos, ledger e publicação:
  diagnóstico 2.000, excerpt 1.200, justificativa 600, sugestão 3.000, resumo por
  shard 10.000 e resumo publicado 16.000 unidades UTF-16; até oito findings por
  shard e quatro evidências por finding. A capacidade final de comentários continua
  sujeita à política de publicação do host.
- Detectar perdas antes de normalizar o transporte do SDK. Propagar códigos
  `outputLimitations`, preservando-os na redação de segredos. Não completar
  diagnósticos curtos com alegações de verificação inventadas. Excerpts cortados
  permanecem prefixos exatos, sem acrescentar caracteres à evidência.
- Reservar espaço para cobertura e ciclo de vida antes da narrativa. Cortes na
  publicação têm marcador explícito e preservam pares Unicode. O teto de 16.000
  unidades limita o resumo a no máximo 48.000 bytes UTF-8 antes dos marcadores
  de publicação, com margem conservadora para os endpoints do GitHub.
- Manter investigação em 4.000 tokens por chamada e finalização em 8.192; ampliar
  síntese de 2.000 para 4.000 tokens. Limites de geração e retenção são distintos:
  aumentar retenção não recupera tokens que o modelo nunca gerou.
- Falha semântica após a única recuperação produz aviso de review incompleta,
  sem findings ou publicação da investigação livre. Registrar `generation_length`,
  `investigation_incomplete` e `finalization_failed` quando aplicáveis.
- Sharding não significa contexto omitido. Somente omissão real por orçamento
  marca cobertura parcial. Síntese recebe os findings ativos após reconciliação;
  se indisponível, usar aviso neutro em vez de concatenar conclusões contraditórias.
- Registrar uso acumulado da investigação (`totalUsage`), síntese e metadados
  numéricos disponíveis nas falhas. Nunca registrar prompts, conteúdo ou mensagens
  arbitrárias de exceção. Emitir `model.output_limits` com códigos e contagens.

## Consequências e alternativas rejeitadas

A análise exige evidência causal, reduzindo falsos positivos por refatorações
intencionais. Reter texto custa armazenamento e aumenta payloads; aumentar a
síntese pode aumentar inferência. Os limites continuam necessários para GitHub,
Workflows e previsibilidade operacional. Foram rejeitados: limites ilimitados,
aumento indiscriminado de tokens e manutenção da promoção automática baseada
apenas em âncora. Riscos reais podem deixar de ser investigados pelo modelo; a
verificação do host não comprova completude semântica.

## Confirmação

Testes cobrem retenção além dos limites anteriores, sinalização de cortes,
Unicode, schema com SDK real sem chamada externa, falha de finalização, uso
acumulado, ausência de promoção automática e preservação da síntese agregada.
Os limites de cobertura existentes permanecem obrigatórios. A aceitação dos
novos payloads não foi validada com publicação real no GitHub.

Fontes verificadas em 2026-09-05:
[generateText e totalUsage](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text),
[API de reviews](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request),
[erro de limite em action oficial](https://github.com/actions/dependency-review-action/issues/730),
[discrepância bytes/caracteres em checks](https://github.com/github/docs/issues/35252).
Os relatos de outros endpoints justificam margem conservadora; não estabelecem
um limite universal idêntico para todas as APIs.
