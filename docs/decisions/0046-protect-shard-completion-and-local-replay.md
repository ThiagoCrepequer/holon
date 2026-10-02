---
id: ADR-0046
kind: decision
status: accepted
date: 2026-09-29
owners: [core-team]
supersedes: [0045-bound-review-generation-expenditure.md]
---

# Proteger conclusão por shard e reproduzir incidentes localmente

## Contexto

O PR #106 continuou incompleto após a ADR-0045: cinco partes chegaram à síntese
incompletas e três terminaram com `model_budget_exhausted`. O pool único admitia
consumo pelas primeiras partes sem preservar recursos para as seguintes ou para
finalização. O código também contava chamadas de checkpoint rejeitadas como
checkpoints sem progresso e reenviava todo o histórico de ferramentas.

Os logs antigos não identificavam qual dimensão do orçamento havia esgotado nem
se os checkpoints haviam sido aceitos. Esses defeitos são reproduzíveis no código;
não constituem prova de que expliquem sozinhos todas as falhas históricas do modelo.
O usuário autorizou corrigir e validar localmente antes de outra execução em produção.

## Decisão

Preservar os tetos agregados da ADR-0045: 64 chamadas, 4.000.000 bytes cumulativos
de entrada serializada e 120.000 tokens de saída. Dividi-los igualmente pelo número
imutável de shards, arredondando para baixo. A reserva transacional inclui índice,
quantidade de shards e fase; replay com quantidade diferente é erro de estado.

Cada parcela protege da investigação duas chamadas, até 128.000 bytes (limitados
à metade da parcela) e até 8.192 tokens de saída (limitados a 60% da parcela).
Finalização, recuperação e síntese podem usar essa reserva; a síntese usa a parcela
da primeira parte. Não há empréstimo entre shards. Essa escolha evita dependência
da ordem de agendamento e não garante conclusão de qualquer PR ou modelo.
Uma parte complexa pode esgotar sua parcela com saldo em outra. Planos muito grandes
podem ser inviáveis sob os tetos; preservam incompletude, sem ampliar gasto ou aprovar.

A admissão informa a dimensão recusada, limite, consumido e solicitado. Pode conceder
uma saída menor que a pedida; o middleware aplica esse máximo à chamada real. Uso
conhecido liquida uma única vez; falha ou ausência de usage mantém a reserva. Exaustão
na investigação preserva notas e segue para finalização com incompletude explícita.
Falhas de persistência continuam interrompendo o fluxo. A migração 19 adiciona o
índice de shard às reservas e o plano por run; reservas anteriores sem atribuição são
cobradas conservadoramente em cada parcela. Nenhum saldo consumido é zerado.

Somente checkpoints aceitos isoladamente podem contar como falta de progresso.
Checkpoint inválido ou misturado gera `model.checkpoint_rejected` e uma rodada de
reparo restrita ao checkpoint. Após três rejeições consecutivas, encerra de forma
limitada e incompleta. O critério de dois checkpoints aceitos sem avanço e os
prazos da ADR-0045 permanecem.

Após checkpoint aceito, conservar o prompt canônico, as notas de cobertura e o bloco
mais recente de consultas/checkpoint, além do bloco corrente. Retirar transcrições
anteriores; o modelo deve registrar fatos e pendências nas notas antes da compactação.
As notas e os resumos aceitos continuam disponíveis à finalização. Não há alteração
da validação canônica de evidência nem da proibição de aprovar revisão incompleta.

## Validação e limites

O [runner local](../operations/local-review-reproduction.md) fixa os SHAs e a
configuração do incidente. Executa a composição de produção do workflow, modelo,
ledger e publicação coletada, com consultas reais em Docker sem rede. O provider
simulado fica na fronteira HTTP do AI SDK; não fornece diretamente um resultado
final ao workflow. Os testes específicos cobrem concorrência, eviction, reservas,
reparo de checkpoint e compactação. Nenhuma inferência é necessária ao gate offline.

Esse runner usa steps imediatos e adaptadores locais de transporte/container: não
reproduz o agendador remoto do Workflows nem a concessão de keepAlive da plataforma.
Respostas simuladas comprovam o encadeamento e as invariantes, não a qualidade do
modelo. Uma avaliação local com provider real exige autorização de envio do contexto,
limites próprios e registro separado. Um resultado verde offline não autoriza afirmar
que o PR inteiro foi revisado corretamente por um modelo real.

Fontes verificadas em 2026-09-29:
[Cloudflare Vitest e Durable Objects](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/),
[AI SDK tools e controle de steps](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
e implementação instalada do AI SDK 7.0.84 (`prepareStep`, `response.messages` e middleware).
