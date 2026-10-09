---
id: ADR-0060
kind: decision
status: accepted
date: 2026-10-09
owners: [core-team]
related:
  - 0055-fund-large-reviews-with-protected-investigation.md
  - 0057-trace-edited-declarations-in-verified-head.md
  - 0059-compose-stable-review-lanes-with-budget-profiles.md
---

# Separar inventário de projeção e compartilhar janelas de contrato

## Contexto

O PR #184 concluiu dez partes, mas terminou parcial. O relatório global cortou
sinais antes da distribuição e fez todas as projeções locais parecerem truncadas.
O planejador exigia a declaração no hunk, apesar dos edits de corpo reconhecidos
pela ADR-0057. Imports intactos e janelas repetidas consumiam checks adicionais.

## Decisão

Esta decisão substitui a regra 7 da ADR-0055 quanto à seleção e organização das
janelas. Preserva os perfis financeiros, até oito partes adicionais, total 64,
concorrência três, evidência canônica e verificação causal. Complementa a
ADR-0057; os documentos aceitos anteriores permanecem intactos.

1. Contrato e produtor compartilham `structuralReportLimits`: 1.000 símbolos,
   1.000 referências, 500 pistas de contrato e 500 superfícies de segurança.
   O tracer do relatório usa esse teto por padrão. Restrições menores continuam
   contando referências omitidas. A leitura preserva 100 candidatos, 64.000 bytes
   por arquivo e 1.000.000 bytes entre lotes; nenhum egress/comando novo.
2. `structural_inventory` mantém o plano parcial quando há omissões globais ou
   scan parcial. A projeção preserva esses fatos, mas `omitted`/`truncated`
   contam somente perdas locais. Contexto estrutural tem 24.000 bytes UTF-8.
   Preflight e ledger continuam cobrando o prompt completo sob os mesmos tetos
   agregados. Mais contexto pode aumentar entrada e promover o perfil existente.
3. Declaração fora do hunk conserva `line` e recebe `patchLine` quando a AST e o
   patch comprovam uma coordenada do edit. Não inventar coordenadas nem achados.
4. Patches completos colocalizados dispensam checks redundantes. Nos demais,
   preferir referências canônicas ao import intacto e usar `patchLine` do
   produtor. Um patch completo do consumidor pode ser sua janela se couber;
   isso não inclui fonte fora do diff nem torna o import uma âncora publicável.
5. Compartilhar janelas idênticas e agrupar pares dentro dos tetos de bytes,
   linhas alteradas, arquivos e evidências. Cada arquivo mantém uma janela de
   até 80 linhas de conteúdo. Janelas diferentes do mesmo arquivo ficam em partes
   distintas; não concatenar hunks sobrepostos. O teto de oito partes permanece.
6. Omissões discriminam `capacity`, `missingWindow` e `evidenceWindows`.
   Rejeições discriminam `causal_admission` e `publication`. Limitações já
   normalizadas têm evento próprio e declaram quando a contagem original não
   está disponível. Registrar códigos, posições e contagens, sem conteúdo.

## Alternativas e consequências

Remover flags esconderia lacunas; exigir assinatura no hunk ignora corpo editado;
uma parte por ocorrência lexical repete contexto. Aumentar o número de partes foi
rejeitado neste ajuste. Relatório e prompt maiores consomem mais bytes, mantendo
os limites do ledger. O gate permanece parcial quando janelas ou recursos faltam.
Cobrir pistas disponíveis não comprova fechamento semântico das dependências.

## Confirmação

Regressões cobrem inventário moderado/overflow, declaração fora do hunk, import
intacto, nove consumidores compartilhando uma janela, remoções, limites e
composição plano/projeção/agregação. `--coverage-regression` usa base/head
compiláveis, oracle executável, diff que produz o HEAD exato e par positivo/negativo.
O ledger mantém US$ 0,50 acumulados; o relatório conserva resultados e limites.
