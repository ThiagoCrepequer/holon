---
id: ADR-0036
kind: decision
status: accepted
date: 2026-09-08
owners: [core-team]
supersedes:
  - 0014-version-executor-rpc-and-broker-github-credentials.md
  - 0015-use-causal-admission-and-durable-terminal-cleanup.md
  - 0026-centralize-github-app-keyring-and-enable-zero-downtime-rotation.md
  - 0028-adopt-declarative-repository-policy.md
  - 0029-adopt-internal-operational-console-and-d1-read-model.md
  - 0030-identify-project-versions-from-snapshot-evidence.md
  - 0034-make-review-checkpoints-and-revalidation-durable.md
  - 0035-plan-complete-context-before-sharding.md
---

# Manter um único contrato atual durante o desenvolvimento

## Contexto

Holon não foi publicado e está em desenvolvimento. Manter schemas, RPCs, aliases
e conversões para formatos antigos amplia a superfície de bugs sem atender uma
necessidade de compatibilidade de consumidores. O produto solicitou remover
essas camadas e proibir a repetição desse padrão no AGENTS.md.

## Decisão

Cada API interna, evento e payload de aplicação tem um único contrato atual.
Produtores, consumidores, contratos, fixtures e documentação mudam juntos.
Não usar sufixos de versão em tipos ou métodos, discriminadores `schemaVersion`,
negociação, dual-stack, aliases ou conversões para payloads antigos. Formatos
retirados são rejeitados, inclusive campos de versão que um consumidor antigo
ainda envie. Nomes diferentes representam responsabilidades diferentes:
`ReviewContext` é o contexto completo do repositório; `ReviewShardContext` é a
entrada selecionada para um shard, com seus próprios limites.

A superfície atual inclui `prepareRepository`, `loadContext`,
`discoverProjectMetadata`, `claimRun`, `getRunDetail` e `ping`. O ping retorna
`{ ok: true }`. `claimRun` retorna outcome e obrigações de supersession; a data
causal obrigatória vem de `pull_request.updated_at` e acompanha a run, sem
substituição pela data de recebimento. O detalhe admin preserva execução ativa,
DAG, cleanup, perspectiva de findings e identificação de projetos em um único DTO.
A revalidação exige leitura das refs atuais do GitHub, sem fallback para o base SHA
do webhook em sessões antigas. O binding do executor exige todos os métodos atuais.

Credenciais exigem installation ID e escopo previamente registrado no ledger.
Não há descoberta/bootstrap para requests antigos. A chave do App exige
`GITHUB_APP_PRIVATE_KEY_CURRENT`; `GITHUB_APP_PRIVATE_KEY_PREVIOUS` continua
opcional para rotação operacional. O alias antigo é removido. Tokens continuam
JIT, limitados ao repositório e ausentes do request de preparação e do Sandbox.

A política YAML não tem campo de versão. Eventos de projeção e seus registros
não carregam tags constantes de formato. O event ID é `proj:<hash-do-run-id>`;
o marcador de publicação é `<!-- holon;run=...;finding=... -->`. Permanecem
hash canônico, imutabilidade, quarentena, sanitização de marcadores não confiáveis
e publicação idempotente. Findings persistidos exigem hash de evidência e
confiança explícita; o host não inventa valores para preencher registros antigos.

Esta ADR substitui somente as exigências de compatibilidade/versionamento e os
nomes associados nas decisões listadas. Preserva suas demais decisões: autoridade
por SHA/política, ordem causal, cleanup durável, isolamento e broker, rotação de
chaves, console interno com D1, identificação por snapshot, checkpoints limitados,
reconciliação conservadora e os limites de contexto da ADR-0035 (300 kB agregados,
60 kB por arquivo/shard, até cinco shards e 50 arquivos, 500 kB serializados).

Versões de dependências e protocolos externos, revisões usadas na identidade de
cache ou proveniência de avaliações, revisões causais e ordenação de migrations
não são APIs de compatibilidade. Permanecem quando têm essa função concreta.
ADRs substituídas e pesquisas datadas são histórico, não instruções vigentes.

## Consequências e alternativas rejeitadas

Mudanças incompatíveis são aceitas no desenvolvimento. Atualizar todos os
componentes para a mesma revisão; dados, filas, caches, checkpoints e comentários
do formato antigo não têm leitura/retomada garantida. Um reset de estado de
desenvolvimento exige autorização explícita; não executar limpeza automaticamente.
O schema inicial D1 passa a refletir o formato atual. O ledger mantém migrations
ordenadas, mas remove adoção de banco sem registro de migrations e preenchimento
de campos antigos. Uma base de desenvolvimento incompatível precisa de reset,
conforme o [runbook](../operations/deployment.md).

Renomear mantendo aliases, conservar unions escondidas e aceitar formatos antigos
sem versão apenas ocultariam a mesma dívida técnica. Remover validação runtime
foi rejeitado: um contrato único continua estrito em toda fronteira não confiável.
A política pode ser revista quando existir uma necessidade real de consumidores
publicados, por uma nova decisão explícita.

## Confirmação

Testes rejeitam formatos aposentados, falta de identidade de instalação/data causal,
findings persistidos incompletos e aliases de configuração. Integrações verificam
produtores/consumidores atuais, publicação idempotente, autorização de credenciais,
projeção D1 e resumo conservador. Manter os thresholds existentes. Esta mudança
não executa deploy, reset de dados nem validação remota do novo contrato.
