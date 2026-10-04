---
id: ARCH-REPOSITORY-MEMORY
kind: architecture
status: current
owners: [core-team]
last-reviewed: 2026-10-04
related:
  - ../decisions/0051-learn-repository-rules-with-maintainer-approval.md
---

# Como funciona a memória incremental do repositório

A [ADR-0051](../decisions/0051-learn-repository-rules-with-maintainer-approval.md)
governa a memória. `memory/` no control plane contém o armazenamento e ChatOps;
`ledger/run-memory-store.ts` sela snapshots e escreve a outbox. Contratos de
fronteira ficam em `packages/contracts`, projeção e parsing em `application`.
Não há pacote novo nem acesso público ao Durable Object.

## Captura e autoridade

Análise salva achados verificados e até quatro descobertas por shard. Descobertas
precisam de path, linha e excerpt coincidente com o diff canônico; referências
exclusivas de tools ou conclusões sem evidência não são admitidas nesta entrega.
A correspondência prova a origem textual, não a verdade semântica da conclusão.
A memória guarda resumo e coordenadas, sem o excerpt.

Feedback salvo e mutação do finding compartilham a transação com a outbox.
Somente a aplicação inicial cria a obrigação; replay usa o registro anterior.
Feedback sem justificativa é registrado como sinal, mas não gera proposta
recorrente. Resolução de thread, helpful e outputs do modelo não aprovam regras.
Feedback anterior à existência de uma fonte de memória não recebe origem
inventada: somente novas runs criam essas fontes.

Três PRs distintos com mesmo arquivo, rótulo e justificativa normalizada geram
uma proposta de investigar esse feedback antes de repetir a recomendação.
Comentários repetidos no mesmo PR não aumentam esse apoio. Proposta automática
rejeitada não volta a ser gerada enquanto seu registro existir. Propostas
manuais são imutáveis e podem referenciar uma regra ativa a substituir.

## Execução e recuperação

O índice de instalações fornece o nome da geração; nenhum nome é fornecido pelo
modelo. O Workflow resolve memória após preparar o contexto e sela seu conteúdo
no ledger. O checkpoint guarda somente a revisão. Cada shard recebe todas as
regras aprovadas cujo root contém seus paths, mais observações históricas
selecionadas para esses paths. SHA e base originais continuam em cada fonte;
mesmo observação do SHA atual é pista a verificar, não política.

Não há supressão determinística nem recalibração de severidade por memória.
O modelo recebe precedência explícita para configuração do base e regras do
host. O contexto não amplia ferramentas nem altera o contrato de evidência.

A outbox tem entrega ao menos uma vez. Observação com mesmo ID/conteúdo é
idempotente; identidade conflitante é rejeitada. Falha mantém obrigação e
agenda retry limitado por backoff. Mudança de geração descarta a entrega antiga.
O índice persiste a revogação antes da purga e tenta novamente se necessário.
Alarm diário remove observações expiradas e registros de regras além da retenção.

Snapshots selados não incorporam aprovações ou revogações concorrentes. Estas
valem para novas runs; esta entrega não implementa cancelamento automático de
runs em andamento por revogação de regra. Snapshots expirados falham no replay,
sem substituição silenciosa por memória atual.

## Fontes e evidência externa

APIs consultadas em 2026-10-04:

- [SQLite dos Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/): transações por objeto; não há transação distribuída entre ledger e memória.
- [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): execução repetível; handlers mantêm idempotência.
- [Permissão GitHub por usuário](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user): consulta de autorização atual pelo adapter existente.

Estas fontes confirmam capacidades das plataformas. Testes Workerd confirmam
somente composição local; qualidade do review e autorização live exigem smoke
separado autorizado.
