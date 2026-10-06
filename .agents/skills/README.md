# Skills do projeto

Estas skills seguem o formato aberto Agent Skills e são descobertas pelo Codex
em `.agents/skills/`. São carregadas sob demanda: escolha as que se aplicam à
tarefa em vez de carregar todo o catálogo. As cópias preservam o conteúdo
upstream, exceto adaptações documentadas abaixo; confirme dependências e
instruções específicas do host antes de executar fluxos externos. As origens
anteriores foram verificadas em 2026-09-28; as skills de engenharia foram
revisadas em 2026-10-03; a skill própria de dashboard foi adicionada em 2026-10-04.

## Qual skill usar

### Engenharia de backend e runtime

| Cenário | Skill | Como usar |
| --- | --- | --- |
| Desenhar ou revisar a interface de um módulo | `codebase-design` | Use o vocabulário de módulo, interface e seam; confirme o grafo e os ADRs do Holon antes de criar uma porta. |
| Construir comportamento novo ou corrigir bug com TDD | `tdd` | Um teste comportamental que falha por vez, seguido da menor correção. A skill depende de `codebase-design` e remete a arquivos `tests.md` e `mocking.md` incluídos. |
| Planejar, implementar ou revisar o dashboard dos usuários | [`dashboard-engineering`](dashboard-engineering/SKILL.md) | Localize decisões e fontes donas; verifique segurança, recuperação e testes sem assumir runtime existente ou reabrir Q1–Q37. |

Para princípios recorrentes de TypeScript, padrões e anti-padrões, consulte
[`docs/engineering/typescript-and-module-design.md`](../../docs/engineering/typescript-and-module-design.md).
Para Cloudflare, GitHub, AI SDK, Workflows, estado e operação, consulte o
[guia de runtime](../../docs/engineering/runtime-and-integrations.md).
Essas referências não são skills executáveis: devem refletir o runtime
vigente e apontar para APIs oficiais atuais.

`find-skills` está disponível no ambiente do agente para descoberta; não é
dependência do repositório. A skill externa `implement` foi avaliada e não
incluída: pressupõe `code-review`, configuração de issue tracker e commit
automático. `typescript-advanced-types` também não foi incluída: cobre
técnicas genéricas com exemplos de `any`, sem orientar a validação runtime e o
grafo de dependências do Holon. `improve-codebase-architecture` já existe no
ambiente local, mas seu fluxo de relatório HTML, subagentes e entrevista não
é requisito para mudanças comuns do projeto.

### Design e implementação de UI, quando houver uma tarefa nessa área

A ADR-0053 materializa fundações locais de `apps/dashboard` e `packages/ui`.
O admin permanece retirado pela ADR-0040. As skills abaixo apoiam trabalho de UI,
sem substituir tokens, contexto do produto, ADRs ou prova de comportamento.

| Cenário | Skills recomendadas | Como usar |
| --- | --- | --- |
| Procurar padrões reais antes de desenhar uma tela ou fluxo | `ui-radar` | Pesquise exemplos comparáveis e extraia padrões relevantes para o produto; trate referências como inspiração, não como especificação. |
| Criar, redesenhar ou melhorar uma interface | `ui-design` + `anti-ui-slop` | Use `ui-design` para orientar a exploração, composição e implementação. Use `anti-ui-slop` para firmar uma direção específica do produto, cobrir estados e revisar o acabamento. |
| Organizar colunas, margens e gutters de uma página | `layout-grid` | Defina a grade e os breakpoints estruturais antes de ajustar o espaçamento interno dos componentes. |
| Definir ou reorganizar cores, espaçamento, tipografia e elevação | `design-token` | Use quando houver uma camada de UI e tokens reais para revisar. |
| Fazer a mesma UI funcionar em telas e métodos de entrada diferentes | `responsive-design` | Revise layouts e interações para tamanhos de tela, toque, teclado e demais contextos aplicáveis. Combine com `layout-grid` quando a estrutura da grade também mudar. |
| Estabelecer ordem de leitura numa nova composição | `visual-hierarchy` | Defina onde o olhar deve chegar primeiro e ajuste escala, peso, cor, espaço e posição. |
| Diagnosticar hierarquia visual numa tela existente | `critique-visual-hierarchy` | Avalie ponto de entrada, percurso do olhar, distribuição de peso e ênfase a partir da tela renderizada. |
| Auditar acessibilidade de uma interface existente | `accessibility-audit` | Faça uma auditoria com achados priorizados e passos de correção; complemente com testes comportamentais quando a tarefa exigir. |
| Conferir código UI contra regras web atuais | `web-design-guidelines` | Faça uma revisão final por arquivos ou padrões. A skill busca as regras atuais antes da auditoria; requer acesso à URL indicada em `SKILL.md`. |
| Criar ou revisar um mascote/personagem de marca | `ip-as-logo` | Use apenas quando a tarefa pedir um personagem visual; a skill é focada em imagens quadradas simples, não em ícones funcionais ou no sistema de UI. |

### Engenharia, revisão e segurança

| Cenário | Skill | Observação |
| --- | --- | --- |
| Revisar um PR antes de integrar | `review` | Revisão pré-integração; mantenha os critérios de arquitetura e os contratos do Holon como autoridade. |
| Validar fluxos de uma aplicação web | `qa` | Use em tarefas de QA; confirme os requisitos de browser e ferramentas externas descritos pela própria skill. |
| Avaliar riscos de segurança | `cso` | Auditoria de segurança; o nível de profundidade pode depender da configuração e dos recursos gstack disponíveis. |
| Revisar um plano técnico como liderança de engenharia | `plan-eng-review` | Use para desafiar escopo, sequenciamento, riscos e critérios de conclusão antes de implementar. |

## Fluxo recomendado se houver uma UI no Holon

1. Consulte a tela ou rota existente e seus padrões/tokens reais, se houver.
2. Para uma tela nova ou um redesenho, use `ui-radar` para buscar referências;
   então `ui-design` e `anti-ui-slop` para orientar e criticar a solução.
3. Aplique apenas as skills estruturais necessárias: `layout-grid`,
   `visual-hierarchy`, `design-token` ou `responsive-design`.
4. Depois de implementar, valide a interface nos estados e tamanhos relevantes;
   use `accessibility-audit` e `web-design-guidelines` quando o escopo incluir
   revisão de acessibilidade ou conformidade geral.

Não trate recomendações genéricas como motivo para ignorar o sistema visual ou
os contratos já adotados no produto. Não aplique várias skills redundantes à
mesma pergunta: comece pela skill cujo cenário corresponde ao trabalho e traga
as demais apenas quando cobrirem outra dimensão.

## Origens e licenças

| Skills | Origem | Licença / notas |
| --- | --- | --- |
| `dashboard-engineering` | Autoria do projeto Holon | Guia curto de contexto; sem conteúdo upstream copiado ou dependências externas. Aponta para os documentos canônicos da evolução proposta. |
| `ip-as-logo` | [s1dashu/ip-as-logo-skill](https://github.com/s1dashu/ip-as-logo-skill) | MIT; licença incluída na pasta da skill. |
| `review`, `qa`, `cso`, `plan-eng-review` | [garrytan/gstack](https://github.com/garrytan/gstack) | MIT; aviso em `LICENSES/gstack-MIT.txt`. Algumas rotinas dependem de setup, scripts, browser ou outros hosts que não são instalados junto com a cópia. |
| `layout-grid`, `responsive-design`, `visual-hierarchy`, `design-token`, `accessibility-audit`, `critique-visual-hierarchy` | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills) | MIT; aviso em `LICENSES/designer-skills-MIT.txt`. Skills individuais autocontidas selecionadas da coleção. |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | Skill importada do upstream; as regras da auditoria são buscadas de [web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) a cada uso. O repositório de skills não apresenta arquivo de licença na raiz consultada; confira os termos upstream antes de redistribuir ou alterar a cópia. |
| `ui-design`, `ui-radar`, `anti-ui-slop` | [uizze/uizze](https://github.com/uizze/uizze/tree/main/skills) | Skills UIZZE incluídas nesta atualização. `ui-design` e `anti-ui-slop` preservam os avisos e metadados de licença distribuídos com a cópia; `ui-radar` contém somente o `SKILL.md`, então confira os termos no upstream antes de redistribuir. |
| `codebase-design`, `tdd` | [mattpocock/skills](https://github.com/mattpocock/skills) em `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` | MIT; arquivos auxiliares e aviso em `LICENSES/mattpocock-skills-MIT.txt`. `tdd/SKILL.md` foi adaptada para o glossário e o fluxo de decisão do Holon. |

Ao atualizar uma skill, confira a estrutura, o conteúdo, as dependências e os
termos de licença no upstream. Atualize este guia quando o conjunto ou o fluxo
de escolha mudar.
