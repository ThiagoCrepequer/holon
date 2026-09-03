---
id: ADR-0025
kind: decision
status: accepted
date: 2026-09-03
owners:
  - core-team
supersedes:
  - 0022-adopt-deterministic-structural-analyzers.md
related:
  - 0013-use-tiered-structural-and-textual-review.md
  - 0016-require-complete-patches-and-host-verifiable-evidence.md
  - 0018-adopt-two-phase-decoupled-review-generator.md
  - 0019-derive-deterministic-review-verdict-by-policy.md
  - ../architecture/review-runtime-flow.md
---

# Limitar a análise estrutural e promover somente findings verificáveis

## Contexto e problema

O ADR-0022 descreveu a extração de símbolos do host como AST/Tree-sitter e o
rastreamento downstream como conectado ao checkout. A implementação entregue
usava análise lexical de patches e recebia uma lista vazia de arquivos do
repositório. O relatório podia aparecer no contexto, mas seus sinais não
participavam da política de findings nem do veredito. A documentação, portanto,
afirmava garantias que o código não possuía.

## Decisão

1. O núcleo automático do host é deliberadamente lexical e determinístico. Ele
   extrai símbolos e sinais de patches completos sem alegar resolução semântica
   ou AST. `ast-grep` permanece disponível como ferramenta estrutural da fase
   investigativa do modelo.
2. Após o checkout exato, o executor busca referências dos símbolos exportados
   modificados ou removidos com `rg`, usando a mesma política de globs e paths
   elegíveis das demais ferramentas. A busca é limitada a 100 candidatos, 64 kB
   por arquivo e 1 MB total, sem egress e sem executar código do repositório.
3. Timeout, erro, arquivo excedente ou limite atingido marcam
   `repositoryScanTruncated`; não são interpretados como ausência de uso.
4. Sinais determinísticos só viram findings quando o host consegue ancorá-los em
   uma linha adicionada `RIGHT` e em um excerpt do patch canônico. Esses findings
   passam pelo mesmo gate, deduplicação, limite e política de veredito dos
   findings do modelo.
5. Sinais sem âncora publicável, como remoção pura de export, permanecem contexto
   e resumo. Não são convertidos artificialmente em comentário inline.

## Consequências

### Positivas

- O blast radius usa arquivos reais do checkout e expõe truncamento.
- Quebras determinísticas ancoráveis podem afetar o resultado sem depender da
  atenção do modelo.
- O contrato documenta a capacidade real e elimina a alegação incorreta de AST.
- A busca respeita exclusões, limites de leitura e deny-by-default egress.

### Negativas e limites

- Matching lexical pode gerar referências homônimas e não resolve tipos.
- Remoções sem linha `RIGHT` não bloqueiam sozinhas; o modelo deve investigar e o
  resumo deve registrar o risco.
- Repositórios grandes podem produzir inventário parcial, explicitamente marcado.

## Alternativas rejeitadas

- Manter `repositoryFiles: []`: preserva um relatório decorativo sem blast radius.
- Promover todo sinal como finding: violaria o gate de evidência e inventaria
  coordenadas para remoções.
- Rodar compiladores ou instalar dependências: viola custo e isolamento do
  executor.
- Chamar a extração lexical de AST: mascara a limitação e impede calibração
  honesta.

## Confirmação

- Teste do executor prova busca limitada no checkout e falha marcada como parcial.
- Teste do analyzer prova promoção de quebra SQL ancorada no patch.
- Teste do agregador prova que finding determinístico passa pelo gate e pela
  política canônica.
- O contrato e o resumo expõem `repositoryScanTruncated`.
