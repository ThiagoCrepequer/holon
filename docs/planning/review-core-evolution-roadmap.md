---
id: PLAN-REVIEW-CORE-EVOLUTION
kind: planning
status: current
owners:
  - core-team
last-reviewed: 2026-08-31
related:
  - ../product/mvp-scope.md
  - ../product/review-quality-contract.md
  - ../architecture/review-runtime-flow.md
  - ../decisions/0013-use-tiered-structural-and-textual-review.md
  - ../decisions/0016-require-complete-patches-and-host-verifiable-evidence.md
  - ../research/2026-08-30-agentic-review-completion-incident.md
  - ../research/2026-08-30-model-output-and-retry-incident.md
  - mvp-delivery-plan.md
  - open-questions.md
---

# Roadmap de evolução do core de review

## Status e finalidade

Este documento registra o backlog conhecido para evoluir o MVP de review antes
da expansão para interface, autenticação e multi-tenant. Ele é um plano
não normativo: ADRs aceitos continuam sendo a autoridade e qualquer mudança de
comportamento, confiança, persistência ou contrato precisa da documentação
correspondente.

O trabalho deve avançar em etapas pequenas e verificáveis. A primeira frente,
detalhada neste documento, é construir o sistema de avaliação do review. As
demais frentes ficam preservadas para planejamento posterior.

## Estado observado em 2026-08-31

Os smokes remotos já demonstraram partes importantes do caminho real, mas ainda
não constituem um piloto completo:

- um PR textual pequeno sem defeito percorreu GitHub App, Workflow, Sandbox,
  modelo e publicação e terminou sem finding;
- um PR TypeScript pequeno com regressão intencional publicou um comentário
  inline na linha e no SHA esperados;
- PRs grandes terminaram de forma limitada e explícita, mas produziram resumos
  pouco informativos e omitiram seções por orçamento determinístico;
- incidentes anteriores revelaram falha de integração com a identidade real do
  container e respostas de modelo incompletas ou inadequadas;
- ainda não foram demonstrados de forma suficiente reentrega de webhook,
  force-push concorrente, múltiplos findings, reexecução idempotente, repositório
  privado, limites reais de API ou distribuição representativa de linguagens e
  tamanhos.

Consequentemente, os documentos que dizem apenas “validação real pendente” estão
desatualizados, mas substituí-los por “validado em produção” também seria
incorreto. O estado preciso é **parcialmente comprovado em ambiente remoto, com
lacunas enumeradas**.

Em 2026-08-31, a fundação de avaliação passou a incluir contratos, dois casos
sintéticos, recordings autorizadas, runner, graders, relatório e execução
offline em Pull Requests. Um adapter live-model manual também ficou disponível
atrás do GitHub Environment `live-evaluation`; antecipá-lo não conclui baseline,
calibração, holdout ou gates das fases seguintes. O live eval continua manual,
pequeno e não publica no GitHub.

## Ordem recomendada

| Ordem | Frente                        | Resultado esperado                                        | Dependência            |
| ----- | ----------------------------- | --------------------------------------------------------- | ---------------------- |
| 1     | Sistema de avaliação          | Qualidade e regressões medidas de forma reproduzível      | nenhuma                |
| 2     | Ciclo de vida e publicação    | início, progresso, conclusão e review do GitHub coerentes | métricas básicas       |
| 3     | Batch review para PRs grandes | cobertura previsível por shards com agregação             | runner de avaliação    |
| 4     | Evidências de CI e testes     | uso seguro de cobertura, testes, SARIF e mutação          | contratos de evidência |
| 5     | Veredito determinístico       | `COMMENT`, `REQUEST_CHANGES` ou `APPROVE` por política    | avaliação calibrada    |
| 6     | Re-review e ciclo do finding  | novo, persistente, resolvido, obsoleto ou reintroduzido   | identidade estável     |
| 7     | Feedback e calibração         | sinal humano para falso positivo e utilidade              | ciclo do finding       |
| 8     | Analisadores determinísticos  | maior precisão estrutural e contratual                    | corpus por categoria   |
| 9     | Confiabilidade operacional    | SLOs, replay seguro, custo e diagnóstico                  | telemetria sanitizada  |
| 10    | Expansão horizontal           | UI, autenticação, tenancy, RAG e automações               | core medido e estável  |

## Backlog preservado

### 1. Sistema de avaliação

Atualizar a evidência documental dos smokes reais; criar corpus versionado,
runner e métricas; e melhorar a observabilidade necessária para explicar cada
resultado. O plano de implementação está detalhado abaixo.

### 2. Ciclo de vida e publicação

- representar `queued`, `in_progress` e `completed` em um Check Run ou mecanismo
  equivalente;
- publicar um review coerente, evitando review-pai vazio acompanhado de resumo
  separado sem relação clara;
- tornar explícitos resultado geral, parcialidade, cobertura, motivo de omissão
  e ação recomendada;
- preservar marcadores determinísticos e atualização idempotente.

Uma decisão será necessária se Check Runs passarem a compor o contrato externo
ou exigirem novas permissões do GitHub App.

### 3. Batch review para PRs grandes

- gerar um `ReviewPlan` determinístico com arquivos e patches completos;
- dividir por limites conhecidos, sem cortar uma unidade sem registrar isso;
- avaliar shards isoladamente e agregar, ordenar e deduplicar findings;
- reservar orçamento para síntese e publicação;
- distinguir `complete`, `partial_by_policy`, `partial_by_failure` e
  `unsupported`;
- medir cobertura de linhas elegíveis, arquivos, categorias e risco.

Essa frente deve superseder o comportamento aceito no ADR-0016 caso altere a
semântica atual de review parcial.

### 4. Evidências de CI, cobertura e testes

- consumir somente artefatos associados ao head SHA exato;
- começar por formatos passivos, como LCOV, JaCoCo XML, Cobertura, JUnit XML,
  SARIF e relatórios de mutação;
- validar esquema, tamanho, origem, conclusão do workflow e integridade antes do
  uso;
- expor “evidência indisponível” sem inferir ausência de testes;
- manter execução arbitrária, instalação de dependências e lifecycle scripts
  fora do executor.

Novas permissões, ingestão de artefatos privados ou persistência de relatórios
exigem decisão de confiança e retenção.

### 5. Veredito determinístico

- manter o modelo responsável por evidências e findings, não pela decisão final;
- derivar `REQUEST_CHANGES` apenas de findings bloqueadores que passaram por
  validação determinística;
- usar `COMMENT` para review parcial, inconclusivo ou não bloqueador;
- permitir `APPROVE` somente após corpus, calibração e critérios conservadores;
- documentar precedência entre severidade, confiança, parcialidade e falha de
  infraestrutura.

O veredito altera contrato externo e deverá ser aceito em ADR antes da
implementação.

### 6. Re-review e ciclo do finding

- criar fingerprint estável por regra, caminho, posição semântica e evidência;
- reconciliar achados como novos, persistentes, resolvidos, obsoletos ou
  reintroduzidos;
- evitar comentários duplicados em `synchronize` e redelivery;
- marcar resolução sem reescrever histórico;
- manter head SHA e identidade da execução em toda transição.

### 7. Feedback e calibração

- capturar rótulos mínimos: útil, falso positivo, severidade incorreta,
  duplicado, não acionável e perdeu o defeito;
- preservar exemplos anonimizados somente com autorização e política de
  retenção;
- medir concordância entre avaliadores e resolver divergências por adjudicação;
- promover casos confirmados para o corpus de regressão.

### 8. Analisadores determinísticos

- expandir call graph e impacto estrutural;
- comparar contratos de API, esquemas, migrações e configuração;
- verificar adequação de testes pelas mutações de comportamento;
- analisar dependências, permissões e superfícies de egress;
- usar a saída determinística como contexto e como oráculo parcial, não como
  substituto de revisão contextual.

### 9. Confiabilidade e observabilidade

- métricas por etapa, causa terminal e parcialidade;
- latência, tokens, custo, chamadas de ferramenta e cobertura de contexto;
- metadados seguros de provedor e modelo, sem prompts ou conteúdo do repositório;
- SLOs separados para aceitação, conclusão, publicação e qualidade;
- replay controlado de eventos sanitizados;
- detecção de drift de rota, versão, imagem e contrato.

### 10. Itens explicitamente adiados

Multiagente, RAG/Vectorize, interface, autenticação, tenancy, auto-fix e shell
arbitrário não devem anteceder uma baseline confiável. Eles ampliam custo,
superfície de ataque e variáveis de diagnóstico sem resolver a ausência atual
de medição.

## Plano de implementação da frente 1 — sistema de avaliação

### Objetivo

Responder de forma reproduzível a quatro perguntas:

1. O Holon detecta regressões conhecidas?
2. Os findings são corretos, acionáveis, não duplicados e publicáveis?
3. O fluxo operacional preserva SHA, limites, idempotência e estado terminal?
4. Uma alteração de prompt, modelo, política ou ferramenta melhorou ou piorou o
   sistema dentro de custo e latência aceitáveis?

### Princípios

- **Avaliar o sistema inteiro e os componentes separadamente.** Extração de
  contexto, análise, validação e publicação têm modos de falha distintos.
- **Preferir oráculos determinísticos.** Esquema, localização, SHA, quantidade,
  deduplicação, política e estado terminal devem ser avaliados em código.
- **Usar julgamento humano para verdade de referência.** Juiz por modelo só
  entra depois de medir sua concordância com rótulos humanos e nunca julga a
  própria integridade operacional.
- **Medir múltiplas dimensões.** Um único score esconde trocas entre recall,
  precisão, acionabilidade, cobertura, latência e custo.
- **Separar corpus público/sintético de casos privados.** Nenhum conteúdo de
  repositório privado ou payload de webhook entra no Git sem autorização e
  sanitização explícitas.
- **Versionar tudo que muda o resultado.** Caso, rubrica, política, prompt,
  modelo, ferramentas, orçamento e runner compõem a identidade da execução.
- **Começar offline.** O runner inicial não publica no GitHub, não cria recursos
  remotos e não requer segredos; smokes ao vivo ficam em uma suíte separada.

### Fase 1A — corrigir a baseline documental

#### Entregáveis

1. Criar
   `docs/research/2026-08-31-live-github-app-review-smoke.md` como snapshot
   factual e datado.
2. Registrar o snapshot em `docs/research/README.md`.
3. Reconciliar, sem reescrever ADRs, as afirmações obsoletas em:
   - `docs/planning/mvp-delivery-plan.md`;
   - `docs/planning/technical-bootstrap.md`;
   - `docs/planning/open-questions.md`;
   - checklist de smoke em `docs/operations/deployment.md`, apenas onde houver
     evidência correspondente.
4. Acrescentar errata datada aos relatórios de incidente somente quando uma
   observação posterior tiver invalidado uma hipótese anterior.

#### Matriz mínima de evidência

Cada afirmação deve registrar:

- identificador da afirmação e status (`confirmed`, `partially_confirmed`,
  `disconfirmed` ou `not_tested`);
- instante UTC, ambiente e método de observação;
- PR público e head SHA imutável;
- versão do Worker, Workflow e digest da imagem do executor, quando disponíveis;
- identificadores sanitizados de execução e publicação;
- resultado esperado, resultado observado e limitações;
- fonte primária ou comando reproduzível usado na verificação.

Não registrar payloads, prompts, diffs privados, tokens, chaves, cabeçalhos de
autorização, IDs de conta/instalação ou mensagens arbitrárias de exceção.

#### Afirmações que o snapshot deve preservar

| Caso                             | Evidência permitida                             | Conclusão limitada                                                    |
| -------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| PR pequeno sem defeito           | SHA, conclusão do Workflow e review sem finding | caminho vertical funciona para esse caso                              |
| regressão TypeScript intencional | SHA, comentário inline, linha e marcador        | um defeito conhecido foi localizado e publicado                       |
| PR grande                        | tamanho, parcialidade e razão determinística    | encerramento limitado funciona; qualidade do resumo não está aprovada |
| incidente do container           | etapa e causa sanitizada, versão corrigida      | integração foi corrigida para os smokes posteriores                   |
| saída inadequada do modelo       | classe da anomalia, sem prompt/diff             | contrato ainda precisa de avaliação sistemática                       |

O snapshot não pode afirmar suporte geral a repositórios privados, redelivery,
force-push, concorrência, múltiplos findings, rate limiting, todos os modelos ou
piloto de produção.

#### Razão para executar primeiro

O GitHub disponibiliza detalhes de entregas recentes de webhook por três dias e
não reenvia automaticamente entregas com falha. Cloudflare Workflows também tem
retenção limitada do estado concluído. A captura sanitizada precisa ocorrer
antes que a evidência operacional expire.

#### Critério de aceite

- toda afirmação histórica relevante tem data, fonte e limitação;
- nenhum documento canônico continua dizendo apenas “não testado ao vivo”;
- nenhum documento diz “produção validada” ou “piloto concluído”;
- links relativos e terminologia seguem a documentação canônica;
- não há segredo, conteúdo privado ou dado pessoal no diff.

### Fase 1B — especificar e construir o corpus

#### Unidade de caso

Criar um contrato versionado, por exemplo `EvalCaseV1`, com:

- `id`, `title`, `category`, `languages` e `risk_tags`;
- repositório-fixture local ou patch sintético antes/depois;
- base SHA e head SHA determinísticos;
- política/configuração aplicável;
- findings esperados com faixa de localização, severidade mínima, explicação e
  variantes aceitáveis;
- findings proibidos para medir falso positivo;
- comportamento operacional esperado: completo/parcial, ferramentas permitidas,
  limites e publicação simulada;
- proveniência, licença, revisão humana e classificação de sensibilidade.

O contrato deve ser validado em boundary com schema já adotado pelo projeto e
ter migração explícita para futuras versões.

#### Composição inicial

Começar pequeno, mas balanceado:

- casos positivos simples de JS/TS cobertos estruturalmente;
- alterações textuais com e sem defeito;
- casos negativos próximos aos positivos;
- localização em linha adicionada, modificada e contexto adjacente;
- múltiplos findings, duplicatas e severidade limítrofe;
- arquivo excluído, binário, gerado e maior que o limite;
- PR com muitos arquivos e orçamento esgotado;
- instrução maliciosa em README, comentário e nome de arquivo;
- head alterado antes da publicação;
- redelivery/reexecução e publicação já existente;
- respostas inválidas, truncadas, `finish_reason` anômalo, timeout e indisponibilidade;
- regressões reais já observadas, recriadas como fixtures sintéticas.

Separar `train/development` de `holdout`. Casos de holdout não devem orientar
diretamente ajustes de prompt. Toda promoção de incidente para corpus precisa de
sanitização e revisão.

#### Critério de aceite

- schema, fixtures e licenças revisados;
- nenhuma dependência de rede, segredo ou dado privado;
- casos positivos e negativos por categoria crítica;
- cada caso tem oráculo humano e operacional explícito;
- conjunto holdout identificado e protegido contra ajuste casual.

### Fase 1C — runner offline reproduzível

#### Arquitetura proposta

Adicionar um pacote de desenvolvimento, sem dependência do runtime de produção,
que reutilize as portas e políticas puras existentes:

1. loader valida `EvalCaseV1` e monta o fixture em diretório efêmero;
2. harness substitui GitHub, Sandbox e modelo por adapters controlados;
3. runner executa componente isolado ou fluxo completo;
4. normalizer converte saída em um `EvalResultV1` estável;
5. graders determinísticos calculam localização, contrato e estado;
6. relatório compara baseline e candidato sem publicar conteúdo do corpus;
7. processo termina com código não zero somente nos gates configurados.

O primeiro runner deve aceitar seed quando o provedor oferecer, registrar a
configuração efetiva e permitir repetições. Como seed não elimina
nondeterminismo, resultados devem incluir distribuição e intervalo, não apenas
uma execução.

#### Modos

- `offline:mock-model`: rápido, obrigatório em PR, valida o pipeline;
- `offline:recorded-output`: reproduz regressões de contrato sem rede;
- `offline:live-model`: manual ou agendado, com orçamento e egress explícitos;
- `remote:smoke`: poucos casos, ambiente real, sem fazer parte do gate local;
- `shadow`: futuro, somente após decisão de dados e retenção.

Gravações devem conter apenas saídas sintéticas ou autorizadas. Não adotar
record/replay de conteúdo real por conveniência.

#### Critério de aceite

- duas execuções offline equivalentes geram relatório estruturalmente idêntico;
- falhas distinguem runner, modelo, política, ferramenta e publicação simulada;
- execução não instala dependências, não usa shell arbitrário e não faz egress;
- cada resultado referencia versões de corpus, prompt, modelo e política;
- o runner consegue comparar baseline e candidato caso a caso.

### Fase 1D — métricas e graders

#### Métricas principais

| Dimensão       | Métrica inicial                                           |
| -------------- | --------------------------------------------------------- |
| Detecção       | recall por finding e por caso                             |
| Ruído          | precisão e falsos positivos por KLOC/PR                   |
| Localização    | arquivo correto e sobreposição com faixa aceitável        |
| Severidade     | matriz de confusão e erro bloqueador/não bloqueador       |
| Acionabilidade | rubrica humana pass/fail com exemplos âncora              |
| Duplicação     | findings únicos sobre publicados                          |
| Cobertura      | arquivos, linhas elegíveis, categorias e bytes analisados |
| Robustez       | taxa de contrato inválido, timeout, retry e parcialidade  |
| Integridade    | SHA correto, transições, idempotência e marcador          |
| Eficiência     | p50/p95 de latência, tokens, chamadas e custo por caso    |
| Estabilidade   | variância entre repetições e regressões contra baseline   |

O score agregado, se criado, deve ser apenas uma visão. Gates continuam por
dimensão para impedir que baixo custo compense perda grave de recall ou que alta
precisão esconda falha de publicação.

#### Estratégia de grading

1. schema, invariantes, linha, SHA, duplicação e estados: código;
2. equivalência semântica de findings: regras e matching configurável;
3. acionabilidade e explicação: rótulo humano com rubrica e exemplos âncora;
4. juiz por modelo: somente como candidato de escala, comparado ao conjunto
   humano por concordância, falsos positivos e falsos negativos.

Antes de um juiz por modelo entrar no gate, definir amostra cega, limiar de
concordância e procedimento de adjudicação. O juiz não pode ser o mesmo sinal
único usado para aprovar a própria mudança.

#### Baseline e gates iniciais

Não inventar metas antes da primeira medição. Executar a baseline, revisar os
erros e então propor em ADR ou quality contract:

- zero violação de integridade de SHA, idempotência ou publicação;
- zero regressão em casos críticos conhecidos;
- limites por categoria para recall e precisão;
- orçamento máximo de custo e p95 de latência;
- tolerância explícita para variância de modelo;
- política de atualização de golden cases.

### Fase 1E — observabilidade da avaliação

Adicionar somente metadados necessários para explicar métricas:

- `evaluation_run_id`, versão do corpus e ID do caso;
- versão do prompt/política, provedor e identificador do modelo;
- contagens de tokens, chamadas de ferramenta, arquivos e bytes;
- duração por etapa, retries, parcialidade e causa terminal enumerada;
- versão do Worker/Workflow/executor no smoke remoto;
- contagem de candidatos, rejeitados por validação e publicados.

Não registrar prompt, patch, conteúdo de arquivo, resposta integral do modelo,
authorization header ou exceção arbitrária. A telemetria de produção não deve
ser ampliada para alimentar corpus sem uma decisão de dados específica.

Pequenas anomalias já observadas entram como casos e métricas antes de correção:

- resposta-placeholder ou conclusão sem resumo útil;
- linguagem especulativa que extrapola o impacto demonstrado;
- review-pai vazio e conclusão fragmentada;
- diferença entre parcialidade esperada por política e perda por falha;
- falha de CI não relacionada aparecendo ao lado de um review Holon bem-sucedido.

### Sequência de entrega

1. **PR A — evidência documental:** snapshot, índice e reconciliação dos estados
   “pendente” versus “parcialmente comprovado”.
2. **PR B — contratos do corpus:** ADR apenas se houver nova retenção ou dado
   real; schemas, fixtures mínimas e validação.
3. **PR C — runner determinístico:** adapters locais, resultados versionados e
   testes de reprodutibilidade.
4. **PR D — graders e baseline:** métricas por dimensão, relatório legível e
   primeira medição sem gate arbitrário.
5. **PR E — gates calibrados:** limiares aprovados, conjunto holdout e execução
   obrigatória em CI.
6. **PR F — live eval controlada:** modelo real agendado e smoke remoto com
   orçamento, retenção e diagnóstico seguros.

Cada PR deve conter teste focado para o comportamento novo e manter
`pnpm verify` verde. Chamadas pagas, deploys e criação de recursos continuam
sendo efeitos externos e exigem autorização explícita.

### Decisões necessárias

Não é necessário um novo ADR para criar documentação factual, fixtures
sintéticas, contratos locais ou um runner offline que preserve as fronteiras
atuais.

Abrir decisão antes de:

- reter conteúdo ou saída derivados de repositórios reais;
- enviar dados do corpus a novo provedor ou juiz externo;
- executar live eval automaticamente com custo recorrente;
- alterar política de logs/AI Gateway para armazenar payloads;
- transformar métricas em `REQUEST_CHANGES` ou `APPROVE`;
- ampliar permissões do GitHub App ou egress do executor.

### Definition of done da frente 1

- evidência remota atual documentada com limites explícitos;
- corpus versionado com casos positivos, negativos, limites e ataques;
- runner offline reproduzível e sem egress;
- métricas multidimensionais e baseline revisada por humano;
- regressões críticas bloqueiam CI por critérios aceitos;
- live eval separada, orçada e diagnosticável;
- anomalias conhecidas têm caso de regressão antes da correção;
- nenhum dado privado ou segredo foi introduzido no corpus ou telemetria.

## Fontes primárias consultadas

Verificação realizada em 2026-08-31:

- [OpenAI — Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices):
  avaliação orientada à tarefa, métricas com julgamento humano, casos normais,
  limites e adversariais, e avaliação contínua;
- [Anthropic — Define success criteria and build evaluations](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests):
  critérios específicos, mensuráveis e multidimensionais; preferência por
  graders determinísticos e calibração de graders por modelo;
- [GitHub — Viewing webhook deliveries](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries):
  conteúdo disponível para entregas recentes por três dias;
- [GitHub — Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries):
  ausência de redelivery automático para falhas;
- [GitHub — Pull request reviews REST API](https://docs.github.com/en/rest/pulls/reviews):
  contrato de reviews e comentários em pull requests;
- [Cloudflare — Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/):
  retenção limitada de estado concluído e limites da plataforma;
- [Cloudflare — Workflows observability](https://developers.cloudflare.com/workflows/observability/):
  inspeção de instâncias e etapas;
- [Cloudflare — Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/):
  eventos de invocação, logs customizados e exceções;
- [Cloudflare — AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/):
  conteúdo potencialmente sensível de logs de IA e controles por requisição;
- [Cloudflare — AI Gateway evaluations](https://developers.cloudflare.com/ai-gateway/evaluations/):
  capacidades atuais de avaliação do gateway, consideradas opcionais e não a
  fonte de verdade do runner local.

## Próxima ação

Estado em 2026-08-31:

- o **PR A — evidência documental** foi executado pelo snapshot remoto e pela
  reconciliação dos documentos de planejamento;
- o contrato `EvalCaseV1`, o runner offline, os graders determinísticos e dois
  casos sintéticos de desenvolvimento iniciaram os PRs B e C;
- nenhum gate de qualidade foi definido a partir dessa amostra mínima.

A próxima ação é ampliar o corpus de desenvolvimento por categoria e adicionar
casos holdout antes de medir a primeira baseline. Correções das anomalias
observadas continuam posteriores aos respectivos casos de regressão.
