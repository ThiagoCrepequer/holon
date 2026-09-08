---
id: ADR-0034
kind: decision
superseded-by: 0036-use-single-current-development-contracts.md
status: superseded
date: 2026-09-08
owners:
  - core-team
supersedes:
  - 0006-use-granular-workflow-checkpoints.md
  - 0020-reconcile-findings-across-commits-with-stable-fingerprints.md
related:
  - 0018-adopt-two-phase-decoupled-review-generator.md
  - 0021-capture-human-feedback-and-calibration-signals.md
  - ../research/2026-09-08-review-core-reliability.md
---

# Tornar checkpoints e revalidação de findings duráveis

## Contexto e problema

A análise agregada duplicava evidências em `findings` e `activeFindings` e
incluía todo o histórico do PR. Um caso válido com 40 findings excede 1 MiB.
Retomar callbacks já concluídos perdia contadores em memória, enquanto branches
baseados no relógio podiam ignorar resultados de identificação persistidos.
A reconciliação confundia paráfrase com novo defeito e silêncio com correção.
Uma gravação tardia podia sobrescrever feedback humano; respostas de resolução
não tinham a mesma reconciliação de publicação dos comentários iniciais.

## Decisão

Preservar as fronteiras de preparação, publicação, autorização causal e cleanup
da ADR-0006, com estas alterações:

1. `plan-review` guarda IDs determinísticos e deadline. Cada `analyze-shard-N`
   guarda somente seu resultado limitado. `analyze-review` agrega, reconcilia e
   salva um artefato privado validado no SQLite do DO do PR, dividido em BLOBs de
   até 64.000 bytes. Seu checkpoint retorna um manifesto limitado: resumo,
   metadados e coordenadas de publicação, sem evidências duplicadas ou histórico.
   A primeira gravação é imutável. Publicação carrega o artefato dentro do step.
2. O cleanup terminal durável remove o artefato após confirmar a destruição do
   executor, em sucesso, falha ou obsolescência. Resultados individuais dos
   shards continuam sujeitos à retenção do Workflow; não afirmar que apagar o
   artefato apaga o histórico da plataforma.
3. Uso é persistido em eventos no ledger; IDs repetidos não somam duas vezes.
   Tempos vêm dos registros de tentativas. Snapshots terminais são checkpoints.
   A contabilização cobre respostas/erros com uso informado pelo SDK; não é uma
   reconciliação de fatura e não observa um provider que faturou antes de uma
   interrupção sem resposta. Relógios que decidem identificação rodam dentro
   dos respectivos callbacks; resultados persistidos são restaurados no replay.
4. O orçamento de análise é 600 segundos de relógio, dividido pelo número de
   shards restantes. Investigação recebe 60% do tempo restante do shard;
   finalização recebe metade do restante e recuperação pode consumir o saldo.
   Síntese tem teto separado de 30 segundos. Os 12 acessos às tools são divididos
   deterministicamente (cinco shards: 3/3/2/2/2) e reservados atomicamente no DO
   antes da execução. Recriar o serviço não renova esse limite. Reservas perdidas
   em uma interrupção não são devolvidas; orçamento esgotado degrada a review.

Preservar os estados, comentários originais e fingerprint primário da ADR-0020,
com estas alterações de semântica:

5. Acrescentar `evidenceFingerprint` versionado, calculado pelo host a partir do
   path âncora e de todos os pares path/trecho normalizado, ordenados e sem
   duplicatas. Um match secundário só reutiliza identidade quando é único nos
   dois conjuntos e não disputa um match primário. Não é equivalência semântica:
   achados distintos com a mesma evidência podem coincidir. Ambiguidade conserva
   identidades distintas. Registros legados sem hash secundário só o recebem em
   match primário exato; não há backfill inferido de diagnóstico.
6. Ausência não confirma correção. O modelo recebe até oito findings anteriores
   ativos por shard e pode propor `resolutions` com fingerprint, diagnóstico,
   confiança e evidência atual. O host exige confiança >= 0,9, fingerprint/path
   do baseline, shard sem degradação, linha alterada RIGHT e trecho presente no
   patch canônico. Evidência idêntica ao hash anterior não confirma resolução.
   O gate prova origem e localização, não a correção causal do raciocínio.
   Findings ativos sem revalidação permanecem pendentes e impedem `APPROVE`.
   Arquivo fora do PR só fica obsoleto com cobertura completa.
7. Reaplicar feedback persistido na mesma transação que salva os findings.
   Antes de publicar, recalcular seleção e veredito com o feedback atual.
   Não existe transação distribuída com GitHub: feedback que chega após a
   leitura pode exigir o fluxo normal de atualização por feedback.
8. Resposta de resolução usa identidade por fingerprint/head, marcador,
   autorização atual do ledger/refs e reconciliação antes de repetir `POST`.
   Erro transitório não é convertido silenciosamente em sucesso.
9. Finding descartado pelo gate de evidência degrada o shard, evitando que uma
   saída inválida seja transformada em aprovação por ausência de findings.

## Alternativas rejeitadas

- Truncar histórico/evidência para caber no checkpoint: perde causalidade.
- Armazenar somente contadores em closures: não sobrevive ao replay.
- Hash apenas do diagnóstico ou substituição global dos IDs: perde feedback e
  threads existentes; hash somente da evidência sem checar ambiguidade também
  pode mesclar defeitos.
- Resolver automaticamente por ausência: confunde omissão com correção.
- R2 para este artefato temporário: adiciona infraestrutura desnecessária ao MVP.

## Consequências

Retomadas reaproveitam shards concluídos e preservam contabilidade observada.
O ledger mantém temporariamente código privado adicional, com deleção ligada à
obrigação de cleanup já existente. A revalidação conservadora pode manter
`COMMENT` mesmo após uma correção real, especialmente em dados legados,
resoluções que só removem código ou mais de oito pendências por shard.

A migration 13 adiciona o hash secundário, artefatos e eventos de uso. A sequência
de checkpoints não é compatível com instâncias antigas em andamento. O deploy
exige drenar ou terminalizar essas instâncias e confirmar cleanup antes de
substituir o código; detalhes no [runbook](../operations/deployment.md).

## Critérios de confirmação

- Payload agregado > 1 MiB conserva evidências no DO e checkpoint < 64 kB no caso
  de regressão; round-trip UTF-8 multibyte e eviction preservam o resultado.
- Replay após interrupção não repete shard concluído nem perde versões/uso.
- Budget concorrente e eviction respeitam 12 reservas totais e quota por shard.
- Feedback tardio, paráfrase, ambiguidade, silêncio, evidência rejeitada e
  sequência de quatro commits têm regressões específicas.
- POST aceito com perda de confirmação no ledger é reconciliado sem duplicata.
- Gates locais mantêm thresholds; retomada real, provider e GitHub reais ainda
  precisam de validação operacional específica desta mudança.

## Gatilhos para revisitar

Histórico que pressione memória/RPC, matching semântico com avaliação própria,
revalidação independente do diff ou evidência operacional de budgets inadequados.
