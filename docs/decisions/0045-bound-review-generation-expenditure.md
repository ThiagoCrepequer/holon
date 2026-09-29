---
id: ADR-0045
kind: decision
status: accepted
date: 2026-09-28
owners: [core-team]
supersedes: [0044-track-review-investigation-progress.md]
related:
  - 0043-bound-investigation-and-sandbox-lifecycle.md
---

# Exigir progresso e limitar o gasto agregado de revisão

## Contexto

No PR #104, oito shards consumiram 84 consultas de repositório bem-sucedidas.
Os 57 registros disponíveis no Gateway somaram 1.184.312 tokens de entrada e
69.461 de saída. Isso é uma amostra de uso, não uma fatura completa. Houve
encerramentos repetidos sem progresso e fechamento antecipado de ferramentas,
mesmo com vários minutos restantes. Dois erros classificados como permanentes
não tinham status original registrado; não há prova de uma causa única no provider.

O usuário aprovou controles de progresso, encerramento limitado, reutilização
segura e orçamento agregado. Esta decisão substitui a ADR-0044 quanto à cadência,
encerramento e escopo do cache. Mantém cobertura explícita, rollback de checkpoints
misturados com consultas, validação de evidência e veto de incompletude.

## Decisão

O host admite blocos de até quatro consultas não atendidas pelo cache. A próxima
rodada recebe apenas `review_checkpoint`. A execução também rejeita consultas
excedentes dentro de um único batch. Após dois checkpoints sem aumento da quantidade
de verificações revisadas ou bloqueadas, inicia o encerramento; mudanças apenas
na redação das notas não demonstram avanço. Bloqueado continua sendo incompleto.
O máximo anterior de 24 consultas e 25 rodadas permanece.

O encerramento tem uma única rodada, até 90 segundos, mesmo quando o modelo
retorna `finished=false`. Não há retry dessa rodada. A investigação permanece
aberta até a reserva final de 90 segundos; cada rodada anterior tem deadline
limitado para não consumir essa reserva. Os prazos globais não aumentam.
As conclusões registradas seguem para finalização mesmo sem `finished=true`.

Um cache em memória, criado por composição de serviços da run, compartilha somente
resultados concluídos, completos e sem marcador de segredo redigido. O contexto,
SHA e política são imutáveis nessa composição; validações de preparação e digest
continuam obrigatórias. O cache compartilhado admite no máximo 128 entradas e
2.000.000 bytes de chaves/conteúdo. Não compartilha promises, falhas ou resultados
cancelados; eviction e replay podem perder acertos sem mudar o resultado funcional.
O cache local mantém deduplicação e leituras de subintervalos.

Antes de cada inferência de revisão (investigação, finalização, recuperação e
síntese), middleware do AI SDK reserva recursos no ledger. A migração 18 adiciona
reservas numéricas, sem prompts, código ou respostas. `transactionSync` serializa
admissão e liquidação entre shards. Tetos agregados por run:

- 64 chamadas ao modelo;
- 4.000.000 bytes cumulativos da serialização de prompt, ferramentas e contrato de saída;
- 120.000 tokens de saída reservados ou consumidos.

O máximo de saída é reservado antes da chamada. Uso conhecido liquida a reserva
uma única vez; falha, cancelamento ou ausência de usage mantém o máximo reservado.
Tentativas e replay não renovam o orçamento. Falta de orçamento é classificada
como `model_budget_exhausted`, sem inferência adicional. Falhas de persistência
continuam sendo erros de infraestrutura. Esses tetos limitam exposição; não são
conversão exata de bytes em tokens nem promessa de custo monetário. A identificação
de projetos conserva seu orçamento próprio, já durável. Uma run muito grande pode
terminar incompleta por admissão; o limite não justifica aprovação parcial.

`model.phase_failed` inclui status HTTP e retryability quando o SDK fornece
`APICallError`. Não registra mensagens arbitrárias, bodies, prompts ou credenciais.
Ausência de status continua significando diagnóstico incompleto, não HTTP 200.

## Validação e consequências

Regressões usam AI SDK real com provider simulado e Durable Object SQLite local:
blocos, fechamento único, timeout, reserva anterior à inferência, concorrência,
liquidação idempotente, eviction e falhas incertas. Esses testes não demonstram
qualidade ou redução de custo remota. O próximo smoke deve comparar o mesmo diff,
modelo/rota e contagens, sem ampliar orçamentos para compensar ausência de progresso.

Consultado em 2026-09-28:
[AI SDK middleware](https://ai-sdk.dev/docs/ai-sdk-core/middleware),
[wrapLanguageModel](https://ai-sdk.dev/docs/reference/ai-sdk-core/wrap-language-model) e
[Durable Object SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
