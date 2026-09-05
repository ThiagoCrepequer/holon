---
id: PLAN-PROJECT-VERSION-IDENTIFICATION
kind: planning
status: proposed
owners:
  - core-team
last-reviewed: 2026-09-04
related:
  - ../architecture/technical-ecosystem.md
  - ../architecture/review-runtime-flow.md
  - ../architecture/data-lifecycle.md
  - ../decisions/0018-adopt-two-phase-decoupled-review-generator.md
  - ../decisions/0028-adopt-declarative-repository-policy.md
---

# Identificação de tecnologias e versões por projeto

## 1. Objetivo e estado

Implementar uma etapa reutilizável que identifica linguagens, compiladores,
runtimes, frameworks e bibliotecas a partir de metadados de um snapshot Git.
Combinar descoberta e evidências determinísticas com interpretação assistida
por IA, executada somente quando não houver resultado reutilizável em cache.
Suportar vários projetos, ecossistemas e versões no mesmo repositório.

Este documento é um plano completo de entrega, não uma ADR aceita nem uma
declaração de implementação. Inspeção local: `d8e175a`, em 2026-09-04. O plano
não altera a política atual por conta própria. A implementação deve formalizar
as mudanças de confiança, RPC e persistência antes de ativá-las.

Fora de escopo: consulta documental, crawling, embeddings, perfis de review,
painel, onboarding, edição de configurações do usuário, execução de builds,
resolução remota de dependências e identificação do ambiente implantado.

## 2. Estado verificado e pontos de integração

| Local atual                                                                                 | Consequência para a implementação                                                                           |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/control-plane/src/review-workflow.ts`: `prepare-repository` antes de `analyze-review` | Inserir checkpoints de identificação entre eles                                                             |
| `apps/control-plane/src/review-services.ts`: preparação, RPC e recuperação do contexto      | Compor fonte de metadados com a mesma autoridade e recuperação do Sandbox                                   |
| `packages/contracts/src/executor.ts`: envelopes versionados                                 | Adicionar RPC específico e schemas, sem enfraquecer V1/V2/V3 existentes                                     |
| `packages/repository-analysis/src/review-path-policy.ts`: lockfiles excluídos               | Criar capacidade de leitura de metadados explicitamente separada; não liberar lockfiles nas tools de review |
| `packages/model/src/ai-sdk.ts`: AI SDK e Gateway existentes                                 | Reutilizar transporte, redaction e classificação de falhas; não criar outro cliente HTTP ad hoc             |
| `apps/control-plane/wrangler.jsonc`: ledger DO por PR, sem cache de projeto                 | Adicionar armazenamento por repositório; não reutilizar ledger de PR nem D1 analítico do admin              |
| `vitest.config.ts` e configuração Workers                                                   | Preservar 85% branches e 90% functions/lines/statements                                                     |

Não foi encontrado tratamento específico de desinstalação/remoção de acesso
na busca pelos handlers atuais. A retenção e a deleção do novo cache precisam
incluir essa integração, sem presumir que ela já existe.

## 3. Fronteira do package e dependências

Criar `packages/project-identification`, exportado como
`@holon/project-identification`, ESM e compatível com Workers. Sua API pública
recebe snapshot, escopo de projetos e dependências injetadas; não exige PR,
GitHub, bindings, painel ou Sandbox. Isso permite o onboarding futuro chamar
o mesmo caso de uso com outra origem autorizada de arquivos.

Responsabilidades:

- inventário e seleção de fontes suportadas;
- grafo de projetos e configurações compartilhadas;
- parsing seguro, evidências estruturadas e fingerprints;
- coordenação de identificação por projeto através de portas;
- validação semântica limitada, conflitos, agregação e budgets.

Distribuição proposta:

| Área                                  | Responsabilidade                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `domain`                              | Tipos puros de snapshot, projeto, tecnologia, evidência e estado                           |
| `contracts/project-identification.ts` | Schemas estritos de RPC, modelo, cache e resultado                                         |
| `application`                         | Portas `ProjectMetadataSource`, `ProjectIdentificationModel`, `ProjectIdentificationCache` |
| `project-identification`              | Caso de uso e políticas; depende de application/contracts/domain                           |
| `model/project-identification.ts`     | Adapter do modelo, prompt versionado e output estruturado                                  |
| `repository-executor`                 | Adapter de leitura do checkout exato e extração; usa o novo package                        |
| `control-plane`                       | Composição, adapter de cache, checkpoints, ledger e telemetria                             |
| `evaluation` e `test-kit`             | Corpus sintético, oráculos, fakes e avaliação do modelo                                    |

O package não importa `model`, apps, Cloudflare SDK ou APIs de Node. Nenhuma
dependência circular é permitida. Atualizar exports, manifests, tarefas,
tsconfigs e documentação do grafo. Submódulos sugeridos: `discovery`,
`projects`, `sources`, `fingerprint`, `validation`, `identify`; evitar uma
classe central que acumule parsing, I/O, modelo e persistência.

## 4. Contratos e significado dos resultados

`ProjectIdentificationResultV1` contém `schemaVersion`, `snapshotSha`,
`inventoryDigest`, `detectorRevision`, `projects`, `limitations` e cobertura
da descoberta. A identidade do repositório vem do host autorizado, não do LLM.

Cada projeto possui root relativo normalizado, identidade por root/ecossistema,
manifests, relações explícitas, fingerprint, estado e tecnologias. O mesmo root
pode conter Java e Node sem um sobrescrever o outro. Nome de package não é ID
global nem chave de autorização. Rename cria nova identidade nesta entrega.

Cada tecnologia possui identidade canônica de ecossistema/package/coordenada,
categoria (`language`, `compiler`, `runtime`, `framework`, `library`,
`package-manager`), declarações e evidências. Não usar um único campo `version`
para esconder diferenças. Cada declaração registra:

- valor original e valor normalizado, quando a normalização for demonstrável;
- significado: `declared-exact`, `declared-range`, `locked`, `configured-target`,
  `configured-runtime`, `conditional` ou `unknown`;
- condições de plataforma/profile, fonte e cadeia de derivação local;
- nível de suporte: extraído, relação verificada ou interpretação não confirmada.

`unknown`, `conflict`, `unsupported`, `excluded`, `truncated` e `unavailable`
são distintos. `complete` significa completar o escopo suportado e autorizado,
não conhecer toda versão ou provar o runtime de produção. Não atribuir
percentual de confiança subjetivo como substituto de evidência.

Evidências apontam para IDs de fatos extraídos pelo host, caminho, blob/hash e
seletor/campo ou intervalo. O modelo seleciona IDs; não inventa trechos como
prova. O host confirma existência, valor, módulo e relação suportada. Quando
não consegue verificar uma interpretação, preserva-a como não confirmada,
sem promovê-la a versão resolvida. Caches contêm metadados tipados e seletores,
nunca manifests integrais, comentários livres ou resposta bruta do modelo.

## 5. Descoberta e monorepos

1. Inventariar arquivos tracked no SHA autorizado usando operações Git fixas
   e limitadas no executor, com parsing NUL-safe. Nunca executar comandos
   fornecidos pelo LLM, scripts, package managers ou arquivos de configuração.
2. Reconhecer raízes por manifests e relações de workspace suportadas. Resolver
   referências apenas dentro do checkout autorizado, com detecção de ciclos.
3. Distinguir agregador de aplicação. Root Maven agregador ou root de workspace
   não impõe automaticamente todas as dependências aos filhos.
4. Mapear arquivos alterados ao projeto proprietário mais específico. Grafo
   explícito de workspace prevalece sobre mera proximidade de diretório.
   Projetos independentes fora de workspaces também são descobertos.
5. Alteração em configuração compartilhada seleciona os projetos dependentes;
   arquivo sem proprietário recebe estado explícito. Ambiguidades não são
   resolvidas escolhendo silenciosamente o primeiro manifest.
6. Inventariar head em toda run habilitada; identificar os projetos afetados e
   seus ancestrais/configurações. Expor também modo `all-projects` no package
   para onboarding, sem implementar painel agora.
7. Consultar base por SHA quando metadados forem adicionados, removidos,
   renomeados ou alterados, incluindo alterações compartilhadas. Reutilizar
   acesso Git autorizado a objetos exatos; não usar checkout mutável da branch.
   Não havendo base disponível, registrar lacuna em vez de usar head como base.

Submodules e conteúdo Git LFS não materializado ficam explicitamente fora da
cobertura inicial. Exemplos e fixtures não podem ser confundidos com apps de
produção: registrar papel desconhecido quando não houver relação verificável;
não usar uma heurística de nome de pasta como regra absoluta de exclusão.

## 6. Matriz de suporte da primeira entrega

| Ecossistema | Fontes suportadas                                                                                                                                                                                     | Semântica e limites                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JS/TS       | package.json; workspaces npm/Yarn; pnpm-workspace.yaml e catalogs; package-lock/npm-shrinkwrap; pnpm-lock; Yarn classic/Berry; tsconfig local; .nvmrc/.node-version e campos engines/devEngines/Volta | Faixa separada de lock; importer correto por workspace; aliases, peers, overrides e workspace protocol; target ECMAScript separado do compilador TS e Node          |
| Maven       | pom.xml, modules, parent local, properties e dependencyManagement/BOM declarado; configuração de compiler/release/toolchain presente no repo                                                          | Spring Boot não equivale à versão Spring Framework; plataforma Quarkus não determina cada extensão; profiles externos e parent/BOM remoto permanecem não resolvidos |
| Gradle      | settings/build .gradle/.gradle.kts, gradle.properties, libs.versions.toml, dependency locks e toolchains literais                                                                                     | Ler como dados/texto; nunca avaliar Groovy/Kotlin; builds inclusos, convenções/plugins dinâmicos e expressões arbitrárias podem ficar parciais                      |
| Python      | pyproject.toml, uv/Poetry locks, requirements e constraints locais, .python-version, workspaces uv                                                                                                    | requires-python é faixa; markers e grupos podem selecionar versões distintas; setup.py nunca é executado                                                            |

Bibliotecas de identificação inicial: React, Next, Tailwind, TypeScript, Spring
Boot, Spring Framework, Quarkus, Django, Flask e FastAPI, além de identidades
de dependências declaradas relevantes. A tabela de aliases/coordenadas é
versionada; não contém orientações de review. Tecnologia não catalogada pode
ser preservada como package, sem o LLM inventar uma identidade oficial.

Formatos/versionamentos de lock não cobertos por fixtures, inclusive lock
binário, retornam `unsupported-format`, conservando a declaração do manifest.
Não afirmar suporte genérico a todo lockfile. Versionar explicitamente a matriz
de formatos reconhecidos ao implementar. Outros ecossistemas ficam detectáveis
como não suportados até ganharem fontes, semântica e fixtures próprias.

JSON/JSONC, YAML, TOML e XML precisam de parsers mantidos e compatíveis com o
runtime. Reutilizar YAML já adotado; pesquisar/pinar as demais dependências e
registrar licença, manutenção e limites antes de adicioná-las. Não escrever
regex genérica para XML/TOML nem resolvedor completo de Maven/Gradle.
Configurações executáveis recebem apenas extração literal limitada e estado
parcial. XML sem DTD/entidades externas; YAML sem expansão de aliases/tags;
rejeitar ambiguidades de chaves e limitar profundidade e tamanho.

## 7. Identificação assistida por IA

Chamada dedicada em miss de cache, independente do loop de review da ADR-0018.
O package não conhece provider. Adapter usa o transporte existente do Gateway,
saída estruturada do AI SDK e modelo configurável; não selecionar um modelo
novo sem avaliação comparativa de qualidade/custo.

O host monta fatos estruturados e, somente quando necessário, trechos limitados
de configuração permitida. Excluir scripts, URLs de registries, credenciais,
comentários e campos irrelevantes quando houver parsing seguro. Redaction antes
da chamada. Configuração é dado não confiável em mensagem de dados, nunca
interpolação em system prompt. Prompt exige abstenção e não consulta internet.

O modelo pode pedir um segundo lote através de IDs de candidatos descobertos
pelo host (parent/catalog/config local); não aceita URL ou path arbitrário.
Persistir no fingerprint a união de todas as fontes que influíram na resposta,
inclusive resultados de descoberta negativos. Não salvar resultado produzido
com contexto ampliado sob a chave anterior à ampliação.

Validar schema, IDs, escopo e afirmações. Uma correção estruturada no máximo
quando necessária, dentro do orçamento total. Retentativa de transporte e
correção semântica compartilham um contador durável; retries de Workflow não
reiniciam o orçamento. Prompts, resultados brutos e erros arbitrários não vão
para logs/Gateway logs. Conservar identificação determinística parcial em falha
do modelo; ela não deve ser rotulada como uma identificação completa da IA.

## 8. Fingerprints e invalidação

Duas camadas evitam invalidar todo monorepo por uma alteração independente:

- inventário: nomes, tipos, presença/ausência e relações de fontes candidatas;
- projeto: fontes locais e fechamento de configurações herdadas/compartilhadas.

Hash SHA-256 sobre serialização canônica com versão, caminhos ordenados, hashes
dos conteúdos, relações, fontes ausentes, estado de completude e política
efetiva de leitura. Incluir revisão do detector, parsers, prompt/schema e perfil
de modelo; uma revisão explícita invalida aliases dinâmicos de modelo quando
necessário. SHA do commit é proveniência, não parte obrigatória da chave de
conteúdo: commits com entradas idênticas compartilham resultado.

Inicialmente usar hash bruto das fontes relevantes; mudar comentário pode
invalidar, por segurança. Em locks compartilhados, priorizar correção: todos os
dependentes invalidam até uma projeção por importer, versionada e testada,
demonstrar que inclui overrides, peers e demais fatores relevantes. Não
implementar hash semântico incompleto para ganhar hits artificiais.

Uma nova fonte candidata ou alteração de relação força recomposição do
fechamento. Mudança de exclusão força nova autorização mesmo que o conteúdo
não mude. Nunca reutilizar entradas com outro installation/repository ID.
Revalidar schema e identidade ao ler storage; resultado corrompido é miss
controlado. Snapshot da run é anexado ao usar o resultado, sem mudar sua origem.

## 9. Cache, concorrência e retenção

Proposta: `ProjectIdentificationCacheObject`, SQLite DO por
`installationId/repositoryId`, no control plane. É um novo namespace, separado
do ledger por PR. Mantém entradas por projeto/fingerprint e leases de inferência.
Não requer novo deployable, R2, Vectorize, D1 admin ou cache global em memória.

Porta do cache: consultar, adquirir lease, registrar tentativa, concluir com
fencing token, liberar falha, invalidar e limpar. Transações curtas persistem
lease/estado; chamada de modelo ocorre fora do DO e fora da transação. Leases
por fingerprint permitem projetos diferentes progredirem sem serializar LLMs.

Concorrente recebe `pending` com prazo e espera via checkpoint/sleep durável,
com deadline. Lease expirado pode ser retomado com novo token monotônico;
conclusão atrasada não sobrescreve geração nova. Não usar `blockConcurrencyWhile`
ao redor de rede nem promessas em memória como dedupe durável. Uma interrupção
após resposta do provider mas antes de persistência pode repetir custo: não
prometer inferência exactly-once sem contrato idempotente do provider.

Parâmetros iniciais propostos, a calibrar no corpus:

| Limite                                        | Valor inicial                                               |
| --------------------------------------------- | ----------------------------------------------------------- |
| Inventário de candidatos                      | 2.000 entradas, 1 MiB de metadados                          |
| Projetos processados por run                  | 20, seleção estável afetados-primeiro                       |
| Manifest/config por arquivo                   | 64 KiB                                                      |
| Lock por arquivo                              | 2 MiB, parser limitado, não enviado integralmente ao modelo |
| Bytes totais lidos para identificação por run | 16 MiB                                                      |
| Contexto por projeto para IA                  | 48 KiB e 12.000 tokens, vale o menor                        |
| Saída por chamada                             | 4.000 tokens                                                |
| Chamadas por projeto em miss                  | 2 no total, incluindo retries e reparo                      |
| Chamadas por run                              | 8; concorrência máxima 2                                    |
| Deadline da etapa / timeout por chamada       | 120 s / 30 s                                                |
| Lease                                         | 90 s; fencing obrigatório                                   |
| Cache positivo/parcial estável                | 90 dias desde último uso autorizado                         |
| Falha transitória                             | cooldown 5 min; nunca cache negativo permanente             |
| Limite de cache por repositório               | 1.000 entradas ou 16 MiB; remover não usadas primeiro       |

Budgets são políticas versionadas do host; o repositório/LLM não os aumenta.
Excesso resulta em resultado parcial com contagens e motivo. O prazo de 90 dias
é retenção proposta, não validade semântica eterna. Falhas de formato estáveis
podem ser reutilizadas até mudar conteúdo/detector; timeouts e falhas externas
devem permitir nova tentativa após cooldown.

Alarm limpa lotes expirados e leases, com processamento idempotente. Remoção de
acesso ao repo e desinstalação devem disparar purge autenticado e impedir gravação
por leases antigos (geração de autorização/revogação). Planejar índice durável
por instalação dos DOs tocados para enumerar purge; não depender de listar todos
os DOs da conta. A integração de eventos de instalação, geração de autorização
e retries de purge é parte da entrega de persistência, não um TODO do onboarding.
Retenção de checkpoints e metadados copiados ao ledger deve ser documentada
separadamente: purge do cache não apaga automaticamente esses registros.

## 10. Workflow, RPC e comportamento de falha

Adicionar métodos RPC versionados `discoverProjectMetadataV1` e
`readProjectMetadataV1`, com run/repo/installation/SHA e digest de política
validados contra a sessão. O segundo só aceita IDs descobertos autorizados.
Cabe ao executor revalidar paths, SHA e limites; não confiar no filtro do caller.
Executor antigo retorna capability indisponível, sem fallback para shell,
Contents API irrestrita ou tools que ignorem exclusões.

Sequência proposta entre preparação e análise:

1. `discover-project-metadata-v1`: garante contexto ou repara Sandbox perdido;
   retorna inventário compacto/fingerprints, nunca conteúdo bruto em checkpoint.
2. `identify-project-v1-N`: cache/lease, coleta efêmera no miss, modelo, validação
   e persistência. Ordem de N derivada de plano de projetos estável persistido.
3. `record-project-identification-v1`: associa resultados/snapshots e limitações
   à run; devolve resumo tipado limitado à análise.
4. `analyze-review`: recebe apenas metadados validados dos projetos do shard,
   em seção de dados; regras de review/evidência/veredito permanecem autoritativas.

Leitura efêmera ocorre dentro da operação que consome os bytes. Retentativas
reconstroem contexto do SHA exato; não dependem de closures preenchidas em
checkpoints anteriores. Registrar IDs/digests e metadados mínimos nos steps,
respeitando retenção do Workflow. Resultado associado à run precisa permitir
auditoria mesmo se o cache expirar, com política explícita de retenção no ledger.

Ausência de tecnologia, formato não suportado ou falha do modelo/cache permite
review existente com `identification unavailable/partial`. Nunca usar versão
antiga incompatível para esconder miss. Violação de autoridade, política ou
isolamento conserva o comportamento fail-closed do core; não capturar todas as
exceções como degradação opcional. Obsolescência e cleanup continuam válidos em
qualquer novo checkpoint. Cancelamento libera lease quando possível; expiração
recupera o caso de interrupção abrupta, sem depender de `finally`.

## 11. Segurança, dados e observabilidade

Criar ADR para a capacidade de metadados: exceção estrita à exclusão de locks,
não aos bloqueios de segredos, additional_excludes, symlinks, path traversal,
binários e autoridade. Uma configuração excluída gera lacuna e invalida cache.
Regras do repo continuam ancoradas na base; manifests da head descrevem o código
proposto e não alteram autoridade. O modelo não altera exclusões ou capacidades.

RPC não exporta registries/tokens/URLs privadas. Paths e nomes de módulos podem
ser sensíveis: persistir só no storage privado autorizado, não na telemetria.
Não registrar prompt, conteúdo, saída bruta, header ou mensagem livre de erro.
Métricas: hit/miss/pending, motivo de invalidação, projetos contados, completude,
tokens/custo por propósito, duração, abstenção e rejeições de evidência. Evitar
labels com SHA, fingerprint e caminho em Analytics Engine; auditoria detalhada
fica na run. Atualizar contratos de usage para distinguir identificação das
fases investigação/finalização e agregar custo sem duplicar retries.

## 12. Testes e avaliação

Manter thresholds atuais e inclusão de todos os arquivos de produção. O novo
package deve ter gate próprio com os mesmos valores; não depender da cobertura
global para mascarar código novo sem teste. Não reduzir thresholds nem adicionar
exclusões para passar. Testes de políticas puros; adapters e DO no plugin oficial
`@cloudflare/vitest-plugin` já adotado pelo repositório.

| Camada           | Casos obrigatórios                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Descoberta       | dois apps com React diferente; Java + Node no mesmo root; monorepo misto; agregador sem app; projetos fora de workspace; rename/delete; arquivo órfão; source adicionada                           |
| Herança          | parent Maven local transitivo e ciclo; catálogo pnpm alterado; lock importer; workspace uv; conflito entre configs; condição de profile/marker                                                     |
| Semântica        | range não vira exact; TS target não vira Node; compiler release não vira runtime; Spring Boot não vira Spring Framework; BOM remoto não resolvido                                                  |
| Parsers          | entradas malformadas, duplicate keys, entidades XML, YAML expansion, arquivo grande, formato lock desconhecido, scripts Gradle/Python não executados                                               |
| Evidência/modelo | versão inventada, ID inexistente, evidência de outro módulo, injection, JSON inválido, reparo esgotado, timeout, resposta condicional                                                              |
| Cache            | hit evita chamada; source/catálogo/política/detector/modelo mudam chave; ausência vira presença; cache corrompido; base/head distintos; branches iguais compartilham; isolamento entre instalações |
| Concorrência     | duas runs mesmo fingerprint; timeout do dono; fencing rejeita conclusão tardia; projeto B progride enquanto A espera; replay não reinicia budget                                                   |
| Retenção         | expiração, limite de storage, alarm repetido, purge/revogação durante inferência, falha e retomada de purge                                                                                        |
| Workflow         | disabled, cold/warm, contexto perdido, executor antigo, modelo indisponível, supersession em cada checkpoint, cleanup e publicação sem regressão                                                   |

Usar oráculos escritos independentemente, não outputs esperados gerados pelo
mesmo parser/modelo. Fixtures sintéticas/públicas com licença e SHA de origem.
Corpus mínimo proposto: 40 cenários de identificação, distribuídos entre os
quatro ecossistemas e monorepos mistos, incluindo casos negativos. Separar
desenvolvimento e holdout antes de ajustar prompts.

Avaliação live usa o adapter real com fakes de fonte/cache e corpus público;
não aciona GitHub nem publica. Medir precisão por declaração e categoria,
versões indevidamente exatas, cobertura/abstenção, vínculo ao módulo, tokens e
latência cold/warm. Gate proposto: zero promoção falsa a exact nos casos
críticos, precisão de afirmações verificáveis >= 98% e recall >= 90% das
afirmações identificáveis no escopo suportado, com denominadores e repetições
explícitos. Pequeno corpus não prova generalização. Fake passando não comprova
qualidade do modelo; live é manual e requer orçamento/autorização operacional.

Executar testes focados e cobertura dos workspaces alterados a cada lote.
Antes de merge, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
`pnpm test:coverage` e `pnpm build` (equivalentes a `pnpm verify`) precisam de
evidência local ou CI. Não disparar repetidamente a suíte completa no HD local;
usar CI para o gate abrangente quando apropriado. Build exige Docker e não é
deploy. Testes focados de regressão devem falhar antes de cada fix comportamental.

## 13. Lotes de implementação e critérios de conclusão

| Ordem | Entrega                                                           | Critério de saída                                                                                  |
| ----- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1     | ADR proposta para capacidade, cache e dados; contratos e fixtures | Semântica de versão, autoridade e suporte explícitos; schemas negativos testados                   |
| 2     | Package, parsers, inventário e grafo                              | Monorepos mistos e fontes compartilhadas corretos sem rede/modelo                                  |
| 3     | RPC de metadados e recuperação do contexto                        | Leitura por SHA, política, limites e isolamento provados no executor                               |
| 4     | Adapter IA e verificador                                          | Saída estrita, evidência por ID, budgets e falhas testados; eval manual disponível                 |
| 5     | Cache DO e lifecycle                                              | Fencing/replay/retention/purge passam em Workerd; nenhuma promessa de exactly-once                 |
| 6     | Checkpoints e integração da análise                               | Warm cache sem IA; base/head e shard recebem identificação correta; falha opcional não quebra core |
| 7     | Telemetria, docs, avaliação e rollout                             | Gates completos, métricas e runbook; habilitação controlada com evidência live                     |

Lotes são commits/PRs coesos conforme dependência, não ativação parcial de
segurança. Aceitar a nova ADR antes da ativação; não reescrever ADR-0018/0028
silenciosamente. Nenhum lote cria serviço de documentação ou UI.

## 14. Rollout, operação e reutilização futura

Flag tipada do host `PROJECT_IDENTIFICATION_ENABLED=false` inicialmente; modo
`observe` identifica/registra sem enriquecer prompt, depois `enrich` após eval.
Seleção inicial de repositórios é configuração do operador, não do conteúdo
do PR. Configurar modelo/deadline/budgets por perfil versionado do host.

Deploy ordenado: executor com RPC novo, control plane com namespace/migration
e flag desligada, smoke sintético, observe e só então enrich. Verificar tipos
gerados de bindings; não atualizar indiscriminadamente SDKs ou compatibility
date. Provider ainda é o já contratado pelo Gateway; novas credenciais não são
pressupostas. Recursos remotos e chamadas live exigem autorização explícita.

Rollback desliga a etapa e preserva compatibilidade dos checkpoints de runs em
andamento; mudanças incompatíveis exigem versionamento do Workflow ou drain.
Não apagar migration/namespace como mecanismo de rollback. Retenção/purge
continuam operando com a feature desligada. Runbook inclui invalidação por
detector, purge por repositório/instalação, diagnóstico sem conteúdo e limites.

Atualizar na implementação: índices de ADRs/contratos, technical-ecosystem,
review-runtime-flow, security-and-trust-boundaries, data-lifecycle, local
development, deployment e evaluations. Na conclusão deste planejamento só o
plano e links de navegação são alterados.

Onboarding futuro reutiliza `all-projects`, resultado e refresh. Valores
confirmados pelo usuário serão outra entidade, não mutação do resultado
detectado. Cache continua subordinado à evidência do snapshot e à autorização.
Nenhum endpoint administrativo público de escrita é criado nesta entrega.

## 15. Fontes e decisões ainda sujeitas a validação

Fontes primárias consultadas em **2026-09-04**:

- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) e [regras de Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/): efeitos/checkpoints, limites e replay; aplicar ao adapter, não ao package puro.
- [Storage de Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) e [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): armazenamento transacional e cleanup. Fencing/leases descritos acima são proposta Holon, não garantia automática da plataforma.
- [npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/) e [lockfile](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/): declarar engine/faixa não prova ambiente implantado.
- [pnpm workspaces](https://pnpm.io/workspaces): dependências locais e workspace protocol precisam de escopo.
- [Maven dependencies](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html) e [profiles](https://maven.apache.org/guides/introduction/introduction-to-profiles.html): herança, BOM e ativação impedem resolução incondicional ingênua.
- [Gradle platforms](https://docs.gradle.org/current/userguide/platforms.html) e [locking](https://docs.gradle.org/current/userguide/dependency_locking.html): catálogo não é prova isolada da resolução efetiva.
- [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/) e [layout/lock](https://docs.astral.sh/uv/concepts/projects/layout/): lock compartilhado e versões condicionais.
- [TypeScript target](https://www.typescriptlang.org/tsconfig/target.html): alvo ECMAScript é distinto de runtime.
- [AI SDK generateText](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) e [testing](https://ai-sdk.dev/docs/ai-sdk-core/testing): contrato estruturado e testes; conferir API contra versão 7 já fixada no Holon ao implementar.

Recomendações de DO, budgets, retenção e gates são propostas de projeto, não
benchmarks confirmados. Antes de produção validar latência/custo do modelo,
compatibilidade dos parsers, comportamento real de RPC/replay e política de
retenção de dados. Se a precisão não atingir o gate, manter observe/partial;
não compensar baixando validação ou inferindo versões ausentes.
