---
id: RESEARCH-REPOSITORY-CONFIGURATION-2026-09-09
kind: research
status: current
owners: [core-team]
last-reviewed: 2026-09-09
---

# Evidências para configuração de repositório e schema de editor

Verificação: **2026-09-09**. Este documento registra evidências, não aprova uma
arquitetura. O [plano](../planning/repository-configuration-and-editor-schema.md)
separa as recomendações da implementação existente.

## Snapshot inspecionado

Código local: `e7234b761b94df519ed38bbbafbc08b19024cf1b`, branch
`codex/core-workflow-reliability`. O usuário informou um deploy; esta pesquisa não
consultou o ambiente implantado e não comprova qual revisão está em execução.

| Fato verificado no código                                                                                                                            | Evidência                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YAML aceita somente exclusões adicionais e rigor de veredito; rejeita campos desconhecidos.                                                          | [repository-policy.ts](../../packages/contracts/src/repository-policy.ts)                                                                                                                      |
| O workflow resolve a política no base SHA, antes de preparar o executor.                                                                             | [review-workflow.ts](../../apps/control-plane/src/review-workflow.ts), etapa `resolve-repository-policy`                                                                                       |
| A operação de leitura é opcional; ausência do método resulta em política default.                                                                    | [repository-policy-resolver.ts](../../apps/control-plane/src/repository-policy-resolver.ts), `resolveRepositoryPolicy`                                                                         |
| O adaptador Contents converte 404 em ausência e verifica `type`, encoding e tamanho depois de obter a resposta.                                      | [client.ts](../../packages/github/src/client.ts), `readRepositoryPolicyFile`                                                                                                                   |
| A identidade da run inclui PR/head; a admissão trata uma identidade já existente como resume/duplicate. Revalidações posteriores comparam head/base. | [identity.ts](../../packages/domain/src/identity.ts), [ledger-object.ts](../../apps/control-plane/src/ledger-object.ts), [review-workflow.ts](../../apps/control-plane/src/review-workflow.ts) |
| O fingerprint primário inclui diagnóstico normalizado; há matching secundário por evidência.                                                         | [fingerprint.ts](../../packages/domain/src/fingerprint.ts), [lifecycle.ts](../../packages/domain/src/lifecycle.ts)                                                                             |
| Identificação conserva origem/tipo das versões e a chave de cache inclui política/perfil/detector.                                                   | [contrato](../../packages/contracts/src/project-identification.ts), [identify.ts](../../packages/project-identification/src/identify.ts)                                                       |
| Investigação, finalização/recovery e síntese têm prompts separados; o host também produz mensagens em inglês.                                        | [reviewer.ts](../../packages/model/src/reviewer.ts), [ai-sdk.ts](../../packages/model/src/ai-sdk.ts), [aggregate-reviews.ts](../../packages/application/src/aggregate-reviews.ts)              |
| Há armazenamento privado temporário de análise no ledger com manifesto de checkpoint e cleanup durável.                                              | [review-analysis-store.ts](../../apps/control-plane/src/review-analysis-store.ts)                                                                                                              |

Consequências inferidas: ampliar apenas o schema YAML não entregaria idioma de
ponta a ponta, isolamento das instruções por projeto, identidade estável ou replay
consistente. Ausência de configuração precisa ser comprovada, e não deduzida de
falha de acesso. São pré-requisitos do plano, não correções feitas nesta pesquisa.

## Documentação primária consultada

Todas as fontes abaixo foram consultadas em **2026-09-09**.

| Fonte                                                                                                                                                                                                     | Evidência e aplicação ao plano                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [YAML Language Server](https://github.com/redhat-developer/yaml-language-server#associating-schemas)                                                                                                      | Suporta modeline `# yaml-language-server: $schema=...`, autocomplete e descrições. A documentação atual declara suporte a drafts 04, 07, 2019-09 e 2020-12. Escolher draft-07 é uma proposta de portabilidade, não uma limitação afirmada do servidor atual. |
| [Zod: JSON Schema](https://zod.dev/json-schema)                                                                                                                                                           | Conversão nativa, seleção de dialect e de input/output; certos tipos/transforms não têm representação e `unrepresentable: "any"` afrouxa o resultado. Gerar a parte estrutural exportável e manter validação semântica explícita.                            |
| [JSON Schema: objetos](https://json-schema.org/understanding-json-schema/reference/object)                                                                                                                | Propriedades extras não são rejeitadas por padrão. Usar objetos fechados; mapas de tecnologias têm valores tipados e são aberturas deliberadas.                                                                                                              |
| [JSON Schema: annotations](https://json-schema.org/understanding-json-schema/reference/annotations)                                                                                                       | `default`, exemplos e descrições documentam; `default` não preenche propriedades durante a validação. Defaults efetivos pertencem ao compilador do Holon.                                                                                                    |
| [Parser yaml](https://eemeli.org/yaml/)                                                                                                                                                                   | API de documentos/AST, posições, checagem de chaves únicas, aliases e opções de versão. Validar YAML 1.2 limitado antes de converter para objeto.                                                                                                            |
| [GitHub Contents](https://docs.github.com/en/rest/repos/contents#get-repository-content)                                                                                                                  | `ref` fixa a leitura; a API pode seguir symlink cujo destino é arquivo normal. Checar apenas `type: file` na resposta não prova ausência de symlink.                                                                                                         |
| [GitHub Git Trees](https://docs.github.com/en/rest/git/trees#get-a-tree)                                                                                                                                  | Entradas têm mode/type/SHA; respostas recursivas podem vir truncadas. A documentação orienta consultas não recursivas por subárvore quando necessário. Provar caminho e modo antes de ler blob.                                                              |
| [GitHub: troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#404-not-found-for-an-existing-resource)                                                         | Recursos privados inacessíveis podem responder 404; rate limits usam metadados de retry/reset. Distinguir ausência provada de autorização/transporte.                                                                                                        |
| [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)                                                                                                               | Replay reconstrói estado por resultados de steps; I/O/efeitos devem ficar em steps, com nomes determinísticos e operações idempotentes. Não depender de mutações de closures.                                                                                |
| [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)                                                                                                                         | O resultado não-stream de um step tem teto de 1 MiB. Usar manifesto pequeno e conteúdo privado no ledger, sem ampliar o checkpoint com instruções.                                                                                                           |
| [Durable Objects SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)                                                                                                       | Armazenamento transacional, fortemente consistente e privado por objeto. É apropriado para selar o snapshot da run e rejeitar gravação conflitante.                                                                                                          |
| [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)                                                                                                | Preferir bindings, leituras limitadas, logs estruturados e ausência de estado global de request. Não introduzir outro serviço público de configuração dinâmica.                                                                                              |
| [Workers Test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)                                                                                                      | Ferramentas oficiais para exercitar Durable Objects e inspecionar/controlar Workflows localmente. Regressões de replay devem usar o runtime além de testes de funções puras.                                                                                 |
| [OWASP: Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)                                                                     | Separação de instruções/dados, menor privilégio e validação de saídas são defesas em camadas. Delimitadores ou classificação de texto não garantem imunidade a prompt injection.                                                                             |
| [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)                                                                                                                                                        | Define canonicalização JSON para hashes reproduzíveis. A ordenação de arrays com significado deve continuar preservada pelo Holon.                                                                                                                           |
| [RFC 5646 / BCP 47](https://www.rfc-editor.org/rfc/rfc5646)                                                                                                                                               | Tags de idioma têm sintaxe padronizada; uma tag válida não prova que o produto tenha traduções para ela. Validar contra catálogo de idiomas entregues.                                                                                                       |
| [node-semver](https://github.com/npm/node-semver), [Python version specifiers](https://packaging.python.org/en/latest/specifications/version-specifiers/), [Maven POM](https://maven.apache.org/pom.html) | Ecossistemas distinguem versões, intervalos e condições. Não aplicar um parser SemVer universal a todas as declarações.                                                                                                                                      |
| [SchemaStore: contribuição](https://github.com/SchemaStore/schemastore/blob/master/CONTRIBUTING.md)                                                                                                       | Catálogo permite associação por nome de arquivo. A contribuição pública fica para uma etapa posterior; não é dependência do modeline.                                                                                                                        |

## Skills aplicadas

- `cloudflare:workers-best-practices`: fronteiras, I/O limitado e estado por execução.
- `cloudflare:durable-objects`: persistir antes de cachear, transações curtas e
  cleanup coordenado pelo ledger existente.

A documentação atual foi usada para conferir os princípios. Não foram escritos
novos bindings, instaladas dependências, executadas suites ou feitas operações
remotas. Limites de produto e formato propostos precisam dos gates do plano.

## Evidência adicional da implementação — 2026-09-09

O inventário anterior registra o estado pré-implementação. A ADR-0037 foi aceita
com a autorização de implementação integral; limites e semântica vigentes estão
no [guia operacional](../operations/repository-configuration.md).

Fontes primárias adicionais verificadas nesta data:

- [Octokit request.js](https://github.com/octokit/request.js):
  `request.parseSuccessResponseBody: false` permite limitar o stream antes de
  parsear a resposta JSON; o adaptador local usa esse caminho.
- [Renovate PEP 440](https://github.com/renovatebot/pep440) e
  [especificação Python](https://packaging.python.org/en/latest/specifications/version-specifiers/):
  validação de versões/specifiers não usa SemVer. O package 4.2.4 foi selecionado
  por compatibilidade com Node 24.4 do ambiente; 5.0.1 exige Node >=24.10.

A validação do editor usa a implementação real de YAML Language Server para
completion, hover e diagnósticos e Ajv para paridade estrutural. Isso não equivale
a uma sessão manual na interface do VS Code nem comprova hospedagem pública.
