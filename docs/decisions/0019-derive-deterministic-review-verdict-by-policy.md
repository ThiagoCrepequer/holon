---
id: ADR-0019
kind: decision
status: accepted
date: 2026-09-02
owners:
  - core-team
related:
  - 0001-adopt-incremental-mvp-architecture.md
  - 0016-require-complete-patches-and-host-verifiable-evidence.md
  - 0018-adopt-two-phase-decoupled-review-generator.md
  - ../architecture/review-runtime-flow.md
  - ../planning/review-core-evolution-roadmap.md
---

# Derivar veredito determinístico de review por política no host

## Contexto e problema

Até então, o Holon submetia todas as revisões de Pull Request no GitHub como `COMMENT`, independentemente da existência de falhas críticas de segurança ou de o código estar limpo e pronto para integração.

Embora o comentário inline exponha o achado, a ausência de um veredito conclusivo no ciclo de vida do Pull Request (`APPROVE` ou `REQUEST_CHANGES`) impõe limitações operacionais:

1. **Inação no fluxo de CI/CD e Branch Protection**: Repositórios com regras de proteção de branch dependem do evento `REQUEST_CHANGES` para bloquear merges com regressões e de `APPROVE` para destravar pull requests válidos.
2. **O risco de delegar a decisão à LLM**: Delegar o veredito final diretamente ao modelo probabilístico cria inconsistências: modelos tendem a ser complacentes demais ou aplicar rigidez arbitrária sem critérios estáveis entre execuções.
3. **O risco do "Limbo do `COMMENT`"**: Políticas que rebaixam qualquer achado não-crítico para `COMMENT` tornam o review predominantemente inconclusivo (ex: 10 problemas médios acumulados recebem `COMMENT`, 1 erro leve recebe `COMMENT`), gerando ruído sem ação.

## Decisão

1. **Desacoplamento entre Extração de Evidências e Veredito**:
   - O modelo LLM é responsável exclusivamente por investigar código e relatar evidências técnicas (findings com localização e trecho literal).
   - O host (código TypeScript puro em `@holon/domain`) decide deterministicamente o veredito final do PR (`APPROVE`, `REQUEST_CHANGES` ou `COMMENT`).
2. **Predominância Binária Acionável (`REQUEST_CHANGES` vs. `APPROVE`)**:
   - O review prioriza uma decisão clara para a equipe.
   - **`REQUEST_CHANGES`** é emitido quando houver defeitos funcionais comprovados:
     - $\ge 1$ finding de severidade `critical`;
     - $\ge 1$ finding de severidade `high`;
     - $\ge 2$ findings de severidade `medium` (acúmulo de defeitos moderados);
     - $\ge 1$ finding de severidade `medium` com alta confiança ($\ge 0.85$);
     - Pontuação de risco ponderada $\ge 2.0$ (`critical`: 4.0, `high`: 3.0, `medium`: 1.5, `low`: 0.25).
     - _Pré-requisito inviolável_: cada finding deve ter localização no lado `RIGHT` de uma linha alterada e excerto literal confirmado no patch pelo Host Evidence Verification Gate.
   - **`APPROVE`** é emitido quando o PR estiver seguro:
     - Escopo de análise completo (`scopeStatus === "complete"`);
     - 100% dos lotes/shards analisados com sucesso (`shardsAnalyzed === totalShards`);
     - Zero findings bloqueadores (`critical`, `high` ou acúmulo de `medium`);
     - Observações puramente informativas/cosméticas (`low`) **não impedem** a aprovação (são publicadas como sugestões/advisories enquanto o PR é aprovado);
     - Política `allowApprove` habilitada (default `true`).
3. **Confinamento Estrito do `COMMENT` (Incerteza e Exceções)**:
   - `COMMENT` é reservado exclusivamente para cenários de incerteza defensiva:
     - Escopo parcial (`partial_by_policy` ou `partial_by_failure`): o agente não analisou o PR integralmente, portanto não tem autoridade para aprovar ou reprovar;
     - PR sem código executável suportado (`unsupported`);
     - Achados duvidosos com confiança abaixo do limiar confiável (< 0.75);
     - Política organizacional desabilitando aprovações automáticas (`allowApprove === false`).

## Consequências

### Positivas

- **Clareza operacional**: O PR recebe um status inequívoco (`Changes requested` ou `Approved`).
- **Zero alucinação de veredito**: A decisão segue regras aritméticas e lógicas estritas no host, imunes a variações de tom da LLM.
- **Tolerância a melhorias cosméticas**: Sugestões leves não impedem o autor de fazer merge.
- **Fail-safe seguro**: Qualquer falha de shard ou corte de contexto rebaixa a decisão para `COMMENT`, impedindo aprovações falsas ou bloqueios indevidos por dados incompletos.

### Negativas

- Requer que o GitHub App tenha permissões adequadas de submissão de Pull Request Reviews com eventos `APPROVE` e `REQUEST_CHANGES` (já previstas na permissão de `pull_requests: write`).
