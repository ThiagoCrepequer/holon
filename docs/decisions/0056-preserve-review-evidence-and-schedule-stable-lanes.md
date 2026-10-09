---
id: ADR-0056
kind: decision
status: accepted
date: 2026-10-08
owners: [core-team]
related:
  - 0039-partition-large-reviews-and-bound-concurrency.md
  - 0049-use-cloudflare-think-for-pr-review.md
  - 0050-verify-finding-causality-before-publication.md
  - 0053-align-review-admission-with-generation-budget.md
---

# Preservar evidência e agendar análise em lanes estáveis

## Contexto e problema

A [auditoria](../research/2026-10-08-review-core-audit.md) encontrou perda de
fragmentos na agregação, equivalência textual indevida, omissões silenciosas,
avaliação otimista e reconciliação que confundia limite de paginação com ausência.
Waves também faziam partes rápidas aguardarem um peer lento. Investigação e
verificação repetiam leituras sem uma identidade comum de proveniência.

## Decisão

Preservar Think, conversas isoladas, executor restrito, três análises simultâneas,
nove shards admitidos e os tetos/quotas de modelo da ADR-0053. Esta decisão
substitui somente o agrupamento/agendamento anterior e complementa as garantias
de evidência, tools e publicação:

1. Fragmentos do mesmo path alimentam um índice canônico por coordenada. Conteúdo
   conflitante é rejeitado. Comparação e fingerprint de evidência preservam
   espaços; somente CRLF é normalizado para LF. Nenhuma equivalência antiga é
   tentada para reaplicar feedback. Achados históricos exigem revalidação positiva.
2. Agregação exige IDs e índices únicos pertencentes ao plano. Falha, limitação,
   resumo ausente e candidato rejeitado conservam parcialidade. O limite atual
   de oito findings por shard vem de `reviewTextLimits`, também usado no transporte.
3. Relações produtor/consumidor observadas no inventário determinístico podem
   unir grupos de arquivos alterados. Caps continuam prevalecendo; relações que
   atravessam shards aparecem como pistas compactas em ambos. Inventário parcial
   continua inconclusivo. Não inferir recall a partir de co-localização.
4. Planejamento grava até três lanes, determinísticas por bytes admitidos e índice,
   com no máximo `ceil(N/3)` tarefas em cada uma. Cada lane admite seu próximo
   shard após terminar o anterior. `admit-shard-N` persiste deadline e parada
   global; `analyze-shard-N` continua checkpoint individual. Todas as lanes são
   aguardadas com `allSettled`, inclusive após cancelamento/falha. Não há tasks
   abandonadas, fila dinâmica por corrida nem nova binding de conclusão.
5. Uma barreira de contexto por invocação conserva plano/digest. Replay reconstrói
   a memória e revalida o snapshot. Lease de cada shard é adquirido antes do
   trabalho e limitado ao deadline persistido; o prazo global comporta o número
   máximo de tarefas em uma lane.
6. `HolonSandbox` possui cache efêmero de tools por run/snapshot/política e
   argumentos normalizados: até 32 entradas e 1 MB, item até 100 kB. Erros,
   resultados vazios e truncados não ficam em cache. Requests iguais simultâneos
   compartilham a execução física. Toda chamada revalida lease/escopo e consome
   admissão lógica, inclusive hits. Cancelar um caller não cancela a operação
   compartilhada do DO; deadline físico continua limitado. Cleanup cerca conclusões
   tardias, aguarda operações e remove o cache antes da destruição.
7. O teto lógico continua 96. O ledger protege para cada peer
   `max(1, floor(96/(2*N)))` chamadas ainda não consumidas; o restante é compartilhado
   transacionalmente. A migração aditiva 23 fixa a cardinalidade da run sem zerar
   consumo histórico. Essa proteção de **tools** não muda as quotas iguais de
   **geração** da ADR-0053.
8. Leituras reais emitem receipts com run/head/path/janela/digest/truncamento e ID
   determinado pelo host. Um pacote de até oito entradas, 16.000 caracteres por
   conteúdo e 20 kB totais permite compartilhar reads na conversa independente.
   O host revalida identidade/conteúdo do pacote e as referências dos assessments.
   Premissa declarada `repository` exige receipt compatível e completo; `patch`
   não exige tool artificial. Receipt comprova leitura, não a verdade da inferência.
   Cache perdido ou pacote que não comporta a leitura causa incerteza, não confirmação.
9. Busca de publicação retorna `found`, `absent` ou `inconclusive`. Atingir vinte
   páginas conserva a obrigação de reconciliação e impede novo POST. Não há promessa
   de exactly-once nem avanço automático de cursor; o runbook explica a intervenção.
10. Avaliação mede candidatos brutos e publicados separadamente. Falha do subject
    permanece no recall operacional. Calibração deduplica por finding/PR, distingue
    conflito, aceitação, rejeição e resolução de thread e não fabrica veredito do PR.

## Opções consideradas

- **Manter waves:** menor complexidade, mas a bancada confirmou ociosidade evitável.
  Lanes preservam checkpoints sem depender da ordem de término. Podem ainda deixar
  um slot ocioso quando outra lane conserva tarefas; não são uma fila global perfeita.
- **Scheduler por `race`:** poderia balancear melhor, mas dificulta replay e join de
  trabalho. Rejeitado nesta entrega.
- **Cache durável ou global:** sobreviveria a eviction, com retenção privada e
  invalidação mais complexas. Rejeitado; perder a otimização é seguro.
- **Aumentar limites, emprestar quota de modelo ou trocar provider:** nenhuma prova
  de qualidade justificou isso. Quotas ponderadas são experimento local; incremental
  e diversidade continuam sujeitos aos gates R09/R10, sem ativação em produção.
- **Tratar busca limitada como ausência:** reduz espera ao custo de duplicar efeitos.
  Rejeitado; preferir obrigação pendente explícita.

## Consequências e critérios de confirmação

Os testes locais devem provar fragmentação, conflito, integridade semântica,
omissões, cardinalidade, lost response/página 21, quotas concorrentes, replay,
eviction, cancelamento de caller e refutação com leitura real do host. O inventário
de cobertura inclui todas as fontes; Node e Workerd do executor produzem um relatório
conjunto com os mesmos thresholds. Provider e container externos são controlados
na bancada; isso não comprova operação remota.

[Experimentos reproduzíveis](../research/experiments/2026-10-08-review-core-implementation/README.md)
medem índice, execuções físicas e lanes. Seu ganho é de host/carga sintética;
precisão/recall do modelo e latência de provider exigem avaliação real adjudicada.
Revisitar quando repetição de reads for baixa, a retenção gerar custo relevante,
ou a distribuição real de latência não acompanhar bytes de patch.
