---
id: ADR-0041
kind: decision
status: accepted
date: 2026-09-28
owners: [core-team]
supersedes:
  - 0039-partition-large-reviews-and-bound-concurrency.md
---

# Gerar o diff do PR no Sandbox e transportar contexto por stream

## Contexto e decisão

O PR #90 falhou em `prepare-repository`, antes do modelo. A consulta ao endpoint
de diff do GitHub respondeu HTTP 406 com limite de 20.000 linhas. Esse limite
independe dos orçamentos de shards. A correção foi autorizada pelo usuário.

Esta decisão substitui somente a aquisição e o transporte do diff/contexto da
ADR-0039 e das disposições anteriores consolidadas por ela. Seus limites de
análise, particionamento, evidência, concorrência e publicação continuam vigentes.
Os ADRs anteriores permanecem intactos como histórico.

O request de preparação contém identidades e política, sem `canonicalDiff`.
O Sandbox busca os SHAs exatos de head/base e a referência do PR pelo broker
existente, restrito ao repositório. A referência permite alcançar commits de
forks; não substitui os SHAs como autoridade. O histórico aprofunda em 64, 256,
1.024 e 4.096 commits. Aceita-se um único merge-base apenas quando não há fronteira
de histórico raso acima dele. Ausência, ambiguidade ou histórico insuficiente
interrompem a preparação; não há fallback para comparação entre pontas.

Com egress bloqueado e checkout conferido, um programa fixo do host executa
`git diff mergeBase headSha` (semântica de `baseSha...headSha`), desabilitando
external diff e textconv. O diff é escrito incrementalmente em arquivo fora do
checkout; somente bytes/digest saem desse comando. Páginas de 48.000 bytes,
codificadas em base64, permitem recuperar o conteúdo sem truncar stdout ou UTF-8.
O executor verifica tamanho e SHA-256 antes de classificar o diff.

O contexto filtrado é salvo em páginas de até 32.000 unidades UTF-16, sem cortar
pares substitutos. Os nomes incorporam o digest; um manifesto publicado por
último indica conclusão. `openContext` retorna manifesto e um único stream RPC
com backpressure. O consumidor verifica tamanho, UTF-8 e SHA-256 antes de validar
`ReviewContext`. Assim, cada página não exige outra invocação de Worker. Conteúdo
e streams são consumidos dentro do callback e nunca viram output de step.

## Limites e qualidade

- Diff bruto: 16.000.000 bytes, com falha explícita acima do teto.
- Histórico e leitura do diff compartilham deadline de quatro minutos por
  preparação; o step admite dez minutos para recuperação e demais operações.
- Contexto: até 2.000.000 bytes de patches completos, 1.000 arquivos, 32.000
  coordenadas e 8.000.000 bytes serializados. Excesso de patches é marcado como
  omissão; nenhum arquivo admitido é cortado silenciosamente.
- Autoridade de metadados: paths únicos, até 10.000, e 2.000.000 bytes serializados.
- Shards: permanecem até 64 partes, cinco simultâneas no mesmo Sandbox. Divisão
  por hunk/linhas conserva coordenadas e evidências conforme ADR-0039.

Paginação de transporte não é resumo nem seleção por modelo. Perda de páginas,
corrupção e falha de infraestrutura impedem publicação como análise completa.
Os limites de análise continuam podendo produzir revisão incompleta; esta
mudança não promete cobertura ilimitada nem elimina timeouts do provedor.

O enriquecimento posterior de CI ainda usa o diff da API para correlacionar
cobertura por linha. HTTP 406 ou excesso do limite local preservam resultados de
testes e cobertura geral, com limitação explícita da correlação. Outras falhas
continuam propagadas para retry; a limitação de CI não mascara falha da revisão.

## Alternativas e consequências

Aumentar somente o body ou timeout não remove o HTTP 406. Paginar arquivos pela
API não garante que seus patches venham completos. Uma chamada RPC por página
acumula invocações de Worker; um stream evita essa multiplicação. Transportar
todo o contexto como output de Workflow viola o limite de checkpoint.

O checkout exige mais histórico e I/O. O executor ainda materializa o diff bruto
limitado em memória para os analisadores atuais. Não são executados scripts do
repositório, instalações de dependências, submódulos nem novos destinos de egress.

Executor e control-plane precisam ser publicados juntos em janela coordenada,
após drenar runs antigas. Não há leitor legado; retomada de versão antiga contra
o novo RPC não é suportada. Nenhum deploy é implícito nesta decisão.

## Confirmação

Regressões locais cobrem Git real com mais de 20.000 linhas, divergência da base,
histórico raso, referência de fork, renames, binários, textconv desabilitado,
paginação, Unicode, digest, limites e transferência por service binding em
workerd. O gate local não substitui smoke remoto com GitHub App e Cloudflare.

## Fontes verificadas em 2026-09-28

- [Git diff](https://git-scm.com/docs/git-diff): comparação de três pontos,
  external diff e textconv.
- [Cloudflare RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/):
  mensagens serializadas até 32 MiB e transferência por streams.
- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/):
  limite de invocações de Workers por request.
- [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/):
  output de step não streaming até 1 MiB.
