---
id: PLAN-DASHBOARD-ENGINEERING-REVIEW
kind: planning
status: proposed
owners:
  - core-team
last-reviewed: 2026-10-04
related:
  - ../engineering/frontend-application-structure.md
  - ../engineering/testing-and-evidence.md
  - ../research/2026-10-04-dashboard-authentication-discovery.md
---

# Revisão das decisões de engenharia e qualidade do dashboard

**Entrada atual para implementar:** [plano consolidado](dashboard-implementation-plan.md),
com sequência, gates e matriz de regressão corrigidos pela
[revisão de robustez](../research/2026-10-04-dashboard-plan-robustness-review.md).
Este arquivo preserva o histórico das respostas Q1–Q37. As tabelas de auditoria
e etapas anteriores registram o entendimento de cada rodada; não representam
suporte comprovado do candidato auth ou protocolos finais por si.

## Objetivo e estado da entrevista

Quais decisões ainda faltam para implementar o dashboard dos usuários com
fronteiras claras e evidência de qualidade proporcional ao comportamento?

Revisão iniciada em **2026-10-04**, pelo fluxo `grill-with-docs` disponível
localmente, equivalente à intenção do `/grill-me-with-docs` solicitado.
Combina entrevista em rodadas (`grilling`) e registro de termos/decisões
(`domain-modeling`). Fontes abaixo foram conferidas no checkout; nenhuma
recomendação desta revisão virou escolha aprovada por silêncio.

A **rodada 1 foi respondida em 2026-10-04: Q1–Q4 acordadas explicitamente**.
A rodada 2 foi respondida em **2026-10-04**: Q5 teve a escolha técnica
delegada por performance; Q6 retirou histórico do escopo; Q7/Q10/Q11 confirmaram
as recomendações; Q8/Q9 corrigiram atualização e localização de Query.
A rodada 3 foi respondida em **2026-10-04**: Q12–Q15/Q17/Q18 acordadas;
Q16 definiu **pt-BR e inglês desde a primeira entrega**.
A rodada 4 foi respondida em **2026-10-04**: Q19–Q24 acordadas.
O responsável acrescentou o modelo login/provider + workspaces com N usuários
e pediu avaliação crítica. A rodada 5 foi respondida em **2026-10-04**:
Q25–Q30 acordadas, com organização e workspace explicitamente definidos como
o mesmo conceito e papéis por membership. A rodada 6 foi respondida em
**2026-10-04**: Q31–Q34 acordadas, com Cloudflare Email Sending escolhido em Q32.
A **entrevista inicial de produto Q1–Q34 está concluída**. A discussão posterior
sobre Worker de email acrescentou Q35/Q36, respondidas em **2026-10-04**:
Worker privado confirmado e escolha corrigida para Queue/retries duráveis.
Uma investigação posterior identificou Q37, respondida em **2026-10-04**:
retry automático limitado do mesmo convite após resultado externo desconhecido,
aceitando eventual email duplicado. As respostas anteriores não foram reabertas.
Desenho e provas técnicas seguem delimitados abaixo;
detalhes de SDK/SQL não são novas perguntas de preferência.
Este arquivo é
um registro de escolhas confirmadas e perguntas/dependências, não ADR ou
implementação concluída.
Registrar respostas explícitas e adaptar os guias afetados após cada rodada.
ADRs só para escolhas com trade-off relevante e custo significativo de reversão;
termos de domínio resolvidos vão ao glossário canônico, sem detalhes técnicos.

## Direções já acordadas na conversa

- Dashboard é produto para usuários, não o antigo admin.
- React/Tailwind/shadcn como base visual e preferência pelo ecossistema TanStack.
- React Router SSR + Hono API, com casos de uso/política compartilhados.
- Dependências externas preferencialmente concentradas em packages com
  interfaces úteis; exceções core delimitadas.
- Arquivos privados próximos da rota, features para capacidades reutilizadas,
  UI genérica compartilhada e direção explícita dos imports.
- Contratos externos separados de schema de formulário e banco; datasets não
  duplicados em Context/store/Query.
- Lucide preferencial, autorais condicionados à necessidade e consistência.
- Movimento local e discreto, redução de movimento, teclado, foco e continuidade.
- Better Auth + Drizzle/D1 como direção; autenticação não será implementada
  antes de debater os detalhes.

Isso preserva o [guia proposto](../engineering/frontend-application-structure.md)
e a [pesquisa atualizada](../research/2026-10-04-dashboard-library-landscape.md).
ADRs do core continuam vigentes. Não reabrir essas direções como se estivessem
sem resposta; distinguir preferências confirmadas de interfaces ainda propostas.

## Auditoria inicial e decisões que a sucederam

A tabela distingue o que faltava antes da rodada 1 das respostas obtidas.
A confirmação de escopo/topologia não significa que os workspaces ou contratos
já existam no runtime.

| Fato                                                                                                                        | Fonte local                                                                                                                     | Implicação para o bootstrap                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Lista/detalhe eram exemplos de composição antes da rodada 1                                                                 | [Pesquisa SSR/API](../research/2026-10-04-dashboard-library-landscape.md#composição-híbrida-proposta--2026-10-04)               | Q1 agora confirma lista/detalhe; índice e semântica de leitura seguem pendentes                                               |
| Read model D1 anterior foi retirado; permanecem dados funcionais do ledger por PR                                           | [ADR-0040](../decisions/0040-retire-admin-and-analytical-storage.md)                                                            | D1 de auth não fornece por si só índice de revisões, projeção, retenção ou backfill                                           |
| Dashboard SSR/API no mesmo Worker era proposta; relação com control plane estava aberta                                     | [Pesquisa de composição](../research/2026-10-04-dashboard-library-landscape.md#composição-híbrida-proposta--2026-10-04)         | Q2 agora confirma Worker próprio; contrato para consumir o core segue pendente                                                |
| Gate tem lista fixa, percorre fontes TS/TSX em `src`, compara nome completo após `@holon/` e resolve ciclo `.js` para `.ts` | [Checker atual](../../tooling/architecture/import-boundaries.test.mjs)                                                          | `app/`, subpaths, ciclos TSX/aliases e regras de rota/feature precisam de suporte explícito; não dizer que já são verificados |
| `verify` não chama `brand:check`; CI chama `verify`                                                                         | [Manifest raiz](../../package.json), [CI](../../.github/workflows/ci.yml)                                                       | Artefatos de tokens/contraste não são hoje critério CI; check estático não prova acessibilidade renderizada                   |
| Vitest root usa Node, com 90% linhas/funções/statements e 85% branches; catálogo sem ferramentas de teste frontend          | [Vitest](../../vitest.config.ts), [Catálogo](../../pnpm-workspace.yaml)                                                         | Cobertura atual não prova DOM, interação, hidratação ou navegação de dashboard inexistente                                    |
| Critérios visuais/acessíveis existem, sem matriz de browsers ou suite frontend implementada                                 | [Componentes](../brand/components.md#critérios-para-uma-interface-pronta), [Motion](../brand/motion.md#implementação-e-revisão) | Q3/Q4 confirmam suporte e prova bloqueante; configs, matriz de execução e evidência ainda faltam                              |
| Migrations, preview, budgets e políticas por dataset estão em princípio/proposta                                            | [Guia frontend](../engineering/frontend-application-structure.md#infraestrutura-de-aplicação-e-verificação-futura)              | Detalhar depois do fluxo, topologia, dados e identidade; não inventar metas numéricas agora                                   |

## Rodada 1: decisões acordadas em 2026-10-04

| ID  | Pergunta                                                                                                                                  | Escolha confirmada                                                                                                                                                                                                  | Estado   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q1  | Qual primeira fatia real deve orientar o desenho e a prova: detalhe de PR conhecido, lista/detalhe por repositório, ou análise histórica? | Lista/detalhe por repositório autorizado, estados atuais e filtros básicos; histórico analítico separado. Índice de descoberta ainda precisa de definição                                                           | Acordada |
| Q2  | SSR/API do dashboard ficam em Worker próprio ou passam a integrar o control plane?                                                        | `apps/dashboard` com SSR e Hono no mesmo Worker, separado do coordenador de reviews. Contrato para consumir o core será definido depois                                                                             | Acordada |
| Q3  | Quais browsers/plataformas são suportados e qual referência normativa de acessibilidade?                                                  | Chrome/Edge, Firefox e Safari nas duas versões estáveis mais recentes; Safari iOS/Chrome Android; WCAG 2.2 AA, 320 px, zoom, teclado e movimento reduzido. Matriz de teste posterior distingue suporte de automação | Acordada |
| Q4  | Qual política mínima de prova deve bloquear PRs de implementação?                                                                         | Marca/tokens, imports e ambiente, lint/types, testes de comportamento/contrato e fluxo browser crítico como gates; preservar cobertura atual nas camadas instrumentadas, complementar com evidência de UI           | Acordada |

Respostas do responsável: **Q1 — Concordo; Q2 — Outro worker, concordo;
Q3 — Concordo; Q4 — Concordo**. Esses critérios foram incorporados ao
[guia de organização](../engineering/frontend-application-structure.md) e
à [política de prova](../engineering/testing-and-evidence.md#dashboard-critérios-acordados-para-implementação-futura).

A referência [WCAG 2.2](https://www.w3.org/TR/WCAG22/) foi consultada em
2026-10-04. AA é o alvo acordado; conformidade depende da interface implementada
e avaliada. Suporte declarado não equivale às engines/versões executadas em CI.

## Evidência adicional para a rodada 2

- O [ledger](../../apps/control-plane/src/ledger/ledger-object.ts) é endereçado
  por PR e fornece leituras internas. Não há índice de revisões por repositório
  nem API de produto/DTO agregado de detalhe implementados. Isso sustenta Q5.
- [Findings rastreados](../../apps/control-plane/src/ledger/finding-ledger-store.ts)
  são mutáveis; feedback pode alterá-los na mesma execução. A decisão atual pode
  estar ausente enquanto a nova execução avança. Q6 precisa distinguir
  proveniência do achado e resultado confirmado para o head atual.
- O [envelope](../../packages/contracts/src/webhook.ts) traz identidade do
  repositório, número do PR e SHAs, sem título/autor/estado aberto ou fechado.
  Metadados completos não podem ser presumidos só porque o webhook original
  vem do GitHub. Q7 define a necessidade; captura/atualização vêm depois.
- [Cleanup](../../apps/control-plane/src/ledger/ledger-object.ts) apaga análise
  reconciliada e corpos de configuração. Dados duráveis disponíveis não
  reconstruem integralmente cada execução antiga. Ausência de expurgo temporal
  no código examinado não estabelece compromisso de retenção.
- `runId`/`causalVersion` distinguem execuções, mas não ordenam todas as
  alterações dentro delas. Uma projeção futura exige revisão de snapshot,
  entrega idempotente e reconciliação próprias. Polling não resolve essa
  durabilidade. O mecanismo depende de Q5 e será desenhado depois.

## Rodada 2: respostas registradas em 2026-10-04

| ID  | Resposta do responsável                                                    | Resultado para o desenho                                                                                                                                                                                 | Estado                           |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Q5  | Escolher o mais performático no contexto D1/Cloudflare                     | Escolha técnica inicial: projeção D1 mínima indexada para lista; detalhe agregado autoritativo por RPC do core. Justificativa e limites abaixo                                                           | Delegada e definida tecnicamente |
| Q6  | Execuções anteriores não importam nesta etapa; ainda não há usuários reais | Sem histórico de execuções anteriores ou backfill na primeira entrega; não apagar estado funcional do ledger nem apresentar achado de head anterior como resultado atual                                 | Fora do escopo inicial           |
| Q7  | Concordo com a recomendação                                                | Número, título, autor, repositório, link GitHub, estado da revisão e datas relevantes; captura/atualização de metadados têm responsabilidade própria                                                     | Acordada                         |
| Q8  | Sem atualização automática agora se não houver SSE; documentar SSE depois  | MVP sem polling/auto-refresh; abertura, navegação/filtros/paginação e refresh manual fazem leituras explícitas. SSE é evolução documentada; meta anterior de 5 s não foi adotada                         | Direção corrigida                |
| Q9  | Queries devem ficar no app                                                 | TanStack Query direto no app, em módulos de dados da feature ou privados da rota; não criar package cliente apenas para queries/hooks/options. Outras dependências mantêm preferência por packages úteis | Direção corrigida                |
| Q10 | Concordo com a recomendação                                                | Testes DOM de interação/semântica complementados por browser para foco/layout/motion/SSR/hidratação; configs próprias                                                                                    | Acordada                         |
| Q11 | Concordo com a recomendação                                                | Crítico por PR em Chromium/Firefox/WebKit; amplo em main/pré-publicação; promoção bloqueada se incompleta; complemento Safari/mobile reais e versões suportadas                                          | Acordada                         |

### Q5: critério técnico e limite da conclusão

**Escolha inicial: uma projeção de listagem no D1, indexada e paginada,
e uma leitura agregada de detalhe no ledger por PR.** A delegação do
responsável permite selecionar a composição, não afirmar performance medida.

A lista deve retornar uma página com seus campos necessários sem consultar
N Durable Objects, nem fazer GET GitHub por linha/request. Metadados entram
por ingresso validado/enriquecimento controlado; mudanças de título/estado
não devem disparar novas reviews apenas para atualizar o dashboard.

O detalhe usa uma capacidade estreita do control plane, que agrega o snapshot
no próprio DO, com DTO validado e identidade/head/run claros. Evitar leituras
RPC separadas que componham estados de instantes diferentes; o entrypoint e
o agregado ainda não existem. Ledger permanece autoridade do lifecycle.

Projetar diagnósticos completos agora acrescentaria escritas, payload e
reconciliação antes de demonstrar vantagem. O desenho reduz fan-out na lista
e duplicação do detalhe; **é inferência arquitetural, não benchmark nem prova
de menor latência absoluta**. Se o detalhe for gargalo medido, comparar a
projeção dele com o mesmo contrato antes de ampliar persistência.

Conferir índices com `EXPLAIN QUERY PLAN`, rows lidas/escritas, latência p50/p95,
payload/CPU, lag de projeção e recuperação após falha/reordenação. Composição
real e localização dos serviços precisam de prova posterior. Replicação D1
não é adotada por antecipação; Sessions API não resolve atraso DO→projeção.
[Índices D1](https://developers.cloudflare.com/d1/best-practices/use-indexes/),
[replicação e Sessions](https://developers.cloudflare.com/d1/best-practices/read-replication/),
[service bindings/RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
foram verificados em **2026-10-04**.

O índice começa vazio e recebe observações após habilitação; não enumerar PRs
antigos nem importar histórico. Estado vazio significa ausência de revisão
observada por essa capacidade, sem afirmar que o PR nunca foi revisado.
A projeção backend continua recebendo mudanças duravelmente mesmo sem refresh
automático do browser; snapshot precisa de revisão própria, entrega idempotente
e reconciliação. Desenhar o mecanismo no bootstrap sem alterar o ledger atual
por iniciativa desta entrevista.

### Q8/Q9: política cliente confirmada

Query keys/options/hooks e integração SSR ficam no app. Policies são locais
ao módulo dono do dataset, sem duplicá-las em cada componente. O SSR fornece
o primeiro snapshot; interação posterior usa API com a mesma aplicação.

Sem `refetchInterval`, refetch por foco/reconexão ou refetch de montagem que
duplique o snapshot hidratado. Leituras de abertura/navegação, mudança de
filtro/página e refresh manual são explícitas. Preserve último conteúdo
confirmado durante refresh e, se falhar, mantenha erro contextual; expor
instante da observação sem afirmar realtime. Isso não muda a obrigação de
autorização servidor por leitura/operação. Q24/Q30 definiram sessão e frescor
posteriormente; manutenção da sessão não é refetch dos datasets.
[Defaults do Query](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
foram conferidos em 2026-10-04: foco/reconexão/montagem podem refazer queries
stale por padrão, então a restrição requer configuração e prova explícitas.

**SSE futuro:** avisos/eventos tipados de mudança, autorização por recurso,
ordenação, reconexão, ressincronização e cancelamento ao trocar escopo. Snapshot
inicial e recuperação permanecem por leitura autorizada. Não implementar
streams/timers nem manter a meta anterior de 5 s nesta entrega.

## Rodada 3: respostas registradas em 2026-10-04

| ID  | Escolha confirmada                                                                                                                                                       | Estado            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Q12 | Primeira entrega somente leitura de reviews: lista/detalhe/filtros/refresh/link GitHub. Sem feedback, reexecução ou configuração de review nesta fatia                   | Acordada          |
| Q13 | Repositório, estado da revisão e busca por número/título; atividade mais recente primeiro, com desempate estável. Semântica exata da busca ainda precisa definição       | Acordada          |
| Q14 | Desktop comum e mobile intermediário, incluindo conexão limitada; protocolo registra dispositivo/conexão, cache frio/quente e build real                                 | Acordada          |
| Q15 | Fixture de 10.000 PRs indexados por repositório, páginas de 50 e detalhe com 200 achados/textos extensos. Cenário de teste, não limite de produto ou histórico importado | Acordada          |
| Q16 | pt-BR e inglês desde o início; suporte multilíngue completo na primeira entrega                                                                                          | Direção corrigida |
| Q17 | GitHub como primeiro provider de login humano; identidade, instalação e autorização continuam separadas                                                                  | Acordada          |
| Q18 | Uso individual e organizações explícitas do Holon para equipes; vínculos com instalações GitHub separados                                                                | Acordada          |

Q12 restringe comandos do domínio de revisão. Login/logout e manutenção de
sessão têm natureza própria; fluxos de onboarding/convite/vínculo precisam do
debate de auth, sem inclusão automática na UI inicial. Identidades de produto
resolvidas foram registradas no [glossário](../glossary.md#identidade-no-holon).
Não criar roles, tabelas ou plugins a partir dos nomes do glossário.

### Consequências de engenharia e prova

- Query continua no app e sem atualização automática. A lista paginada usa
  projeção D1; o detalhe usa o snapshot autorizado do core. Índices/contratos
  dependem da semântica da busca e política de acesso.
- pt-BR e inglês são idiomas de interface completos desde o início. Não
  aceitar idioma incompleto escondido por fallback; testar textos/estados,
  plurais, números, nomes acessíveis e layout nos dois.
- Locale e catálogo iniciais devem ser os mesmos no HTML e na hidratação;
  instância de tradução por request, sem locale mutável global compartilhado.
  Política de escolha/fallback e fuso pessoal estão em Q19/Q20.
- Idioma da UI é separado de `output.language` da revisão, que já admite
  `en`, `pt-BR`, `es` no [contrato vigente](../../packages/contracts/src/repository-config/input.ts).
  Não traduzir conteúdo/evidência/código nem disparar análise ao trocar UI.
- Matriz crítica: pt-BR/inglês × Chromium/Firefox/WebKit. Suite ampla inclui
  textos expandidos/pseudolocale e os mesmos cenários de performance aprovados,
  com catálogos/chunks medidos. A matriz ainda não foi implementada.

### Fatos para o próximo debate de acesso

O adapter [GitHub atual](../../packages/github/src/client.ts) tem
`repositoryPermission`, utilizado na resolução de threads para exigir escrita.
Não há sessão humana/dashboard ou ACL de organizações Holon implementadas.
Essa verificação atual não constitui autorização geral de leitura do produto.

Tokens de instalação representam permissões da App; tokens de usuário GitHub
App restringem atuação também ao acesso do usuário. **Ter login, membership
Holon ou instalação disponível não prova sozinho acesso ao repo privado.**
A política de produto precisa ser escolhida antes de decidir o mecanismo.
[Autenticação em nome do usuário](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user),
verificada em 2026-10-04.

## Rodada 4: acordada em 2026-10-04

O responsável respondeu **Concordo** a Q19–Q24.

| ID  | Escolha confirmada                                                                                                                                                         | Estado   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q19 | pt-BR/en; escolha explícita pessoal, depois navegador/Accept-Language, fallback inglês; seletor e preferência persistida, mesma escolha SSR/browser                        | Acordada |
| Q20 | Fuso pessoal configurável e persistido; inferência do dispositivo quando disponível, UTC explícito até conhecê-lo, independente do idioma                                  | Acordada |
| Q21 | Número exato + título contém termo, ignorando caixa/acentos; implementação/plano/custo ainda precisam de prova                                                             | Acordada |
| Q22 | Sessão válida + acesso ao espaço Holon + instalação ativa vinculada + grant GitHub atual ao repo; papel/membership Holon não concede acesso privado adicional              | Acordada |
| Q23 | Cadastro GitHub aberto com espaço pessoal vazio; sem dados, membership de equipe ou instalação de terceiros automaticamente                                                | Acordada |
| Q24 | Validade móvel de 7 dias, renovação durante uso após 24 h desde a última renovação; múltiplos dispositivos, logout atual/todos; sem limite absoluto adicional inicialmente | Acordada |

Q21 define UX, não escolhe FTS agora. `LIKE '%termo%'` não recebe otimização
de range por B-tree; comparação nativa não garante casefold Unicode.
[SQLite optimizer](https://www.sqlite.org/optoverview.html#the_like_optimization),
verificado em 2026-10-04. Provar alternativa de busca com os 10.000 registros
aprovados e escopo por repositório; número exato é caminho separado.

Q24 é escolha confirmada do Holon, coincidente com os prazos documentados de
[Better Auth](https://better-auth.com/docs/concepts/session-management),
verificados em 2026-10-04, não adoção automática do default. Cookie cache pode
aceitar sessão revogada até expirar; Q30 posteriormente confirmou ausência
de cookie cache de sessão e revalidação local na próxima request. Reauth de
gestão sensível ainda requer desenho/prova técnica.
Manutenção de sessão não é refresh automático dos datasets da revisão.

## Workspace: avaliação crítica e rodada 5

O responsável descreveu SSO/provider para login e workspaces/organizações com
N usuários. Essa separação foi confirmada; o [modelo de produto](../engineering/dashboard-identity-and-workspaces.md)
explicita User estável, identidades de provider, Session, Workspace, Membership
e connection GitHub. O modelo N:M evita User preso a um só espaço e papel global.

Hoje esses conceitos existem na documentação, sem configuração/runtime de
workspace. Organização e workspace são o mesmo conceito, conforme confirmação
explícita do responsável; pessoal/equipe usam a mesma entidade em Q25.
Mesmo com login GitHub, a instalação e grant humano seguem separados. Não
persistir a escolha de uma aba como autoridade global de todas as outras.

| ID  | Pergunta                                        | Escolha confirmada                                                                                                                                                                                                                                          | Estado   |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q25 | Pessoal/equipe usam a mesma entidade Workspace? | Um pessoal exclusivo por usuário, sem convites/conversão silenciosa; equipes com N usuários, memberships N:M e organização como sinônimo de workspace                                                                                                       | Acordada |
| Q26 | Quem pode criar workspace de equipe?            | Qualquer usuário admitido pode criar e se torna owner; sem vínculos GitHub automáticos                                                                                                                                                                      | Acordada |
| Q27 | Owner/member bastam inicialmente?               | Owner governa membros/conexões; member lê recursos autorizados. Admin delegado posterior por necessidade; Q22 vale para todos                                                                                                                               | Acordada |
| Q28 | Como entrar em equipe?                          | Convite explícito aceito pela identidade autenticada alvo; sem entrada por domínio de email ou membership GitHub. Identificação/canal confirmados depois em Q32                                                                                             | Acordada |
| Q29 | Qual cardinalidade de instalação/workspace?     | Várias instalações por workspace; cada instalação vinculada a um único workspace inicialmente, sem compartilhamento/transferência silenciosa                                                                                                                | Acordada |
| Q30 | Qual janela para reconhecer revogação?          | Sessão/membership locais revalidadas na próxima request, sem cookie cache de sessão; grants GitHub em cache por até 60 s e invalidação por eventos recebidos. Desconhecido/expirado sem confirmação é negado; browser parado não tem apagamento instantâneo | Acordada |

Respostas do responsável: **Q25–Q30 — Concordo**, além da confirmação explícita
sobre usuário, workspace, organização e permissões por workspace. Modelo de
produto acordado não equivale a schema nem a política implantada. Não adotar
cargos globais, Teams/SSO corporativo ou grants privados por convite.

## Árvore consolidada após Q1–Q34

| Ramo                              | Estado da decisão                            | Próximo trabalho                                                                                        |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Produto, topologia e leitura      | Fechado por Q1/Q2/Q5–Q8/Q12/Q13/Q21          | Contrato agregado, projeção durável, paginação e prova da busca D1; sem histórico/backfill              |
| Cliente e frescor                 | Fechado por Q8/Q9/Q30                        | Queries no app; SSR hidrata; leituras explícitas; revisão de cache e cancelamento sem polling           |
| Identidade e tenancy              | Fechado por Q17–Q18/Q22–Q30                  | Integrar User/provider/Workspace/Membership; validar autoridade local e GitHub em SSR/API               |
| Convites e ownership              | Fechado por Q32/Q33                          | Convite por email via Cloudflare; múltiplos owners; proteção concorrente do último                      |
| Conexão GitHub                    | Fechado por Q29/Q31                          | Provar owner Holon e titular pessoal/owner GitHub da org; não aceitar só leitura ou posse de ID         |
| Entrega de onboarding             | Fechado por Q34                              | Self-service mínimo confirmado; implementar somente os fluxos descritos nesta fatia                     |
| Banco, contratos e segurança HTTP | Desenho/prova técnica                        | Boundaries auth/db, constraints/migrations, D1, cookies/CSRF/origens e reauth conforme ações aprovadas  |
| Qualidade e performance           | Critérios fechados por Q3/Q4/Q10/Q11/Q14/Q15 | Implementar gates e matriz; medir referência; derivar budgets da prova, sem números inventados          |
| Idiomas e preferências            | Fechado por Q16/Q19/Q20                      | Provar candidato i18n, catálogos completos e SSR/browser com escolhas idênticas                         |
| Preview e promoção                | Trabalho técnico antes da publicação         | Isolar dados/credenciais; confirmar domínios reais; rollout e recuperação com schema/artefato revisados |
| SSE, analytics e ações de review  | Evolução fora da primeira fatia              | Debater ao existir necessidade; não manter como lacuna bloqueante desta entrevista                      |

Escolhas técnicas e provas não são perguntas de preferência sobre cada arquivo,
API ou parâmetro. As respostas explícitas fecharam a fronteira de produto;
a consolidação técnica abaixo não inicia implementação. Provas pendentes,
configuração de ambiente e contratação/recursos não se tornam fatos por essa concordância.

Um cenário de teste: filtro A inicia consulta lenta, o usuário muda para B e
troca de workspace; resposta A chega depois. A UI deve preservar escopo e intenção
atuais. Comandos de onboarding que forem incluídos precisam tratar timeout,
repetição e concorrência sem presumir ausência de efeito nem rollback remoto
por cancelamento do request. A leitura de reviews continua sem comandos.

## Rodada 6: acordada em 2026-10-04

O responsável respondeu **Concordo** a Q31–Q34 e indicou o serviço Cloudflare
para envio em Q32. Estas escolhas tratam políticas de produto; a etapa atual
permanece documental, sem autenticação, binding ou envio implementado.

| ID  | Pergunta                                              | Escolha confirmada                                                                                                                                       | Estado   |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q31 | Quem pode vincular a instalação inteira ao workspace? | Owner do workspace Holon e titular pessoal ou owner ativo da organização GitHub; admins de repo/delegados ficam para evolução própria                    | Acordada |
| Q32 | Como identificar e entregar o convite?                | Email destinatário verificado e envio automático via Cloudflare Email Sending; não fundir identidades por email igual                                    | Acordada |
| Q33 | Pode haver vários owners?                             | Sim, por promoção explícita de membro. Pelo menos um owner ativo; bloquear saída/remoção/rebaixamento do último, inclusive em corrida; pessoal exclusivo | Acordada |
| Q34 | Onboarding será self-service na primeira entrega?     | Sim: login/pessoal, criar/selecionar equipe, gestão de membros/convites e conexão GitHub. Reviews continuam somente leitura                              | Acordada |

### Fatos que sustentam as recomendações

Fontes primárias conferidas em **2026-10-04**. O GitHub alerta que
`installation_id` na [setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
pode ser falsificado. A [lista de instalações acessíveis](https://docs.github.com/en/rest/apps/installations#list-app-installations-accessible-to-the-user-access-token)
inclui leitores de repositório; acessibilidade não comprova poder de vincular
uma instalação inteira. Q31 é restrição inicial de produto confirmada: o GitHub também
permite [instalação por admins de repo sob condições](https://docs.github.com/en/enterprise-cloud@latest/apps/using-github-apps/installing-a-github-app-from-a-third-party#requirements-to-install-a-github-app).

A [lista paginada de memberships do usuário autenticado](https://docs.github.com/en/rest/orgs/members#list-organization-memberships-for-the-authenticated-user)
é candidata para verificar owner ativo da org com token de usuário GitHub App.
A fonte lista esse token sem permissões adicionais; GETs pontuais de membership
têm requisitos distintos. Conferir IDs/role/estado e comportamento real antes
de prometer integração ou ampliar permissões. O client atual de instalação/
permissão por repo não fornece essa prova de gestão humana.

[Better Auth Organization](https://better-auth.com/docs/plugins/organization)
documenta convites por email, sessão com email correspondente na aceitação e
callback próprio para enviar. O Holon precisará provar email verificado do alvo
na combinação selecionada; email ausente/divergente no GitHub precisa de UX
explícita. Não confundir prova de destinatário do convite com fusão de identidades.
GitHub ID + link é alternativa possível de produto, mas não integração nativa
já demonstrada. Q32 escolheu email via Cloudflare; não implementar a alternativa
por GitHub ID. Requisitos, preço e discrepância estão na
[pesquisa de Email Sending](../research/2026-10-04-dashboard-authentication-discovery.md#cloudflare-email-sending-condições-e-discrepância--2026-10-04).

Reauth de gestão, origens/CSRF, callback com intenção vinculada a usuário/espaço,
expiração/cancelamento/repetição de convite e unicidade concorrente são trabalho
técnico da fatia escolhida. Não presumir transação genérica ou proteção automática
de último owner no plugin. Recuperação de provider usa o fluxo do provider;
nenhum bypass operacional de identidade foi aprovado. Exclusão de conta/workspace,
transferência de instalação, billing, novos providers e SSO corporativo ficam
para escopo próprio, sem implementação implícita nesta entrevista.

## Plano técnico de provas antes da implementação

Esta sequência transforma as políticas acordadas em uma composição revisável.
Não é autorização de login real, email, migration, DNS, deploy ou publicação.
Origens/remetente/recursos reais serão confirmados no preparo do ambiente; não
adotar placeholders do admin retirado como configuração do dashboard.

| Etapa                        | Resultado revisável                                                                                                                                                                         | Evidência exigida                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Composição e contratos    | Worker dashboard próprio; fronteiras SSR/API; capacidade estreita de leitura do core; exports/imports browser/server; proposta de ADR quando houver mudança de arquitetura vigente          | Grafo e gates preservados; app/TSX/subpaths cobertos; SSR compõe casos de uso, API reutiliza política e contratos                                 |
| 2. Identidade e persistência | Versões compatíveis Better Auth/adapter/Drizzle/D1; tenancy própria candidata; constraints de memberships/owners/instalações; schemas e migrations com dono único                           | Prova Workerd/D1, falha User/Account e callbacks repetidos, concorrência e transições condicionais; não presumir transações SQL genéricas         |
| 3. Sessão e autorização      | Cookies/origens/CSRF, renovação, logout atual/todos, reauth de gestão e grants GitHub; escopo explícito por workspace/aba                                                                   | Negação por identidade/membership/repo alheio, cache GitHub ≤60 s, revogação local próxima request, fonte GitHub indisponível sem concessão       |
| 4. Onboarding e convites     | Provisionamento pessoal idempotente, equipe, convite email verificado, promoção de owner e vínculo exclusivo com prova GitHub; sender Cloudflare por porta servidor e adapter de transporte | Aceite por alvo, expiração/revogação/repetição, último owner sob corrida, vínculo forjado/conflitante negado; teste local sem email real          |
| 5. Lista e detalhe           | Projeção mínima D1 com revisão ordenável, entrega durável/idempotente e reconciliação; agregado autoritativo no ledger; metadados próprios sem disparar review                              | Falha/reordenação/recuperação, busca número exato/título sem caixa/acentos, planos/rows lidas/escritas, sem N chamadas DO/GitHub por linha        |
| 6. UI e prova de entrega     | Query no app, hidratação/refresh explícitos, pt-BR/en, marca/motion, estados de acesso/erro/vazio e suporte browser                                                                         | Matriz crítica bilíngue nos 3 engines, DOM/Workers/browser, WCAG/motion/foco, fixture e perfis aprovados; build/dry-run separados de smoke remoto |

A prova de persistência deve comparar D1 de auth/tenancy e projeção no mesmo
banco versus bancos separados, considerando consistência de autorização,
escritas da projeção, permissões de bindings e recuperação. `packages/db` é
a fronteira de implementação, não a obrigação de um único banco. Selecionar
composição física e plano de migração antes de gerar/aplicar schema; Q5 não
é benchmark de todas as alternativas de banco.

### Rodada adicional de email: Q35/Q36 acordadas

O responsável respondeu **Q35 — Concordo** e **Q36 — melhor opção robusta com
fila, retries e etc.**, e autorizou continuar as investigações. Isso supera a
recomendação anterior de esperar envio/reenvio explícito sem Queue.

| ID  | Escolha confirmada                                                                                                                     | Estado            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Q35 | Worker privado `apps/email-delivery`, aplicação dona da política/ciclo do convite e sender dono de templates/transporte                | Acordada          |
| Q36 | Fila e retries duráveis desde a primeira entrega, independentes da request; obrigação de publicação recuperável e tratamento de falhas | Direção corrigida |

A [investigação de entrega](../research/2026-10-04-dashboard-email-delivery-investigation.md)
propõe convite+outbox no mesmo D1, publisher recuperável, Queue de IDs, consumer
com claim/contexto autorizado e resultado persistido antes de ack individual.
Só `Queue.send()` depois de salvar convite não garante recuperação após crash.
DLQ tem retenção limitada e não substitui registro da falha no D1.

### Resultado da investigação e política Q37

As investigações distinguiram capacidade documentada, fonte publicada e prova
local de composição realmente operante. Q35/Q36 não autorizam criar recursos,
enviar email, migrar banco ou implementar auth nesta etapa de pesquisa.

| Frente         | Conclusão / direção técnica                                                                                                                   | Evidência e próxima prova                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Auth e tenancy | Better Auth para User/account/session; workspaces/memberships/convites Holon próprios são a recomendação, sem plugin organization obrigatório | Plugin/source não garantem atomicidade D1; validar callbacks parciais, guards SQL e batches no runtime                       |
| Persistência   | Dois D1 candidatos: identidade+tenancy+convite/outbox juntos; projeção funcional separada                                                     | Separação por responsabilidade/contenda, não benchmark; provar operação e recuperação sem transação entre bancos             |
| GitHub         | User access token GitHub App; owner org por membership list paginada e grant por repos acessíveis no installation scope                       | Fontes documentadas; provar login/refresh/email e org privada antes de adoção                                                |
| Lista/detalhe  | Revisão por PR e obrigação coalescida com alarm; UPSERT por revisão; detalhe agregado restrito                                                | Experimento SQLite sintético confirma índices/contains/reordenação; atomicidade alarm/Workerd/Cloudflare continuam pendentes |
| Email          | Convite+intenção atômicos, recuperação de publicação, claim, ack individual, DLQ e classificação de falhas                                    | Sem idempotency key externa demonstrada; preview pode capturar conteúdo por padrão; próximo trade-off abaixo                 |

Detalhes estão nos relatórios de [auth/persistência](../research/2026-10-04-dashboard-auth-persistence-investigation.md),
[leitura/autorização e artefatos SQLite](../research/2026-10-04-dashboard-read-model-investigation.md)
e [entrega de emails](../research/2026-10-04-dashboard-email-delivery-investigation.md).
Não acrescentar versões ou parâmetros como perguntas de produto; selecionar e
provar tecnicamente antes de instalar dependências ou alterar requisitos.

**Q37 — Resultado de envio desconhecido — acordada em 2026-10-04:** após provider
aceitar e antes do registro durável, um crash pode deixar dúvida se o convite
foi enviado. O responsável confirmou retry automático limitado da mesma intenção,
aceitando possível mensagem duplicada; nenhum novo convite ou membership.
A alternativa de intervenção manual nesses casos não foi escolhida. Não
generalizar a política para futuros emails financeiros ou outros cenários.

Os candidatos de i18n e as versões das bibliotecas serão fixados com a composição
real; a pesquisa não instala dependências por estar no radar. Reauth por ação,
expiração/reenviar convite, contratos de erro e limites técnicos serão explicitados
na prova, sem inventar capacidades de produto. Não gerar código para simular
conclusão desta fase de documentação.

A integração de email deve comprovar sender no domínio configurado, envio a
novos destinatários e distinção entre aceitação e entrega. Desenvolvimento/CI
usa adapter fake ou simulação sanitizada; bindings remotos enviam emails reais
e exigem escopo operacional autorizado. Beta, requisitos e divergência das fontes
permanecem registrados até o smoke focado. Se a composição não satisfizer a
política, apresentar a limitação antes de substituir serviço ou ampliar escopo.

Domínios, DNS/remetente, disponibilidade/quota da conta e credenciais são
pré-requisitos do preparo operacional, não perguntas de domínio ainda abertas.
SSE, analytics, feedback/rerun/configuração de reviews, outros providers, SSO
corporativo, billing, apagar conta/workspace e mover instalação entre espaços
permanecem para necessidade e escopo posteriores.

## Trabalho obrigatório já identificável

Adequar o checker às novas fontes/exports e comprovar isolamento do bundle
cliente é trabalho de engenharia decorrente da topologia adotada, não uma
pergunta sobre querer organização. Não criar agora novos workspaces ou liberar
imports de pacotes inexistentes. A implementação deve exercitar rejeições reais
para as regras e manter os checks do core.

O método foi leitura de docs/manifests/código e fontes primárias/publicadas,
com explorações factuais delegadas e experimento SQLite local sintético de busca,
índices e ordenação da projeção. Não foram executados testes do Holon, benchmark
Cloudflare, login, migration, build, deploy ou operação remota. Formatação e links do
registro são verificações documentais, não prova do dashboard.

## Ajustes após a revisão completa de robustez — 2026-10-04

O [plano consolidado](dashboard-implementation-plan.md) substitui a sequência
resumida acima como entrada para execução. O [relatório](../research/2026-10-04-dashboard-plan-robustness-review.md)
registra correções de auth/session DTO, batch guard, refresh perdido, vigília de
jobs publicados, alarm, snapshot/restore, ponte SSR/Query e redução de movimento.
O candidato auth não pode avançar como integração pronta até comprovar cadastro
interrompido recuperável por novo OAuth, sem reutilizar state/code consumidos.

Essas condições técnicas não reabrem políticas de produto acordadas. MVP reduz
funcionalidades, não aceita identidade, autorização, recuperação ou teste como
refatoração posterior. Os resultados das verificações desta revisão ficam no
relatório; não se confundem com o método/evidência das rodadas históricas.
