---
id: ADR-0022
kind: decision
status: accepted
date: 2026-09-03
owners:
  - core-team
related:
  - 0001-adopt-incremental-mvp-architecture.md
  - 0008-bound-sandbox-lifetime-and-use-virtual-github-egress.md
  - 0013-use-tiered-structural-and-textual-review.md
  - 0016-require-complete-patches-and-host-verifiable-evidence.md
  - 0018-adopt-two-phase-decoupled-review-generator.md
  - 0019-derive-deterministic-review-verdict-by-policy.md
  - ../architecture/review-runtime-flow.md
  - ../planning/review-core-evolution-roadmap.md
---

# Adotar analisadores estruturais determinísticos em duas camadas

## Contexto e problema

Anteriormente, o Holon dependia exclusivamente da inferência de modelos de linguagem (LLMs) durante o ciclo de ferramentas investigativas no Sandbox (`ast-grep`, `search_text`, `read_file`). Isso introduzia limitações importantes:

1. **Investigação às cegas e custo de tokens**: A LLM precisava descobrir relações de dependência no repositório sem um mapa estrutural prévio. Se uma função exportada tivesse sua assinatura alterada, o modelo precisava adivinhar a necessidade de buscar chamadores externos e gastar grande parte do seu orçamento de ferramentas em buscas iterativas.
2. **Risco de regressões ocultas fora do diff (_blast radius_)**: Se o modelo esgotasse seu orçamento de ferramentas antes de inspecionar os arquivos dependentes, quebras de compatibilidade em consumidores não modificados pelo PR passavam despercebidas.
3. **Impossibilidade de rodar compiladores estritos com resolução de tipos**: Compiladores completos (como `tsc`, `rustc`, `javac`) demandam download de dependências de terceiros (`node_modules`, `vendor`, `.cargo`) e tempos longos de compilação, o que viola frontalmente os requisitos de segurança e isolamento do Sandbox do Holon (saída de rede bloqueada por padrão, zero execução de scripts de terceiros).
4. **Falta de oráculos determinísticos para quebras óbvias**: Operações comprovadamente destrutivas (remoção de export público, migrações SQL com `DROP TABLE` ou `DROP COLUMN`, novos pacotes não autorizados e arquivos sem cobertura de teste) podiam falhar silenciosamente se o modelo decidisse não priorizá-las.

## Decisão

1. **Arquitetura em Duas Camadas (Two-Tiered Hybrid Architecture)**:
   - **Camada 1: Núcleo Universal Agnóstico (Language-Agnostic Core)**:
     - Analisadores rápidos baseados em árvore sintática (AST via Tree-sitter / `ast-grep`) e convenções estruturais que operam sobre múltiplas linguagens (TypeScript, JavaScript, Python, Go, Rust, Java, etc.) sem requerer instalação de dependências ou compilação de pacotes.
     - Extração sintática de símbolos alterados (`ChangedSymbol`), diferenciando `added`, `modified`, `deleted` e visibilidade (`isExported`).
     - Rastreamento de impacto downstream (_blast radius_): identifica em arquivos fora do PR quem importa ou referencia os símbolos alterados.
     - Detecção de quebras de contrato declarativas (`contractBreaks`): exclusão de símbolos públicos exportados e migrações SQL destrutivas (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`).
     - Detecção de lacunas de testes (`testGaps`): lógica de produção modificada sem alterações correspondentes na suíte de testes do PR.
     - Superfície de segurança e dependências (`securitySurfaces`): novos pacotes em manifestos (`package.json`, `Cargo.toml`, `requirements.txt`, `go.mod`), novos acessos a variáveis de ambiente/segredos e novas chamadas de egress de rede.
   - **Camada 2: Especialistas de Ecossistema (Pluggable Extractors)**:
     - Extratores dedicados para ecossistemas específicos (iniciando por TypeScript/Zod/interfaces), permitindo validação aprofundada de esquemas de runtime quando suportado.

2. **Geração no Sandbox e Injeção no `ReviewContextV2`**:
   - Durante o `prepareRepository` / `buildReviewArtifacts`, o executor compila o `StructuralImpactReport` e o anexa ao `ReviewContextV2` persistido no workspace efêmero do Sandbox.
   - Zero chamadas de rede externas e sem overhead de latência significativo (< 50ms para extração).

3. **Uso Duplo: Contexto Orientado para a LLM e Oráculo de Veredito**:
   - **Na Fase 1 (Investigação do Two-Phase Generator)**: O prompt da LLM recebe a seção `Deterministic structural-impact hints:`, indicando explicitamente quais símbolos foram tocados e quais arquivos downstream devem ser auditados. O modelo concentra seu orçamento de ferramentas cirurgicamente nos pontos de risco real.
   - **Na Publicação e Check Run**: O `ReviewSummary` e o `CheckRunOutput` incorporam métricas explícitas de impacto estrutural (símbolos alterados, raio de referências downstream, avisos de migração e gaps de teste).

4. **Busca Estrutural Poliglota no Sandbox**:
   - O schema `searchStructureArgumentsSchema` foi expandido para aceitar nativamente as linguagens suportadas pelo `ast-grep`: `typescript`, `tsx`, `javascript`, `jsx`, `python`, `go`, `rust`, `java`, `csharp`, `ruby`, `php`, `kotlin`.

## Consequências

- **Positivas**:
  - Elimina alucinações sobre a existência ou uso de símbolos no repositório.
  - Reduz drasticamente os tokens consumidos e as iterações de ferramentas da LLM na Fase 1.
  - Fornece proteção garantida contra quebras acidentais em migrações de banco e exclusão de interfaces públicas.
  - Funciona de forma transparente para repositórios poliglota sem comprometer o modelo de segurança estrito do Sandbox.
- **Negativas / Limitações**:
  - Grafos de chamadas sintáticos não resolvem tipos dinâmicos polimórficos complexos (ex: métodos com mesmo nome em classes não relacionadas); o relatório é tratado como heurística factual de alta confiança para orientar a LLM e não como substituto integral de análise semântica.
