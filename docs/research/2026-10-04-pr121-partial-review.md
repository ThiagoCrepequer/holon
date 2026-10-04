---
id: RESEARCH-REVIEW-121-PARTIAL
kind: research
status: current
date: 2026-10-04
owners: [core-team]
---

# PR #121: review parcial e formato do feedback

## Evidência confirmada

- A review `COMMENTED` do [PR #121](https://github.com/ThiagoCrepequer/holon/pull/121)
  foi enviada em `2026-10-04T03:51:52Z` para o head
  `ff27f674899e9da078bf002fd8e907ef16987c6c` e base
  `14f24e41c1b9b03248a795b82cf5eb9e3d1837b9`.
- O resumo publicado registra cinco de seis partes analisadas, zero achados
  verificados retidos e falha da parte 5 (`shard-4`) com o código
  `agent_workflow_failed`. O sinal de símbolo exportado removido é uma pista de
  investigação estrutural, não um finding verificado.
- No código atual, `ThinkReviewer` usa `agent_workflow_failed` quando o
  `ReviewShardWorkflow` informa status `errored`; `review-analysis` transforma
  essa exceção em shard com status `failure`. A agregação conserva a cobertura
  parcial e publica `COMMENT`, sem concluir que o PR está correto.
- O ID determinístico da instância dessa parte, calculado de
  `SHA-256(<runId>:4)`, é
  `review-6e191a78c5e6cc17633c7da57ebdef04884dd21919da400a406bb8f1016be429`.
  O nome do Workflow é `holon-review-shard-workflow`.
- O formato antigo é reproduzido pelo código antes desta correção: a mudança
  recente introduziu o cabeçalho `Holon` apenas no ramo de aprovação sem
  achados. Outros vereditos ainda usavam `formatVerdictBadge`; o plano sem
  arquivos elegíveis e a atualização por feedback tinham caminhos próprios.

## Limite da investigação inicial

Uma consulta somente leitura a `wrangler whoami` falhou na leitura do macOS
Keychain (`exit 51`). A instância, seus steps, os eventos estruturados e o
trace do Agent não puderam ser consultados nesta investigação. Portanto,
`agent_workflow_failed` **não demonstra** se a causa interna foi provider,
orçamento, ferramenta, timeout ou runtime. Também não foi verificada a versão
implantada dos Workers; a correspondência textual com o código local não prova
qual commit estava em produção.

Quando houver acesso somente leitura, consulte a instância acima com
`wrangler workflows instances describe holon-review-shard-workflow <id> --no-step-output`
e correlacione `review.shard_failed`, `model.budget_rejected` e eventos do
Agent pelo `runId` e índice 4. Preserve prompts, patches, outputs de tools e
credenciais fora do relatório.

## Atualização em 2026-10-04: causa confirmada

Com o token local de `.env.cloudflare`, uma consulta somente leitura à
instância confirmou status `errored` e erro `ZodError` após a conclusão de
`review-shard:wait-1`. O step `review-shard:submit-1` havia concluído. A API de
[saída integral de step do Cloudflare Workflows](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/step/)
foi consultada para evitar o truncamento do resultado em `wrangler describe`.
O payload permaneceu em memória; este relatório não inclui seu conteúdo nem a
credencial.

A resposta estruturada satisfez `modelReviewPromptSchema`, continha dois
**candidatos** a finding e retornou `summary` vazio. O parse local dessa mesma
resposta em `parseModelReviewTransport` falhou em `summary` (`too_small`, mínimo
de um caractere). Portanto, a conclusão do modelo ocorreu, mas a validação
posterior no host descartou o shard inteiro. Esses dois candidatos não
passaram pela verificação de evidência canônica e não podem ser classificados
como achados verificados. O erro observado explica `agent_workflow_failed`;
não há evidência de falha de provider, orçamento ou tools nesse shard.

A correção mantém `summary` como campo obrigatório, aceita texto vazio apenas
como saída degradada e preserva os candidatos para a verificação de evidência.
O veredito permanece conservador quando faltar narrativa. O teste focado
reproduziu `ZodError` antes da mudança e passou depois. Não houve novo deploy
nem reprodução remota após a correção; esta análise descreve a execução
anterior e a prova local do contrato alterado.

## Atualização em 2026-10-04: comentários da revisão seguinte

A revisão do head `ad69f06b30f7579d5c41c98511436a6c84893def` publicou dois
comentários inline e solicitou alterações. Ambos trazem um excerto correto do
diff, mas não identificam um consumidor quebrado nem uma falha observada:

- Em `packages/contracts/src/review-output.ts`, o comentário afirma que
  `summary` passou a opcional. A propriedade continua exigida por
  `z.strictObject`; apenas o valor vazio foi aceito. O parser de transporte
  força `isDegraded: true` nesse caso, e os demais usos de produção validam a
  saída normalizada. Não foi demonstrada incompatibilidade.
- Em `packages/github/src/client.ts`, o comentário alerta que mover
  `GitHubAppCredentials` poderia quebrar imports. `client.ts` continua
  exportando o tipo de `authentication.ts`, o barrel de `@holon/github` continua
  exportando `client.ts`, e o consumidor de produção importa o tipo pelo pacote.
  O typecheck do monorepo passou. Não foi demonstrada quebra.

Os dois são falsos positivos como findings bloqueadores. A verificação do host
confirmou apenas posição e excerto do patch, não a correção causal da alegação.
O prompt já dizia que sinais estruturais não são defeitos automáticos, mas a
resposta converteu pedidos de verificação em findings. A instrução foi
refinada para exigir consumidor/operação e falha concreta, incluindo distinção
entre campo obrigatório e valor vazio e entre remoção e reexport de tipo. O
analisador estrutural também emitia a pista incorreta
`exported_symbol_removed` para `GitHubAppCredentials`: sua extração reconhecia
a declaração removida, mas não a reexportação de tipo adicionada no mesmo
módulo. O detector agora suprime essa pista somente para `interface` ou `type`
preservados por reexportação de tipo; remoções de símbolos de runtime e de
outros nomes continuam sinalizadas. O teste reproduziu a pista antes da
correção e passou depois.

O corpus V4 guarda controles negativos sintéticos para as duas situações. Testes
locais verificam o prompt e que o grader conta as alegações como findings
inesperados; ainda falta avaliação live do Agent para medir a redução real.
