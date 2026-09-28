---
id: ADR-0044
kind: decision
status: accepted
date: 2026-09-28
owners: [core-team]
supersedes: []
related:
  - 0043-bound-investigation-and-sandbox-lifecycle.md
---

# Acompanhar cobertura e encerrar a investigação por checkpoint

## Contexto

Na execução do PR #97 sobre a base de64f1b, oito shards concluíram 173 chamadas
de repositório sem falhas. As maiores durações por shard ficaram entre 2,7 e
5 segundos por ferramenta. Houve esgotamento de ferramentas e de prazo da
investigação; dois shards concluíram. Isso não prova redundância das consultas:
os corpos históricos do Gateway não estavam disponíveis. O código reutilizava
somente argumentos idênticos e dependia de uma conclusão livre do modelo, sem
registrar quais arquivos ainda precisavam de verificação.

O usuário autorizou otimizar a investigação, acompanhar pendências e reservar
recursos para encerramento. Esta decisão complementa a ADR-0043: preserva seus
prazos, limites máximos, cancelamento, concessões do Sandbox e veto de incompletude.

## Decisão

O host entrega uma lista completa por shard, priorizando achados anteriores,
pistas de segurança e contratos. A prioridade não é prova de defeito. O modelo
usa primeiro o patch e os sinais já recebidos, busca consumidores quando existe
uma pergunta causal e registra `review_checkpoint` após progresso significativo.
Cada arquivo permanece `pending`, `reviewed` ou `blocked`, com uma nota limitada.
Essa cobertura é autodeclarada pelo modelo; não substitui validação de evidências.

`finished` encerra o loop diretamente e evita outra geração narrativa. A finalização
recebe os diagnósticos registrados, cobertura e janelas canônicas. Identificadores
inválidos ou duplicados são rejeitados atomicamente. Notas diagnósticas anteriores
são preservadas até 32.000 caracteres, com rejeição explícita de excesso; não há
truncamento silencioso. Um checkpoint emitido junto de uma leitura/busca não pode
incorporar seu resultado: a rodada restaura o progresso anterior e precisa de outro
checkpoint. Pendências, bloqueios ou término sem checkpoint mantêm a revisão incompleta.
O estado é local ao step, não um novo mecanismo de persistência em D1.

Mantemos 24 chamadas ao executor e 25 rodadas, compartilhadas entre tentativas.
Nas últimas quatro chamadas, o prompt orienta resolver verificações pendentes.
Antes de uma nova rodada, se restam no máximo o teto de uma chamada (180 segundos)
mais 90 segundos de margem, o host oferece somente o checkpoint de encerramento,
com até 8.192 tokens. Também usa esse encerramento ao atingir limites duros.
Isso pode antecipar o encerramento em até 270 segundos; não garante conclusão do
provider. Limites duros continuam degradando o resultado mesmo com checkpoint válido.
Os nove minutos totais e reservas de finalização/recuperação não aumentam.

O cache fica isolado por investigação e SHA. Normaliza defaults de leitura e
executa buscas com caminhos únicos em ordem estável. Leituras completas podem
atender subintervalos efetivamente retornados. Conteúdo truncado, vazio ou com
marcador de redação de segredos não fornece cobertura de linhas. Falhas e resultados
cancelados não ficam em cache. Não ampliamos leituras nem compartilhamos chamadas
pendentes entre shards, preservando isolamento de cancelamento e políticas de acesso.

`model.investigation_progress` publica apenas contagens, duração e motivos:
requisições de ferramentas, chamadas ao executor, acertos do cache, subintervalos
reutilizados, resultados truncados, cobertura, tokens de saída e raciocínio
(quando fornecidos). Não publica caminhos, consultas, notas, código ou prompts.

## Alternativas e consequências

- Apenas aumentar ferramentas e tempo: rejeitado, pois não dá critério de conclusão
  e aumenta custo sem demonstrar qualidade.
- Tratar interrupção como aprovação: rejeitado; mantém-se o veto conservador.
- Cache global entre shards: adiado; exige identidade de política, limites de memória
  e cancelamento independente. Não há evidência atual de benefício suficiente.
- Checkpoint estruturado: adiciona uma ferramenta ao protocolo e depende de adesão
  do modelo. Pode aumentar rodadas quando usado excessivamente; as métricas precisam
  confirmar o ganho. Nunca converter notas do modelo em prova determinística.

## Confirmação

Testes com o AI SDK real devem demonstrar encerramento sem narrativa extra,
veto com pendências, rollback da rodada mista e seleção do checkpoint antes de
consumir a margem de tempo. Testes de cache devem provar subintervalos exatos,
normalização, isolamento de falhas, cancelamento e redação. O gate local não prova
redução de custo ou completude remota. Compare a próxima execução do mesmo diff
com as contagens, duração, tokens e cobertura do PR #97 antes de recalibrar limites.
