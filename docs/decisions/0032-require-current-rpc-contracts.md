---
id: ADR-0032
kind: decision
status: accepted
owners: [core-team]
last-reviewed: 2026-09-05
---

# Exigir contratos RPC atuais

## Contexto

Holon está em fase de testes e admite downtime durante deploys. Manter endpoints antigos e negociar versões aumenta a superfície de execução sem atender uma necessidade atual do produto.

## Decisão

Por solicitação explícita do produto, remover a compatibilidade de versões antigas nas APIs RPC entre control-plane, executor e admin. Esta decisão substitui as exigências de rollout N-1/dual-stack das ADRs 0014 e 0028 e de detalhe admin V1 da ADR-0030, preservando suas demais fronteiras.

- Preparação e leitura de contexto do executor usam exclusivamente V3, para políticas default e customizadas. Remover `prepare`, `prepareRepositoryV2`, `loadContext` e `loadContextV2` dos entrypoints e serviços.
- O control-plane não negocia métodos, converte respostas antigas nem sintetiza uma identidade de container quando `resolveContainerId` está ausente. Tokens não são enviados como argumento de preparação.
- O detalhe admin usa exclusivamente `getRunDetailV2` e o DTO V2, inclusive na leitura do ledger. Remover o endpoint V1 e o fallback/conversão do cliente.
- Um sufixo V1 não significa por si só compatibilidade: `pingV1`, requests de metadados e outros contratos sem substituto continuam atuais.

## Consequências

Deploys devem atualizar os três componentes para a mesma revisão. Versões mistas podem falhar durante a atualização; isso é aceito nesta fase. Validar com novas execuções após completar o deploy.

Migrações de armazenamento e registros históricos não são APIs de compatibilidade e permanecem preservados. Não há limpeza destrutiva de dados ou retentativa automática de runs antigas.

## Verificação

Testes devem provar rejeição de formatos antigos nos endpoints atuais, ausência de chamadas aos métodos removidos, leitura do detalhe com evidências e preservação das regras de checkout, exclusão e credenciais. Não reduzir thresholds de cobertura.
