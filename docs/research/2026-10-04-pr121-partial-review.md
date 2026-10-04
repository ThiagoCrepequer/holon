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

## Limite da investigação

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
