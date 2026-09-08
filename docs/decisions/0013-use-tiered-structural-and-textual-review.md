---
id: ADR-0013
kind: decision
superseded-by: 0035-plan-complete-context-before-sharding.md
status: superseded
date: 2026-08-30
owners:
  - core-team
supersedes:
  - 0012-use-canonical-diff-and-bounded-semantic-recovery.md
related:
  - 0004-adopt-workflows-do-ledger-and-sandbox-executor.md
  - ../architecture/review-runtime-flow.md
  - ../architecture/security-and-trust-boundaries.md
  - ../research/2026-08-30-canonical-diff-and-semantic-output-incident.md
---

# Usar diff canônico, review estrutural JS/TS e textual elegível

## Contexto e problema

O piloto original aceitava somente JavaScript, TypeScript, JSX e TSX. Essa
restrição facilitou validar a busca estrutural, mas também descartou patches
textuais relevantes em Markdown, YAML, SQL, Dockerfiles e outras linguagens.
Uma run real alterou apenas documentação, concluiu corretamente sem modelo e
publicou um resumo que pareceu uma falha para o operador.

O parser de diff e as coordenadas inline não dependem de linguagem. A parte
específica é a busca estrutural com ast-grep. Git, por sua vez, distingue
patches textuais de arquivos binários: binários não produzem hunks textuais sem
uma conversão configurada.

## Decisão

- O GitHub App obtém o diff canônico do endpoint de Pull Request com media type
  `diff`. O executor não recalcula o diff a partir das pontas das branches e o
  Sandbox faz checkout exato do head para investigação direcionada.
- O request do executor aceita até 2 MB e transporta o diff canônico bruto antes
  da classificação. Esse diff permanece dado temporário e não é persistido como
  contexto integral nem enviado integralmente ao modelo.
- Cada arquivo do diff canônico recebe um modo `structural`, `textual` ou é
  ignorado.
- JavaScript, TypeScript, JSX e TSX usam modo `structural`, com ast-grep,
  leitura e busca textual.
- Qualquer outro caminho normalizado cujo patch Git não seja binário e não
  corresponda à política de exclusão é um `patch textual elegível`. Isso inclui
  alterações somente de remoção, rename ou metadata. Ele usa modo `textual`,
  com diff, leitura limitada e busca textual; o sistema não promete compreensão
  de AST para esse grupo.
- Arquivos binários, lockfiles, minificados, sourcemaps,
  artefatos gerados, vendorizados, diretórios de build e caminhos potencialmente
  sensíveis reconhecidos pela política não entram no contexto persistido nem no
  prompt do modelo.
- Detecção de binário usa a classificação do patch Git e uma lista defensiva
  de extensões conhecidas. Exclusões de caminhos sensíveis, gerados,
  vendorizados e minificados são heurísticas determinísticas, não um secret
  scanner nem uma garantia de classificação perfeita. A política de caminhos
  permanece deny-by-default para traversal e caracteres de controle.
- A mesma classificação autoriza tools: `read_file` rejeita caminhos ignorados;
  buscas textual e estrutural limitam roots e resultados a caminhos elegíveis;
  busca estrutural opera apenas sobre arquivos `structural`. Classificar um
  patch como textual nunca amplia tools, egress ou autoridade.
- O contexto seleciona no máximo 50 arquivos, 120 kB de patches completos e
  5.000 coordenadas. Cada modo recebe uma oportunidade inicial; depois a seleção
  favorece arquivos estruturais na proporção 3:1. Nenhum patch é cortado no meio
  de um hunk. Exceder um limite gera review explicitamente parcial.
- O contexto registra caminho e modo de cada arquivo. Sinais determinísticos de
  superfície são calculados somente para JS/TS; os logs registram apenas as
  contagens por modo.
- Se todos os arquivos forem ignorados, a run publica resumo determinístico sem
  chamar o modelo. Remoções, renames e metadata sem linha `RIGHT` comentável
  ainda chegam ao modelo; nesse caso, riscos comprovados aparecem somente no
  resumo, nunca como comentário inline sem âncora válida.
- A Dynamic Route continua responsável por falhas de transporte e provider.
  Uma resposta HTTP bem-sucedida sem objeto utilizável pode executar exatamente
  uma recuperação local sem tools; Workflow e AI SDK não repetem a sessão.
- Requests exigem providers que aceitem os parâmetros requeridos, negam coleta
  de dados no OpenRouter e limitam reasoning a `low`. O schema final permite no
  máximo três findings dentro do budget de 4.000 tokens.
- O AI Gateway não persiste request/response. Somente metadados seguros de run,
  contagens, tokens e finish reason permanecem observáveis.

## Alternativas rejeitadas

### Manter allowlist apenas de extensões

Rejeitada porque omite formatos textuais válidos e precisa acompanhar toda
linguagem ou ferramenta nova.

### Enviar todo arquivo presente no diff

Rejeitada porque lockfiles e artefatos gerados ampliam custo e ruído; caminhos
potencialmente sensíveis e binários aumentam a exposição sem benefício de
review.

### Tratar todas as linguagens como estruturais

Rejeitada porque oferecer ast-grep com gramática errada cria uma promessa de
análise que o executor não consegue sustentar.

## Consequências

### Positivas

- Configuração, documentação e código em outras linguagens podem receber review.
- Formatos desconhecidos continuam cobertos quando o Git produz um patch
  textual elegível.
- O modelo conhece explicitamente a capacidade disponível para cada arquivo.
- Orçamento e privacidade permanecem limitados.

### Negativas

- A revisão textual tem menos contexto semântico e pode exigir mais silêncio.
- As heurísticas de exclusão de artefatos e caminhos potencialmente sensíveis
  precisam de testes e evolução; elas não substituem redaction.
- Um repositório pode forçar um formato incomum a ser tratado como texto via
  `.gitattributes`; a denylist de extensões continua sendo defesa adicional.

## Critérios de confirmação

- Um patch de `README.md`, YAML ou Python chega ao modelo como `textual`.
- Um patch JS/TS chega como `structural` e mantém busca ast-grep.
- Um patch somente de remoção, rename ou metadata chama o modelo, mas sem
  coordenada `RIGHT` produz zero finding inline.
- Binários, lockfiles, `.env`, arquivos gerados, vendorizados e minificados não
  aparecem no contexto persistido nem podem ser recuperados por tools.
- Um PR contendo somente arquivos ignorados consome zero tokens de modelo.
- Prompt injection em documentação permanece delimitada como dado não
  confiável e não amplia tools ou autoridade.
- Smoke remoto publica resumo para um patch textual e limpa o Sandbox.

## Gatilhos para revisitar

- O corpus mostrar falsos positivos sistemáticos em algum modo textual.
- Uma linguagem justificar suporte estrutural próprio e testes de gramática.
- Um formato atualmente ignorado demonstrar valor suficiente para uma exceção
  explícita e segura.
- As heurísticas de exclusão deixarem de cobrir padrões relevantes do piloto.

## Evidência

Verificada em 2026-08-30:

- [Git diff: geração de patches e arquivos binários](https://git-scm.com/docs/git-diff)
- [Git attributes: classificação text/binary e textconv](https://git-scm.com/docs/gitattributes)
- [GitHub REST: obter um Pull Request como diff](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
- [Cloudflare AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
