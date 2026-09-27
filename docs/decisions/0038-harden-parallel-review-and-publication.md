---
id: ADR-0038
kind: decision
status: accepted
date: 2026-09-27
owners:
  - core-team
related:
  - 0018-adopt-two-phase-decoupled-review-generator.md
  - 0034-make-review-checkpoints-and-revalidation-durable.md
  - 0035-plan-complete-context-before-sharding.md
  - 0036-use-single-current-development-contracts.md
---

# Endurecer análise paralela e publicação durável

## Decisão

A execução mantém investigação e finalização separadas. Os shards do plano são
executados concorrentemente, com instâncias de modelo e orçamento de ferramentas
independentes, no mesmo Sandbox identificado pela run. A preparação concorrente
é compartilhada por uma promessa por execução; o workflow espera todos os shards
antes de agregar ou iniciar cleanup. Cada shard admite 12 chamadas de ferramenta,
reservadas também no ledger. O hash do plano inteiro é revalidado no replay.

Somente falhas classificadas de modelo permitem resultado parcial. Falhas de
contexto, persistência ou invariantes interrompem a publicação. Achados rejeitados
por falta de evidência tornam o resultado incompleto e têm contagem observável.
A finalização recebe janelas canônicas limitadas do patch, escolhidas pelo host.
`findings` ausente ou inválido é erro; não equivale a uma lista vazia. O limiar de
confiança de 0,8 é compartilhado por veredito e publicação inline. Ranges inline
precisam caber no mesmo hunk canônico.

A gravação de achados exige a run escritora e valida, dentro da transação SQLite,
que ela continua sendo a run mais recente em publicação. Feedback humano continua
sendo reaplicado nessa transação. Cleanup e terminalização precedem contabilização
no caminho de falha.

O workflow persiste o estado desejado do Check Run e solicita sua reconciliação
imediata ao Durable Object. A reconciliação do workflow e do alarm usa um único
proprietário serializado. Falhas deixam trabalho persistido com backoff. O host
revalida head e base antes de reconciliar; uma run obsoleta só cancela seu próprio
check. Uma conclusão atrasada não confirma uma revisão de estado mais recente.

Webhooks de CI e feedback são confirmados após persistência na fila existente.
O consumo confirma sucesso ou solicita retry; falhas transitórias não são
convertidas em feedback ignorado. Evidências de CI são armazenadas por PR, SHA,
workflow run e tentativa. Uma tentativa antiga não substitui a nova. O resumo
combina execuções distintas e é atualizado por uma tarefa durável após a review
existir. Mudanças durante uma publicação deixam a tarefa pendente para nova
reconciliação. Cobertura só é correlacionada com um diff cujas refs foram
revalidadas antes e depois da leitura.

ZIPs são baixados por streaming com limite de 10 MiB; a extração limita alocações,
12 MiB descompactados e 2 MiB por arquivo. JUnit usa parser XML, rejeita DTDs e XML
inválido e apresenta texto escapado, sem sequências de terminal ou segredos
reconhecidos. Observações LCOV duplicadas são combinadas independentemente da ordem.

Orientações por projeto e alvos de compatibilidade seguem o snapshot imutável
da ADR-0037, compilado no SHA base. As referências de documentação integram o
mesmo contrato de entrada e seu configDigest. Fatos de versões observadas permanecem separados. Documentação é
opcional, limitada a hosts oficiais permitidos, correspondência exata de versão e
hash SHA-256 configurado; redirects são proibidos. Ela é obtida no control plane,
sem ampliar egress do Sandbox. Falhas e omissões são contexto explícito, nunca
prova de ausência de defeito. A projeção de versões mantém JSON válido sob limite.

## Alternativas rejeitadas

- Paralelizar com índice de shard e orçamento mutáveis compartilhados.
- Aprovar após normalizar JSON inválido para zero achados.
- Usar `waitUntil` como entrega durável de CI e feedback.
- Confiar na ordem de chegada de workflows ou publicar o último resultado isolado.
- Buscar documentação genérica `latest`, sem versão observada e sem conteúdo fixado.
- Instalar dependências ou executar testes arbitrários do repositório revisado.

## Consequências e limites

Mais shards podem consumir até 12 chamadas cada; concorrência reduz latência, não
custo total. A documentação fixada por hash exige atualização explícita quando a
fonte mudar e não cobre automaticamente toda biblioteca. O resumo de CI identifica
execuções e tentativas; somar testes de workflows distintos não deduplica o mesmo
caso executado em matrizes diferentes. Testes são importados dos artifacts do CI,
não executados pelo Sandbox.

A migração 16 cria o armazenamento atual e renomeia o antigo para
`retired_ci_evidences`, sem apagar dados. Não há leitor legado: evidências antigas
não entram na nova agregação. Uma nova entrega de CI deve repovoar o contrato atual.
A remoção do armazenamento retirado ou reset de desenvolvimento exige ação
explícita do operador. Nenhum reset, recurso remoto ou deploy ocorre nesta mudança.

## Confirmação

Testes locais devem provar barreira de shards, preparação compartilhada, erro de
infraestrutura sem publicação parcial, escritor obsoleto recusado, recovery de
checks, concorrência de CI, SHA antigo sem correlação, limites de ZIP, XML malformado,
saída inválida e evidência canônica. `pnpm verify` permanece obrigatório. A passagem
local não comprova execução real com GitHub App, provider e Cloudflare.

## Fontes verificadas em 2026-09-27

- [Regras de Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [SQLite em Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Streaming de respostas no Octokit](https://github.com/octokit/request.js/)
- [Sandbox e sessões](https://developers.cloudflare.com/sandbox/concepts/sessions/)
