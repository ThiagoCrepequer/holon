---
id: ADR-0039
kind: decision
status: accepted
date: 2026-09-27
owners: [core-team]
supersedes:
  - 0038-harden-parallel-review-and-publication.md
related:
  - 0036-use-single-current-development-contracts.md
---

# Separar cobertura, particionamento e concorrência de reviews grandes

## Contexto e decisão

O PR #86 relatou cobertura omitida e esgotamento de ferramentas em cinco partes.
O teto de cinco shards também limitava a cobertura, patches grandes eram omitidos
inteiros e o indicador global de omissão era repetido em cada shard.

Esta decisão substitui somente o planejamento e agendamento de análise da
ADR-0038; suas demais garantias de publicação, autoridade, CI, evidência e
segurança permanecem exigidas. O usuário autorizou a correção estrutural.

O executor conserva os patches canônicos elegíveis completos do diff admitido
(até 2.000.000 bytes), com até 1.000 arquivos, 32.000 coordenadas e 8.000.000 bytes
de contexto serializado. O manifesto de análise comporta até 512 identificadores/severidades de achados;
conteúdo e coordenadas ficam no artefato durável e são recarregados para publicar.
O contexto é lido dentro dos steps e nunca retornado
como checkpoint de Workflow. Omissões de metadados continuam explícitas.

O planner divide patches por hunk e, quando necessário, por sequências contíguas
de linhas do hunk. Os bytes de código e as coordenadas old/new são preservados;
somente os headers de cada partição são calculados. Marcadores de ausência de
newline acompanham sua linha. Linhas individuais que não cabem no orçamento
são omitidas explicitamente, sem deslocar as coordenadas seguintes. A análise
pode consultar o snapshot exato para contexto que atravesse a divisão.

O alvo por parte é quatro arquivos, 192 linhas adicionadas e 24.000 bytes de
patch. Hunks pequenos do mesmo arquivo são agrupados respeitando os orçamentos,
inclusive um teto conservador de 24 janelas de evidência por parte. Admite-se até 64
partes, independentemente das cinco partes simultâneas. Omissões acima desse
limite continuam impedindo aprovação. A execução ocorre em ondas com checkpoints
individuais, usando o Sandbox da mesma run. A onda fixa seu deadline de 15 minutos
em checkpoint; replay não renova esse orçamento. O deadline global corresponde
à quantidade de ondas admitidas. Erros de infraestrutura continuam interrompendo
publicação depois de aguardar todas as partes em voo.

Cada parte mantém 12 chamadas de ferramenta, com reserva durável existente.
Consultas idênticas compartilham a promessa e o resultado apenas na investigação
corrente; erros não são guardados. A última das seis rodadas é reservada para
conclusão sem ferramentas. Fechamento forçado permanece incompleto. Eventos
registram motivo de parada, rodadas, chamadas, seções omitidas e cobertura
planejada, sem conteúdo privado. Omissão global não é atribuída a cada prompt.

## Alternativas e consequências

Aumentar somente timeouts ou remover limites não corrige perda de cobertura.
Executar todas as partes simultaneamente concentra custo e carga no Sandbox.
O processamento em ondas pode aumentar a duração total; 64 partes não equivalem
a cobertura ilimitada, nem garantem a qualidade semântica do modelo. Partições
menores podem exigir leituras adicionais para verificar relações entre partes.

Os contratos atuais são atualizados em conjunto, sem leitores legados. Novas
runs exigem executor/control-plane da mesma revisão; não se deve retomar artefatos
antigos como planos novos. Nenhum reset de dados ou deploy é implícito.

## Confirmação

Regressões devem provar conservação de linhas e coordenadas, UTF-8, marcadores,
ondas e limite de concorrência, replay sem repetir partes concluídas, barreira
antes de cleanup, limites residuais explícitos e cache sem reter falhas.
O gate local não comprova comportamento com provider e Cloudflare reais.

## Fontes verificadas em 2026-09-27

- [Regras de Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/): granularidade e estado durável por step.
- [Boas práticas de Workers](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/): bindings, promessas e limites de memória.
