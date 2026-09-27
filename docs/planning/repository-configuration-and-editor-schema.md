---
id: PLAN-REPOSITORY-CONFIGURATION
kind: planning
status: current
owners: [core-team]
last-reviewed: 2026-09-10
related:
  - ../decisions/0036-use-single-current-development-contracts.md
  - ../architecture/project-version-identification.md
  - ../architecture/review-runtime-flow.md
  - ../research/2026-09-09-repository-configuration-and-editor-schema.md
---

# Configuração de repositório: YAML, schema de editor e execução durável

## 1. Objetivo e autoridade

Expandir `.github/holon.yml` ou `.holon.yml` para preferências de saída, contexto
por projeto, compatibilidade, instruções inline/em arquivos e regras por caminho.
Entregar JSON Schema público para editores, com uma única definição atual e
validação efetiva em todos os consumidores do workflow.

O formato geral foi acordado com o usuário e a implementação das fases 0–5 foi
aprovada e entregue conforme a
[ADR-0037](../decisions/0037-compile-repository-configuration-per-run.md).
Este documento preserva o plano, os critérios de saída e as evidências locais.
Publicação e validação em ambiente real continuam dependentes da fase 6; a
implementação local não comprova um deploy.

Princípio central: **resolver uma vez por run, selar um snapshot imutável e
projetar apenas os valores necessários para cada etapa**. Nenhuma etapa relê o
YAML para buscar preferências atuais; retries continuam com a configuração da run.

A [ADR-0036](../decisions/0036-use-single-current-development-contracts.md)
permanece vigente: sem `version`, `schemaVersion`, RPCs com sufixos, aliases ou
leitura de payloads aposentados. Evolução exige atualizar contratos, consumidores,
exemplos e schema conjuntamente. A ADR-0037 define autoridade, snapshot,
instruções e identidade da execução.

## 2. Base existente e lacunas que bloqueiam a expansão

O [levantamento de evidências](../research/2026-09-09-repository-configuration-and-editor-schema.md)
traz fontes e arquivos inspecionados. Hoje já existem parser restritivo,
exclusões protegidas, rigor de veredito, resolução pelo base SHA, identificação
com proveniência e armazenamento privado de artefatos de análise.

Resolver estes pontos na entrega, sem tratá-los como compatibilidade necessária:

1. `readRepositoryPolicyFile` é opcional e o resolver aplica defaults quando o
   método está ausente. Tornar o port obrigatório e a indisponibilidade explícita.
2. Contents 404 vira ausência. Provar ausência por árvore Git autenticada e
   completa; erro de acesso/rede nunca vira configuração default.
3. Contents pode seguir symlink. Validar componentes e tipo/mode na árvore Git.
4. `runId` contém apenas head SHA. A base pode mudar sem mudar essa identidade;
   a admissão atual deduplica antes de considerar uma nova configuração.
5. O diagnóstico participa do fingerprint. Idioma não pode criar uma nova
   identidade do mesmo finding ou perder feedback já aplicado.
6. Idioma precisa alcançar finalização, recovery, síntese, texto do host,
   publicação e feedback. Alterar somente o prompt de investigação é insuficiente.
7. Instruções grandes não podem disputar silenciosamente o espaço dos patches
   e repetir o problema de contexto omitido antes do planejamento.

## 3. Formato implementado

A URL abaixo é ilustrativa; será substituída pelo host público do control-plane
na publicação autorizada. As versões de tecnologias são exemplos, não recomendações
de versões para um projeto real.

```yaml
# yaml-language-server: $schema=https://example.com/schemas/holon.schema.json

output:
  language: pt-BR
  detail: concise
  max_inline_comments: 8

review:
  additional_excludes:
    - "fixtures/generated/**"
  focus:
    - correctness
    - security
    - concurrency
  reference_files:
    - "docs/architecture.md"

verdict:
  strictness: default

instructions:
  - |
    Priorizar defeitos verificáveis e explicar seu impacto.
    Preservar as invariantes de negócio descritas na documentação.
  - path: docs/review-guidelines.md

projects:
  - name: backend
    root: apps/backend
    description: API responsável por pagamentos e faturamento.
    compatibility:
      runtimes:
        java: "21"
      frameworks:
        quarkus: "3.27.x"
    instructions:
      - |
        Operações financeiras devem preservar idempotência.
        Verificar arredondamento, concorrência e recuperação
        após falhas parciais.
      - path: AGENTS.md
      - path: docs/backend-review.md

  - name: frontend
    root: apps/frontend
    compatibility:
      runtimes:
        node: ">=22"
      frameworks:
        react: "19.x"
    instructions:
      - path: docs/frontend-review.md

path_rules:
  - paths:
      - "apps/backend/src/main/resources/db/**"
    instructions:
      - |
        Avaliar impacto sobre registros existentes.
        Verificar locks e duração das alterações de schema.
```

Semântica dos campos:

| Campo                        | Comportamento e default                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `output.language`            | Catálogo inicial `en`, `pt-BR`, `es`; default `en`. Vale para texto público produzido pelo Holon, não para código/evidência. Só anunciar idiomas com templates e avaliações entregues.                                               |
| `output.detail`              | `concise` ou `detailed`; default `concise`. Ajusta narrativa e apresentação; não remove evidência, limitações ou findings verificados.                                                                                               |
| `output.max_inline_comments` | Inteiro de 0 a 40, default 40, alinhado ao máximo teórico atual de cinco shards × oito findings. Limita publicações inline elegíveis, nunca a análise, persistência ou veredito. Redução futura desse teto exige decisão de produto. |
| `review.additional_excludes` | Mantém o contrato atual, somente aditivo e sujeito às proteções da plataforma.                                                                                                                                                       |
| `review.focus`               | Lista de prioridades: correctness, security, concurrency, performance, accessibility. Vazia por padrão; não desliga categorias nem obriga o modelo a encontrar problemas.                                                            |
| `review.reference_files`     | Lista ordenada de arquivos de contexto; vazia por padrão. Conteúdo é documentação/evidência contextual, não autoridade de instrução.                                                                                                 |
| `verdict.strictness`         | Preserva `default` e `block_all_confident_medium`, aplicados no host.                                                                                                                                                                |
| `instructions`               | Lista ordenada de strings não vazias ou objetos estritos `{ path: string }`; vazia por padrão. Strings aceitam blocos multilinha.                                                                                                    |
| `projects`                   | Até 20 escopos configurados, sem impedir autodetecção fora deles. `name` único, `root` explícito e normalizado; descrição opcional.                                                                                                  |
| `projects[].compatibility`   | Declara o ambiente que o mantenedor pretende suportar; nunca substitui fatos detectados. Valores são strings, inclusive versões numéricas.                                                                                           |
| `path_rules`                 | Até 50 regras; `paths` são globs relativos à raiz do repositório. Neste escopo, personalizam instruções, não idioma, permissões ou veredito.                                                                                         |

Parâmetros globais de publicação/veredito não são sobrescritos por projeto.
Uma PR deve ter um idioma e uma decisão agregada coerente. Não adicionar campos
sem um consumidor real e um teste observável; recursos aceitos no schema e
ignorados pelo runtime são defeitos.

## 4. Escopos, caminhos e precedência

### 4.1 Localização e composição

- Aceitar exatamente um dos dois arquivos existentes; ambos presentes são erro.
- Raiz de referência global e de `path_rules`: raiz do repositório, mesmo quando
  o YAML estiver em `.github/`.
- `projects[].instructions[].path`: relativo ao `root` do projeto.
- Não permitir `..` para sair do escopo. Documentos compartilhados são declarados
  no bloco global. Caminhos absolutos, URLs, backslashes e bytes nulos são inválidos.
- Não descobrir AGENTS.md ou outros arquivos de instrução implicitamente. Só
  carregar referências explícitas, uma camada, sem includes/extends recursivos.
- Usar o mesmo parser de globs e política canônica de paths em resolução, seleção
  e ferramentas. Não introduzir RegExp, minimatch e ripgrep com semânticas rivais.
- Git diferencia maiúsculas/minúsculas. Preservar path exato no inventário; não
  normalizar com regras do filesystem macOS. Revalidar as proteções existentes.

### 4.2 Associação aos projetos

Escolher para cada arquivo o `root` configurado mais profundo que seja ancestral
por segmento, não apenas prefixo textual. Um root `apps/api` não contém
`apps/api-client`. Raízes iguais são erro; raízes aninhadas são permitidas e têm
seleção determinística. `root: .` representa o escopo geral restante.

As instruções de projetos ancestrais não são herdadas implicitamente: colocar
regras compartilhadas no bloco global. Projetos detectados de diferentes
ecossistemas na mesma raiz podem compartilhar o escopo configurado; não substituir
os IDs/fatos do detector pelos nomes amigáveis do YAML.

Para arquivos renomeados, aplicar as instruções de destino às novas linhas;
conservar origem/base como contexto de migração. Para deleções, usar o path antigo.
Uma regra sem correspondência produz aviso de configuração sem impedir projetos
que ainda não têm alterações. Um root configurado inexistente no base é erro de
configuração; a pré-validação no head pode verificar um projeto novo sem torná-lo
autoridade da review atual.

### 4.3 Precedência explícita

1. Políticas e limites obrigatórios da plataforma; restrições de tenant, quando
   realmente existirem. Não implementar um serviço de tenant fictício neste escopo.
2. Configuração global validada do repositório.
3. Instruções do projeto selecionado para aquele path.
4. Todas as `path_rules` correspondentes, na ordem declarada.

Objetos estruturados recebem defaults uma vez. Listas de instruções são
concatenadas mantendo sua ordem; conjuntos, como focus/excludes, têm normalização
própria. Não usar um deep merge genérico. Textos contraditórios não têm resolução
formal confiável: o modelo deve explicitar o conflito, e nenhum texto pode relaxar
as regras do host. A UI/CLI mostra a cadeia de origem aplicada a cada path.

## 5. Contrato único e JSON Schema gerado

Criar um schema Zod **estrutural e exportável** em `packages/contracts`, com
schemas menores por responsabilidade: output, review, instruction entry,
compatibility, project e path rule. Separar a semântica que exige I/O ou regras
cruzadas; não enfiá-la no exportador nem manter JSON escrito à mão.

- Objetos fechados em todos os níveis (`additionalProperties: false`).
- Mapas como `frameworks` são extensíveis deliberadamente, com keys/values
  limitados; não são um escape para propriedades arbitrárias de configuração.
- Gerar o schema de **entrada**, não o DTO já resolvido/defaultado.
- Escolher um único dialect, inicialmente draft-07, com `$schema` do padrão,
  `$id` estável, descriptions, exemplos e defaults documentais.
- `instructions.items` usa união de tipos disjuntos string/objeto; `anyOf` gerado
  é suficiente, sem exigir um `oneOf` manual paralelo.
- Não usar `unrepresentable: "any"`, coerções, transforms ou silenciosamente
  descartar refinements no artefato exportado.
- Ranges entre campos, byte budgets, caminhos protegidos, existência e autoridade
  são validações semânticas do compilador. O editor não oferece essa garantia.
- `default` no JSON Schema é documentação; o compilador materializa o valor.
- Strings de versão sempre entre aspas. `java: 21` é inválido; `java: "21"` é válido.

Proposta de artefatos e comandos, ainda não existentes:

- `docs/contracts/holon.schema.json`: gerado e commitado.
- `docs/contracts/examples/`: exemplos mínimos, monorepo e instruções por arquivo.
- `tooling/config-cli`: `holon config validate` e `holon config explain --path ...`.
- `pnpm config:schema:generate` e `pnpm config:schema:check`: geração determinística
  e comparação byte a byte na CI.

A CLI usa o mesmo schema/parser/compilador. O modo local explicita que lê o
working tree; `--ref` usa objetos Git do SHA indicado, nunca checkout/escrita ou
scripts do projeto. O modo explain mostra fontes/digests/escopos por padrão,
sem imprimir corpos privados em logs. Validação local não depende da URL pública.

As decisões se apoiam em [Zod](https://zod.dev/json-schema),
[JSON Schema](https://json-schema.org/understanding-json-schema/reference/object)
e [annotations](https://json-schema.org/understanding-json-schema/reference/annotations),
consultados em 2026-09-09. Metadados JSON Schema de dialect não são versionamento
de APIs internas e não contradizem ADR-0036.

## 6. Publicação para editores

Servir `GET /schemas/holon.schema.json` no control-plane existente, com conteúdo
estático gerado no build; não criar outro deployable. A rota é pública e só retorna
o contrato público, sem bindings de leitura de repositórios, dados de instalação
ou autenticação do usuário. Revisar o isolamento das rotas existentes.

Usar JSON, ETag por conteúdo, cache curto/revalidável e CORS de leitura quando
necessário para clientes web. O runtime nunca busca a URL indicada pelo comentário
nem resolve `$ref` remoto fornecido pelo repositório. O schema distribuído contém
somente referências internas ao próprio documento.

O artefato deve corresponder ao **build implantado**, não simplesmente ao último
commit de main. Deploy coordenado dos consumidores precede ativação dos novos
campos; schema e parser são entregues no mesmo build. Erros indicam o contrato
atual para diagnosticar caches antigos de editor. Revalidar ETag após atualização
faz parte do smoke, sem prometer invalidação instantânea de todos os clientes.

Exemplo de modeline confirmado pela
[documentação do YAML Language Server](https://github.com/redhat-developer/yaml-language-server#associating-schemas),
consultada em 2026-09-09. Registro no SchemaStore é melhoria posterior e exige
publicação autorizada; o modeline já funciona independentemente do catálogo.

## 7. Resolver arquivos com autoridade e limites

A configuração autoritativa e todos os textos referenciados vêm do mesmo
`installationId + repositoryId + baseSha`. O head só fornece o código sob revisão.
Um PR que modifica seu YAML ou arquivo de instruções recebe revisão sob a base;
uma validação separada pode apontar erros do formato novo no head, sem aplicá-lo.

Fluxo de leitura proposto:

1. Validar as coordenadas e a autorização da instalação no serviço GitHub.
2. Obter a árvore do commit base e percorrer apenas os componentes necessários,
   usando subárvores não recursivas e cache limitado por tree SHA.
3. Comprovar ausência dos dois arquivos de configuração; só então usar defaults.
4. Validar mode de cada componente: diretório intermediário e blob regular final.
   Recusar symlink, submodule, ponteiro LFS, binário e tipos não suportados.
5. Checar tamanho declarado e ler o blob do OID comprovado, com limite real de
   bytes/decodificação UTF-8 fatal. Não confiar só em Content-Length/size declarado.
6. Validar YAML, normalizar, autorizar paths de referências e repetir a leitura
   por objetos Git para cada arquivo explicitamente referenciado.
7. Aplicar contagem/byte budget sobre tudo o que será persistido e usado.

O reader retorna resultados tipados: `found`, `absent` **provado**, `access_denied`,
`snapshot_unavailable`, `invalid_file`, `too_large` e `transient_failure`. Uma
listagem truncada não prova ausência. Um blob antes comprovado que depois não
pode ser lido é falha; não desaparece da configuração.

Paths de instrução continuam sujeitos às proteções e exclusões de conteúdo.
Configuração bootstrap tem autorização específica para seus dois paths fixos;
essa exceção não libera qualquer arquivo referenciado. Referência excluída produz
erro claro, em vez de ler conteúdo que o executor negaria. `.github` não recebe
uma exceção geral. Referências não são resolvidas por URLs do retorno remoto.

YAML: um único documento/mapping, YAML 1.2, strings/chaves corretas, sem chaves
duplicadas, tags, aliases, anchors, merge keys, diretivas que troquem o dialect,
interpolação de ambiente ou execução. Verificar limite de bytes antes do parser;
inspecionar profundidade/quantidade de nós no AST antes de `toJS`. Evitar atribuição
dinâmica em objetos com prototype; mapas de tecnologias usam armazenamento seguro
e rejeitam chaves como `__proto__`, `constructor` e `prototype`. Mensagens usam
código + localização, sem trecho de conteúdo/valor ou exceção arbitrária.

As diferenças de [Contents](https://docs.github.com/en/rest/repos/contents#get-repository-content),
[Git Trees](https://docs.github.com/en/rest/git/trees#get-a-tree) e
[404 de acesso](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#404-not-found-for-an-existing-resource)
foram verificadas em 2026-09-09. O [parser yaml](https://eemeli.org/yaml/) oferece
as APIs necessárias; configurar e testar os limites é responsabilidade do Holon.

## 8. Compilação e contratos internos

Quatro representações com responsabilidades distintas, sem sufixos de versão:

| Tipo proposto              | Papel                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `RepositoryConfigInput`    | Formato editável validado estruturalmente; sem I/O e sem defaults escondidos.                           |
| `ResolvedRepositoryConfig` | Defaults materializados, paths canônicos, instruções/referências carregadas e proveniência por entrada. |
| `RunConfigurationSnapshot` | Configuração selada para uma execução, com identidade, digests e conteúdo privado necessário.           |
| `RunConfigurationRef`      | Manifesto pequeno e estrito para steps: run, base/head, digest e referência ao artefato.                |

Não enviar o snapshot inteiro para todas as APIs. Criar projeções tipadas:
`RepositoryScopePolicy`, `ProjectCompatibilityContext`, `ShardReviewGuidance`,
`ReviewDecisionPolicy` e `ReviewOutputPreferences`. Todas levam a identidade do
snapshot de origem; cada consumidor verifica correspondência à sua run/escopo.

Organização proposta:

| Local                                       | Responsabilidade                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/contracts/src/repository-config/` | Schemas exportáveis, snapshots/projeções e diagnósticos de fronteira.                    |
| `packages/domain`                           | Associação de paths/projetos, composição determinística, precedência e restrições puras. |
| `packages/application`                      | Orquestração da compilação e ports para leitura/store, projeções por etapa.              |
| `packages/github`                           | Reader autenticado de árvores/blobs, classificação de erros e leitura limitada.          |
| `apps/control-plane`                        | Parser YAML/adaptação, steps de resolução, snapshot store no ledger e rota de schema.    |
| `apps/repository-executor`                  | Enforcement da projeção de escopo, sem parsing de YAML ou autoridade de instrução.       |
| `packages/model`                            | Injeção delimitada de guidance, orçamento e saída no idioma selecionado.                 |
| `apps/admin`                                | Valores efetivos, origem, contagens, limitações e conflitos; DTO sanitizado.             |

Se a CLI compartilhar o parser, extraí-lo para módulo/pacote sem dependência de
Workers, em vez de importar `apps/control-plane` de outra ferramenta. Não colocar
parser YAML, fetch ou filesystem no domínio. Não ampliar os arquivos gigantes de
workflow/ledger com parsing, merge, hashes e templates.

Cada campo deve ter um registro de dono, default, escopo, consumidor, efeito no
cache, limite e teste. Isso orienta evolução; não é um sistema dinâmico de plugins
ou descoberta de handlers por nome arbitrário.

## 9. Aplicação no momento certo do workflow

| Momento                     | Entrada/saída e consumo                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook/admissão            | Fixar instalação, repo, PR, base/head e ordem causal. Não confiar em YAML enviado junto ao evento.                                                             |
| `resolve-repository-config` | Comprovar fontes, validar e selar o snapshot. Retornar somente `RunConfigurationRef`; erro impede análise com defaults silenciosos.                            |
| Preparação                  | Carregar `RepositoryScopePolicy`; aplicar exclusões antes da seleção de patches. Registrar autoridade head/base + digest no executor.                          |
| Identificação               | Detectar fatos normalmente; associar `ProjectCompatibilityContext` sem inventar evidências nem sobrescrever versões.                                           |
| Planejamento                | Associar projetos/regras e calcular guidance de cada shard antes de chamar o modelo. Considerar orçamento global de contexto.                                  |
| Investigação por shard      | Receber somente guidance/referências aplicáveis, sempre com paths e proveniência. Tools usam exclusivamente a política de escopo do host.                      |
| Finalização e recovery      | Receber idioma e guidance relevantes novamente, explicitamente; não depender de memória da investigação. Schema/evidence gates permanecem obrigatórios.        |
| Agregação e revalidação     | Usar `ReviewDecisionPolicy` no host e o mesmo snapshot; conservar achados/feedback independentemente da apresentação.                                          |
| Síntese e publicação        | Usar `ReviewOutputPreferences`; aplicar cap inline depois de persistir/reconciliar todos os findings. Revalidar refs/autorização antes de cada efeito externo. |
| Feedback/CI posteriores     | Ler preferências persistidas da run/decisão à qual a publicação pertence, sem reler a configuração atual nem depender de textos já limpos.                     |
| Terminal/cleanup            | Remover corpos privados temporários e artefatos; reter metadados e preferências mínimas necessárias conforme política de retenção.                             |

Resolver fontes múltiplas com fan-out limitado e nomes determinísticos, por
índice/ID estável. Steps de obtenção podem persistir artefatos por fonte e retornar
referências; o step final sela o conjunto. Gravações condicionais tornam repetição
após falha entre fetch, persistência e checkpoint idempotente.

Cada callback reconstrói sua dependência a partir da referência/snapshot; não
configurar um objeto em um callback e presumir que mutações sobrevivam ao replay.
Um digest ausente/incompatível é erro tipado. Não preencher lacunas com configurações
atuais de env ou com defaults recompilados após um deploy.

Isso aplica as [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
consultadas em 2026-09-09. O limite documentado de resultado não-stream é
[1 MiB](https://developers.cloudflare.com/workflows/reference/limits/); o plano
usa margem própria muito menor e persistência no ledger.

## 10. Imutabilidade, identidade, hashes e cache

### 10.1 Snapshot e idempotência

Persistir os corpos privados no DO por PR já existente. A store é dona de registros
por run, não um namespace global compartilhado entre tenants. Preparação de fontes
pode ser incremental; somente um manifesto selado e completo pode ser consumido.

Transação curta: se não existe snapshot e a run está autorizada/ativa, gravar e
selar; se já existe com o mesmo digest, retornar a referência existente; se o digest
difere, rejeitar. Validar integridade na leitura. I/O de GitHub/modelo fica fora da
transação. Não introduzir R2 ou cache externo sem necessidade medida.

O cleanup deve considerar artefatos de configuração mesmo se a falha ocorrer
**antes de criar o Sandbox**. Não condicionar essa obrigação a `repositoryStarted`.
Após cleanup, persistir idioma/preferências mínimas na decisão/publicação para
feedback e enrichment; apagar instruções não pode quebrar respostas posteriores.

A semântica transacional é fundamentada na documentação de
[DO SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
consultada em 2026-09-09. A retomada após limpeza de uma execução terminal não é
suportada implicitamente; uma nova execução tem identidade própria.

### 10.2 Identidade de execução

Pré-requisito recomendado: identidade da revisão incluir **PR + head SHA + base SHA**,
derivados do evento validado. Não usar digest obtido por I/O como nome do step,
nem mudar o run ID no meio da execução. Atualizar produtores/consumidores, marcas,
ledger, admin e testes juntos, sem aliases para a identidade antiga.

Preservar deduplicação para a mesma dupla e ordem causal para eventos fora de
ordem. Mesmo head com nova base não pode retornar simplesmente duplicate nem
reutilizar snapshot anterior. Base alterada durante a análise torna a run obsoleta
antes da publicação. Uma mudança apenas na base nem sempre gera o gatilho atual:
esta entrega deve documentar reexecução por um novo evento admitido; automação
para rastrear pushes da base exige desenho separado, não uma promessa implícita.

Não acrescentar reexecução manual ilimitada ou geração aleatória neste YAML.
Caso o produto precise reprocessar a mesma dupla com outro build, definir uma
operação de reexecução explícita fora do arquivo antes de implementar esse fluxo.

### 10.3 Digests com função definida

- `sourceDigest`: bytes do YAML, para proveniência; comentário do modeline pode
  mudá-lo sem mudar a configuração efetiva.
- Manifesto de fontes: paths canônicos, blob OIDs e SHA-256 dos textos referenciados,
  com ordem/escopo dos usos. Sem URLs mutáveis.
- `configDigest`: configuração resolvida completa, defaults, textos/referências e
  semântica do compilador identificada por digest do build, sem timestamp aleatório.
- `scopeDigest`: apenas restrições que governam leitura/seleção e revisão da política
  de plataforma. Substitui o uso indiscriminado do digest global para autorização.
- Digests de guidance/análise e de publicação só onde exista consumidor/cache
  concreto. Derivar das respectivas projeções, sem duplicar valores manualmente.

Reutilizar a canonicalização existente, extraída para utilitário apropriado, com
vetores do [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785), consultado em
2026-09-09. Ordenar keys; preservar ordem de instruções/regras e texto significativo.
Não remover whitespace de código/instruções em nome de equivalência. Arrays que
são conjuntos têm normalização explícita antes da canonicalização.

Cache de detecção não deve ser invalidado só porque o idioma mudou: sua chave usa
fontes reais, scope, detector e perfil que efetivamente influenciam o resultado.
Guidance alterado invalida a análise que o consome. Preferência de publicação
invalida renderização, não fatos detectados. Todos os caches continuam isolados
por instalação/repositório e obedecem purge/revogação existente.

## 11. Idioma, identificação e limites de apresentação

### 11.1 Idioma sem mudar identidade

Usar tags [BCP 47](https://www.rfc-editor.org/rfc/rfc5646), com catálogo fechado de
locales entregues. Recomendação inicial: nomes de enums/códigos internos permanecem
estáveis; somente textos humanos são localizados. Não traduzir excerpts, paths,
SHAs, fingerprint, API names nem valores de versão.

A entrega precisa mapear texto produzido pelo modelo e pelo host: diagnóstico,
sugestão, reason da evidência, resumo, veredito explicado, limitações, ausência de
contexto, comentário de erro, resolução, feedback e CI. Usar catálogo de mensagens
com códigos/argumentos para o host. Evitar uma chamada LLM extra apenas para traduzir.

Não alterar o fingerprint primário simplesmente removendo diagnóstico e fundindo
defeitos diferentes. Antes de ativar idioma, testar mudança en→pt-BR para o mesmo
achado: preservar o matching único por evidência já existente; explicitar conflitos
quando a evidência não distingue dois achados. Nenhuma fusão ambígua, duplicação
silenciosa ou resolução por mudança de idioma. Se os testes mostrarem insuficiência,
introduzir identidade causal estruturada verificada no host como parte desta fase;
a forma dessa identidade exige uma decisão específica, não um ID livre do LLM.
Como regra de segurança proposta, ambiguidade na correspondência após mudança de
idioma mantém os findings anteriores e os candidatos pendentes, sem publicar
novos inline para o grupo ambíguo nem resolver os anteriores; a revisão informa
revalidação incompleta. Essa abstenção é preferível a inventar uma identidade.

A configuração de idioma é uma instrução ao modelo, não garantia linguística
matemática. Avaliações multilíngues e casos de recovery são o gate de qualidade;
os templates determinísticos têm cobertura completa por locale.

### 11.2 Compatibilidade declarada e evidência detectada

Manter duas coleções: fatos detectados e requisitos declarados no YAML, com
proveniência separada. Confrontar quando houver comparador confiável e relatar
`matches`, `conflicts`, `unknown` ou `not_detected`.

`java: "21"` expressa a família de runtime esperada; não prova patch instalado.
React declarado, versão resolvida em lock e alvo de compilação são dimensões
distintas. Uma divergência de configuração aparece como diagnóstico de
compatibilidade, não automaticamente como defeito bloqueante do diff. Bloqueio
continua exigindo evidência causal e a política de veredito do host.

Usar catálogo extensível em código para nomes conhecidos e gramáticas de intervalos:
[npm](https://github.com/npm/node-semver),
[Python](https://packaging.python.org/en/latest/specifications/version-specifiers/)
e [Maven](https://maven.apache.org/pom.html) têm semânticas diferentes, consultadas
em 2026-09-09. Nome desconhecido pode permanecer como declaração contextual com
comparação `unknown`, claramente visível; nunca converter arbitrariamente em
SemVer nem apresentá-lo como versão detectada. Gramática conhecida inválida produz
diagnóstico com localização. Não executar builds, instalar dependências ou
consultar registries para satisfazer esses campos.

### 11.3 Publicação limitada, resultados preservados

Aplicar `max_inline_comments` somente depois de verificação, reconciliação,
persistência e veredito sobre o conjunto completo. Ordenação determinística por
prioridade/confiança e desempate estável. Zero significa resumo/check sem novos
comentários inline, não review desabilitada. O cap vale para novos comentários de
findings da run; atualizações/resoluções de comentários existentes e respostas de
feedback continuam obedecendo seu lifecycle e não são bloqueadas por esse teto.

Findings além do cap aparecem no resumo até seu limite de bytes e integralmente
no console; incluir contagens totais, inline e não inline. Não marcar achados como
resolvidos/dismissed porque não couberam. Retry reaproveita o mesmo plano de
publicação, sem escolher outro subconjunto ou criar duplicados. Templates
`concise` não podem suprimir ressalvas de revisão incompleta.

## 12. Conteúdo privado e orçamento de instruções

As instruções são preferências do mantenedor dentro de um escopo, não código ou
permissões. Separar seções controladas da plataforma, guidance explícito e material
não confiável (diff, arquivos de referência, resultados de tools). Instruções de um
projeto não devem governar outro em um shard misto: enviar escopo por path e
preferir agrupamento por guidance sem ampliar os limites de shards/arquivos.

Para tools que leem um arquivo fora do projeto do shard, aplicar autorização de
escopo e sinalizar sua relação com o shard; não promover o arquivo lido a novo
fornecedor de instruções. Não ampliar o contexto global por leitura incidental.

Regex de termos proibidos/delimitadores não é barreira suficiente. O host mantém
least privilege, verificação de evidência, veredito e publicação condicional,
conforme as defesas em camadas da
[OWASP](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html),
consultada em 2026-09-09. Não prometer eliminar prompt injection.

Limites iniciais **propostos para calibração**, não limites do provedor:

| Recurso                                                | Teto inicial                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| YAML bruto                                             | 64 KiB                                                                         |
| Projetos / path rules                                  | 20 / 50                                                                        |
| Paths por regra / globs de exclusão                    | 20 / 50                                                                        |
| Profundidade / nós do AST                              | 12 níveis / 10.000 nós                                                         |
| Texto de uma instrução inline / descrição              | 16 KiB / 4 KiB                                                                 |
| Arquivo de instrução ou referência                     | 32 KiB                                                                         |
| Arquivos externos ao YAML explicitamente referenciados | 32 arquivos distintos                                                          |
| Entradas de instrução, somando todos os escopos        | 200                                                                            |
| YAML + conteúdo referenciado total por run             | 256 KiB antes de serializar; teto adicional de 512 KiB no artefato serializado |
| Guidance textual efetivamente aplicado por shard       | 32 KiB, incluindo instruções e referências                                     |
| Manifesto retornado por step                           | 4 KiB serializados                                                             |

Checar bytes UTF-8 e tamanho serializado real; `maxLength` do editor não equivale
a limite de bytes. O tamanho agregado não é multiplicado por duplicatas de fetch,
mas cada repetição que será enviada ao modelo conta no orçamento do prompt.

Fazer preflight conjunto de instruções + referências + patches inteiros + metadados

- prior findings + margem de tools/saída antes da primeira chamada. Limites de bytes
  não substituem o limite de tokens do modelo configurado. Usar estimador validado
  por modelo/tokenizer ou limite conservador documentado, com reserva explícita para
  finalização; jamais contar caracteres como tokens sem validação.

Não cortar instruções silenciosamente nem resumir com LLM automaticamente. Se o
conjunto obrigatório não couber, retornar erro de configuração/contexto com os
escopos responsáveis antes de gastar inferência. O planner pode reorganizar shards
dentro dos limites atuais; não omitir patches para abrir espaço às instruções sem
registrar cobertura parcial. A política existente de review parcial continua
conservadora. Limites per-shard valem para todas as regras que combinem, não só
para cada entrada isolada.

Nenhum corpo de instrução/YAML/referência vai para logs, Analytics Engine, D1 de
projeção, nomes de steps ou exceptions. Snapshot privado no ledger respeita a mesma
retenção de artefatos da run; console recebe origem/escopo/digest/contagem, não o
texto integral por padrão. Código de erro, JSON pointer e linha/coluna bastam para
corrigir configuração inválida, sem refletir valores potencialmente secretos.

## 13. Falhas e observabilidade

| Condição                                                                                           | Resultado                                                                           |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Configuração comprovadamente ausente                                                               | Defaults explícitos, origem `default` e digest persistidos.                         |
| Dois arquivos, campo desconhecido, YAML inválido, referência inexistente/proibida, limite excedido | Erro de configuração não retentável; não chamar modelo nem publicar APPROVE.        |
| Rede/5xx/rate limit                                                                                | Retry limitado seguindo metadados do GitHub e políticas atuais; sem fallback.       |
| Instalação revogada/ref inacessível                                                                | Erro de autoridade/execução, sem tratar como ausência ou reaproveitar outro tenant. |
| Snapshot já selado divergente/corrompido                                                           | Falha fechada e diagnóstico de integridade; nunca recompilar com defaults.          |
| Texto do modelo inválido / recovery necessário                                                     | Mesmos inputs e idioma; preservar abstenção e falha explícita atuais.               |
| Nova base/head durante execução                                                                    | Obsolescência + cleanup, sem publicar resultado sob autoridade antiga.              |

Emitir eventos fechados `configuration.resolved`, `configuration.rejected`,
`configuration.snapshot_reused` e `configuration.guidance_applied`. Campos:
run ID, digests, source enum, locale validado, contagens/bytes, latência, número de
leituras, cache hit e código de erro. Digests não devem virar dimensões de alta
cardinalidade em séries métricas; guardá-los no detalhe da run/log estruturado.

No console, mostrar arquivo/base de origem, idioma, projetos, número de instruções,
exclusões, compatibility declarada versus detectada e limitações. A documentação
precisa explicar que arquivo alterado no PR só passa a valer depois de entrar na base.

## 14. Plano de entrega e critérios de saída

| Fase                        | Entrega                                                                                                                           | Critério de saída                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 0 — Decisões e fixtures     | ADR proposta sobre snapshot/autoridade; fechar identidade head/base, precedência, defaults e limites; corpus do formato acordado. | Todas as opções têm consumidor e semântica; nenhuma decisão estrutural escondida em código.                                 |
| 1 — Contrato e ferramentas  | Schema modular, parser compartilhável, validação semântica, geração JSON Schema e CLI offline.                                    | Paridade estrutural Zod/JSON Schema; exemplos e diagnósticos verificados; JSON gerado sem drift.                            |
| 2 — Leitura e autoridade    | Port obrigatório de árvores/blobs, prova de ausência, paths seguros, fontes no base e identidade correta.                         | Regressões de 404 privado, symlink, base alterada, falta de método e conteúdo inválido.                                     |
| 3 — Snapshot e integração   | Store/manifesto, projeções tipadas e propagação preparação→identificação→shards→publicação.                                       | Replay/eviction sem releitura mutável; campos e digests chegam ao consumidor correto.                                       |
| 4 — Comportamento           | Idioma completo, guidance/referências, compatibilidade contextual e cap inline.                                                   | Resultados de domínio independentes da apresentação; identidade/feedback preservados; nenhuma configuração aceita ignorada. |
| 5 — Distribuição e operação | Rota pública estática, exemplos, docs, console e CI; preparar rollout coordenado.                                                 | Schema e runtime do mesmo build; contrato atual validado offline e no editor.                                               |
| 6 — Validação autorizada    | Deploy coordenado e smoke em repositório sintético, com casos monorepo/idioma/retry.                                              | Evidência de aplicação por etapa, custos medidos e cleanup; sem extrapolar prova local para produção.                       |

Fases são unidades de implementação/commits, não formatos públicos paralelos.
Enquanto um campo não tiver implementação completa, não anunciá-lo no schema
público. Dependências: fase 0→1→2→3→4→5→6. Preparação de templates e corpus pode
ocorrer em paralelo lógico, sem ativar código incompleto.

Não prescrever prazo antes de dimensionar identidade/base, localization e
orçamento de contexto. São as maiores mudanças, não a escrita do JSON.

### Testes que precisam provar comportamento

- Schema: propriedades desconhecidas, objeto de instrução misto/inválido, strings
  numéricas, `null`, YAML vazio versus `{}`, chaves duplicadas, multi-documentos,
  tags/aliases, Unicode e limites exatos. JSON Schema aprova somente o estrutural;
  casos semânticos têm oráculos separados e explícitos.
- Paths: escopo global/projeto, root aninhado, prefixo semelhante, case, rename,
  deleção, traversal, symlink intermediário/final, submodule, LFS, ausência provada,
  tree truncada e blob indisponível após enumeração.
- Composição: preservação da ordem, regras simultâneas, nenhum vazamento entre
  projetos, defaults idênticos para arquivo ausente e `{}` no efeito semântico.
- Hashes: comentários mudam sourceDigest, mas não configDigest; instrução externa
  alterada muda o digest efetivo; key order não muda; ordem de instruções muda.
- Durabilidade: crash após persistir e antes de concluir step; replay com env/default
  alterado; eviction; dois saves concorrentes iguais/divergentes; tentativa de
  trocar run/base/tenant; cleanup antes de Sandbox e depois de falha de publicação.
- Etapas: capturar argumentos reais de preparação, identificação, investigação,
  finalização, recovery, síntese, agregação e publicação. Verificar consumo, não
  só a presença de propriedades nos mocks.
- Idioma: templates de todos os locales; evidência byte a byte preservada; mesmo
  defeito em idiomas distintos, evidência ambígua e feedback posterior ao cleanup.
- Apresentação: cap 0/1/máximo, ordem estável, retry depois de publicação parcial;
  veredito e findings persistidos não mudam quando só detail/cap mudam.
- Contexto: instruções longas globais/projeto/regras simultâneas; limites em UTF-8,
  cinco shards/50 arquivos; reprodução de 47/47 não perde arquivos por concatenação.
- Segurança: instruções pedem ignorar evidência, ler secrets, executar shell ou
  alterar saída; host continua impedindo efeitos. Não confiar só em snapshot test
  de prompt ou no fato de o modelo ter obedecido em um exemplo.
- Editor: gerar uma vez, validar meta-schema e exemplos com validador independente;
  testar completion/hover/diagnóstico no YAML Language Server e smoke VS Code.
  Servir bytes do build, ETag/304 e método inválido sem acionar webhook/segredos.

Usar Vitest puro para políticas/compilação e o plugin oficial de Workers para
ledger/workflow, incluindo [APIs de teste de Workflows](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
verificadas em 2026-09-09. Teste focado falhando antes de cada correção de
comportamento. Cobertura existente não será reduzida. Gates focados primeiro;
`pnpm verify` completo na CI/ambiente apropriado, sem iniciar suites grandes no HD
local por rotina. Avaliação live de modelo/deploy exige autorização específica.

## 15. Evolução e operação

Evoluir adicionando propriedades tipadas em seções com responsabilidade definida;
rejeitar typos desde o início. Não adicionar `extras`, `any`, plugins remotos,
`extends`, shell, env interpolation ou um DSL de regras arbitrárias para antecipar
necessidades ainda inexistentes. Campos novos exigem atualização dos consumidores
e um caso de ponta a ponta no mesmo conjunto de alterações.

Defaults são materializados no snapshot. Mudança de default ou semântica muda o
digest do compilador/configuração, não uma tag de payload que mantenha parsers
antigos. O JSON Schema é artefato derivado: CI regenera e falha em drift.

Atualizar na implementação: contratos, arquitetura de runtime/segurança/dados,
operação de identificação/deploy, docs de configuração/editor e ADR específica.
Preservar ADRs históricas; tornar explícita a substituição de decisões afetadas.

Antes de deploy autorizado: drenar runs antigas e confirmar cleanup, atualizar
componentes juntos e conferir o schema servido. Mudanças de identidade e persistência
podem exigir reset de estado de desenvolvimento autorizado; não realizar resets
ou migrações remotas como efeito colateral da geração do schema. Validação inicial
usa novas runs sintéticas e mede custo de leitura/tokens/armazenamento.

Decisões da fase 0 aceitas na [ADR-0037](../decisions/0037-compile-repository-configuration-per-run.md):
idiomas `en`, `pt-BR`, `es`; defaults `en`, `concise`, cap 40 (0–40); limites da
tabela; identidade PR/head/base; schema servido pelo host efetivo do control-plane.
Nenhum desses itens autoriza deploy.

## 16. Implementação e evidências locais — 2026-09-09

O plano foi aprovado para implementação integral. As fases 0–5 estão implementadas
no checkout `codex/repository-configuration`; a fase 6 depende de autorização
específica. O [guia operacional](../operations/repository-configuration.md)
descreve configuração, CLI, editores e rollout.

| Entrega                  | Implementação e prova focada                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrada única e schema   | `repository-config/input.ts`, parser restrito e geração draft-07; paridade Ajv/Zod e exemplos válidos                                                            |
| Fontes e autoridade      | Leitor commit/árvore/blob no base SHA; transporte streaming limitado, symlinks intermediários/finais, LFS, UTF-8, 404 e Retry-After                              |
| Snapshot e identidade    | Store SQLite em chunks, PR/head/base; replay após perda de resposta/eviction sem reader, concorrência e rejeição de substituição                                 |
| Guidance e identificação | Precedência global/projeto/regras, referências separadas e compatibilidade SemVer/PEP 440/famílias Java; estouro em shard posterior antes de qualquer inferência |
| Idioma e apresentação    | Três idiomas em investigação/finalização/recovery/síntese e mensagens host; cap zero/um preserva veredito e resultados; feedback conserva rigor após eviction    |
| Retenção                 | Cleanup antes do Sandbox remove instruções privadas; diagnóstico, sugestão e evidência dos findings permanecem no histórico autenticado, inclusive cap zero      |
| Distribuição e console   | GET/HEAD/ETag/304/405 e CORS; configuração, escopos, estados de comparação e digests no console; inspeção visual ampla/estreita sem overflow                     |

Cobertura focada dos módulos novos, sem reduzir thresholds: compilador/projeções
97,42% de linhas e 88,42% de branches; leitor Git/stream 99,12% e 97,34%; módulos
Workers de configuração/schema/contexto 97,26% e 86,04%. Esses números são um
snapshot local dos conjuntos focados, não cobertura global do monorepo.

Também passaram os testes focados dos consumidores afetados, o build do console
e o dry-run do control-plane. O editor foi validado com a implementação real de
YAML Language Server (completion, hover e diagnósticos). O smoke visual do VS Code
foi tentado, mas o controle nativo foi negado por falta de permissão; permanece
como verificação manual. Não foi executado `pnpm verify` completo, build Docker,
deploy, reset ou inferência live nesta entrega. O gate completo continua no CI.

### Verificação local repetida em 2026-09-10

Após atualizar a branch sobre a `main`, foram conferidos os artefatos gerados e
concluídos o build do admin e o dry-run do control-plane. A implementação e a
documentação estão separadas em commits no worktree permanente do projeto.

A seleção de regressões dos consumidores alterados totalizou **907 testes em
64 arquivos**, incluindo 168 testes do control-plane com o plugin oficial de
Workers, os testes do executor/console e o YAML Language Server real. A expectativa
do marcador de publicação foi atualizada para exigir o base SHA codificado,
conforme a identidade PR/head/base. Os testes e a cobertura focada dos módulos
novos passaram sem reduzir os thresholds. Também passaram lint, formatação,
typecheck dos 16 pacotes e verificação de drift do schema/identidade do compilador.

O gate completo `pnpm verify` e o build Docker ficam para o CI. O smoke manual do
VS Code, o deploy e a validação live continuam pendentes; a execução local não
validou credenciais nem recursos remotos.
