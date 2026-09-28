---
id: ADR-0043
kind: decision
status: accepted
date: 2026-09-28
owners: [core-team]
supersedes:
  - 0042-balance-review-shards-and-investigation-budgets.md
---

# Coordenar investigação, cancelamento e ciclo do Sandbox

## Contexto

Na revisão remota do PR #95, três shards encerraram na décima rodada com mais
de seis minutos disponíveis. Em outros três, ferramentas demoraram 302–303
segundos e o SDK só entregou o timeout da rodada após aproximadamente 360
segundos. O adaptador descartava o AbortSignal fornecido pelo SDK. Reprodução
local com o SDK instalado confirmou que uma ferramenta que ignora cancelamento
retarda a rejeição. Os logs não provam em qual suboperação ocorreu a espera remota.

O usuário autorizou corrigir ambos os problemas e substituir a suspensão fixa
durante análise por controle resiliente que continue limitando recursos abandonados.
Esta decisão substitui a política de investigação da ADR-0042; preserva seus
limites de shards, concorrência, evidência e prazo compartilhado.

## Decisão

A investigação admite até 25 rodadas, incluindo síntese, compatíveis com 24
ferramentas sem cache. Não precisa gastar todo esse orçamento. Três rodadas
consecutivas solicitando apenas ferramentas já respondidas encerram por
`no_progress`. A saída conhecida acumulada tem teto de 120.000 tokens; os
últimos 12.000 são reservados para encerramento. O prazo de nove minutos e o
contador de ferramentas permanecem compartilhados entre tentativas. Encerramento
forçado continua incompleto; JSON válido não transforma investigação parcial em aprovação.
Uso desconhecido de chamadas interrompidas não pode ser reconstruído com exatidão.

O cancelamento do SDK atravessa os runners e chega a uma capacidade RPC
`startTool(runId, call, deadlineAt)`, com `result`, `cancel` e descarte explícito.
O prazo absoluto é limitado a 90 segundos e ao prazo restante da rodada.
A capacidade é idempotente durante sua vida: ler o resultado novamente não
executa outra ferramenta. Cancelamento é por operação, não destrói o Sandbox
compartilhado. O executor verifica a concessão, limita todas as esperas e não
inicia a próxima suboperação depois de expirar. Leituras tardias são descartadas;
processos recebidos tardiamente são encerrados. Promessas pendentes e limpeza
são retidas pelo contexto do Worker. A espera de confirmação de kill tem limite
de cinco segundos, com o deadline durável do container como última proteção.
Os comandos continuam com seus próprios limites de 10–20 segundos.

Ferramentas não refazem checkout. Recuperar contexto pertence ao Workflow antes
da investigação; perda durante a investigação é infraestrutura e impede publicação.
O startup do Sandbox tem limites explícitos de 30 segundos para obter instância
e 60 segundos para prontidão. A deadline de ferramenta continua abrangendo a operação inteira.

Cada onda concede ao Sandbox permanência até seu deadline absoluto, no máximo
17 minutos. A concessão é persistida no Durable Object do próprio Sandbox e
habilita keepAlive somente depois de agendar sua expiração. Replays usam o mesmo
prazo; ferramentas não o renovam. Ondas posteriores podem estendê-lo, mas uma
solicitação antiga não o reduz. Callbacks antigos conferem o estado atual.
Usamos `schedule()` do SDK, sem substituir seu `alarm()`. Datas são arredondadas
para cima ao segundo para não perder uma expiração pelo arredondamento do scheduler.

A expiração desabilita keepAlive e destrói o container. Agenda outra tentativa com espera crescente de cinco segundos até cinco minutos
antes da limpeza, pois o scheduler remove callbacks mesmo quando falham. Cleanup
terminal persiste fechamento antes de destruir; solicitações tardias não podem
reativar a concessão. Sem concessão, conserva-se a política de idle de 30 segundos.
Isso reduz reinícios durante inferência sem manter containers vivos indefinidamente.

`repository.tool_operation` separa verificação da concessão, leitura, início de
comando e leitura da saída. Registra etapa, duração e resultado operacional, sem
conteúdo. `generation_step_timeout` descreve o limite real do SDK; eventos de
falha distinguem duração da tentativa, duração da rodada e escopo do timeout.

## Alternativas e consequências

Aumentar apenas timeouts conserva a espera não cancelável. Desligar a cada 30
segundos durante inferência perde contexto. KeepAlive ilimitado sem expiração
durável deixa recursos abandonados. Cancelar a espera local sem encerrar processos
remotos também é insuficiente. Nenhuma dessas opções foi adotada.

Mais rodadas podem aumentar custo; os limites de ferramentas, tempo, saída e
falta de progresso limitam esse aumento. A permanência do container durante a
onda consome recursos enquanto o modelo trabalha. Queda de infraestrutura ainda
pode exigir reconstrução; concessão não promete persistência física do container.

## Validação e rollout

Testar investigação produtiva além da décima rodada, repetição sem progresso,
cancelamento, resultado tardio, isolamento de shards, replay da concessão,
expiração após reinstanciação e falha de destruição. Manter os gates de cobertura.
Publicar executor e control-plane compatíveis juntos; não retomar runs antigas
com contrato RPC antigo. Smoke remoto deve medir conclusão, ferramentas, rodadas,
startup, expiração e cleanup. Testes locais não comprovam o comportamento da
plataforma remota nem a recuperação do defeito específico do PR #95.

## Fontes verificadas em 2026-09-28

- [Lifecycle RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/): descarte de capacidades.
- [Container scheduling](https://developers.cloudflare.com/containers/reference/container-class/): `schedule()` preserva o alarm do SDK.
- [Sandbox preview lifecycle](https://developers.cloudflare.com/sandbox/1-0-preview/lifecycle/): ciclo do SDK usado pelo executor.
- SDKs locais `ai@7.0.84`, `@cloudflare/sandbox@0.13.0-next.751.1` e `@cloudflare/containers@0.3.7`: cancelamento cooperativo, scheduler e limites de startup conferidos no código instalado.
