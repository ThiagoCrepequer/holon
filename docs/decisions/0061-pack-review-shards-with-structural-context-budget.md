---
id: ADR-0061
kind: decision
status: accepted
date: 2026-10-09
owners: [core-team]
related:
  - 0060-separate-review-inventory-and-pack-contract-windows.md
---

# Agrupar partes considerando o orçamento estrutural

## Contexto

O replay limitado do PR #185 mostrou perda local de sinais em duas partes,
mesmo após os ajustes da ADR-0060. O planner agrupava arquivos e janelas pelos
tetos do patch, mas não media o contexto estrutural resultante. Cada arquivo
isolado cabia; o agrupamento concentrava sinais acima dos 24.000 bytes.

## Decisão

Complementar a ADR-0060 sem alterar seus tetos financeiros, de leitura ou de
execução, nem reclassificar uma varredura parcial como completa.

1. `domain` possui a política pura de seleção por paths, envelope, medição UTF-8
   e projeção estrutural. Planner, composição do shard e modelo compartilham essa
   política, sem dependência entre adapters ou código de Workers no domínio.
2. Medir o envelope completo, com flags e contadores globais, antes de agrupar
   arquivos. Reservar os mesmos 64 bytes para o contador de omissões usados pela
   projeção. Um envelope que cabe não perde sinais ao chegar ao prompt.
3. Manter grupos relacionados quando couberem. Separar arquivos quando a união
   exceder o teto estrutural, além dos limites existentes de patch e evidência.
   Compartilhar janelas de contrato somente quando sua união também couber.
4. Não repetir o diff em partes artificiais só para repartir pistas do mesmo
   arquivo. Quando um arquivo ou par canônico obrigatório exceder sozinho o teto,
   declarar `structural_context` no plano: quantidade de partes e teto em bytes.
   A projeção conserva a perda local e a agregação mantém revisão incompleta.
5. Preservar 64 partes totais, oito checks adicionais e o orçamento durável da
   run. Nova divisão pode consumir capacidade; partes excluídas pelo limite
   continuam explícitas. Omitir contexto não é uma otimização de tool calls.

## Confirmação e limites

Regressões compõem planner, seleção, prompt e agregação reais: dois arquivos
densos preservam 80 referências; janelas densas ficam separadas; um arquivo
acima do teto permanece parcial; o limite de partes e a ordem determinística
continuam válidos. A política pura cobre o limite de bytes e texto multibyte.

No mesmo recorte offline do PR #185, as partes caíram de 13 para 11 e as
ocorrências de sinais omitidos nas projeções de 56 para zero. O inventário do
replay lê somente módulos alterados e continua globalmente parcial. Isso não
mede precisão do modelo, latência remota, custo de inferência ou revisão completa
em produção. As evidências pagas anteriores permanecem snapshots históricos.
