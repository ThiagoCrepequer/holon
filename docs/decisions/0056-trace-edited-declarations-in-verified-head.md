---
id: ADR-0056
kind: decision
status: accepted
date: 2026-10-08
owners: [core-team]
related:
  - 0033-investigate-structural-leads-and-preserve-review-output.md
  - 0055-preserve-review-evidence-and-schedule-stable-lanes.md
---

# Rastrear declarações cujo corpo mudou no HEAD verificado

## Contexto

O extrator lexical considerava somente linhas de declaração adicionadas ou
removidas. Uma mudança apenas no corpo de uma função não produzia símbolo
modificado, inclusive quando a assinatura estava fora do hunk. O inventário
usava essa lista antes de ler HEAD, deixando consumidores intactos fora das
pistas estruturais. Duas regressões reproduziram a omissão antes da correção.

## Decisão

Complementar as pistas lexicais com declarações superiores JS/TS da AST do
arquivo em HEAD que contêm linhas alteradas. Usar o parser já presente no
pacote; conservar símbolos adicionados/removidos e sua classificação. Considerar
exports locais explícitos. A identificação do símbolo não gera finding,
severidade, prova causal nem fechamento de dependências.

O inventário valida e lê os módulos alterados antes de procurar nomes downstream.
Cada lote valida modo, tamanho e metadados com `git ls-tree` antes das leituras.
Os dois lotes compartilham os mesmos tetos: 100 candidatos, 64.000 bytes por
arquivo e 1.000.000 bytes totais. Recusas e falhas conservam truncamento.

As demais linguagens mantêm as pistas lexicais existentes. Erro de parse não
prova ausência de consumidores. Aliases entre módulos, imports dinâmicos,
CommonJS e resolução semântica de tipos continuam fora dessa garantia. Ausência
de pista nunca demonstra ausência de defeito. Esta decisão complementa a
ADR-0033; não substitui a política de evidência ou o saldo do Agent.

## Consequências e alternativas rejeitadas

HEAD passa a ser lido antes da busca; um segundo lote de metadados pode aumentar
a preparação. Medir esse custo separadamente da inferência. Evitar leitura
duplicada dentro do inventário e compartilhar o orçamento de bytes entre lotes.
Foram rejeitados: atribuir edits à declaração mais próxima por regex, ler todos
os arquivos sem limite, construir um grafo semântico completo nesta correção e
promover referências lexicais diretamente a findings.

## Confirmação

Regressões observam o consumidor descoberto, assinatura fora do hunk, remoção no
corpo, arrow exportada localmente, classe, declaração vizinha intacta, status de
adição, erro de parse, symlink downstream e orçamento total entre os lotes.
O [benchmark live](../research/2026-10-08-review-core-live-benchmark.md) distingue
a prova do inventário da qualidade do modelo. Descobrir o consumidor não fecha
o gate de recall sem finding final válido.

Fonte primária conferida em 2026-10-08:
[Babel Parser](https://babeljs.io/docs/babel-parser), com a versão 8.0.6 no lockfile.
