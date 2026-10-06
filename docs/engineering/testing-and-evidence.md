---
id: ENGINEERING-TESTING-EVIDENCE
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-06
---

# Testes e evidência de entrega

Escolha testes pelo comportamento observável e pelo limite capaz de falhar por
seu motivo real. Para correção comportamental, reproduza o defeito primeiro;
para capacidade nova, avance em fatias verticais. Um teste que refaz a mesma
fórmula do código ou verifica apenas chamadas a colaboradores internos não
prova o contrato. Consulte a skill [`tdd`](../../.agents/skills/tdd/SKILL.md)
quando desenvolvimento guiado por testes ajudar a tarefa.

## Escolha por responsabilidade

| Mudança                                                   | Teste principal                                                                                                   | Falhas que merecem atenção                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Identidade, lifecycle, fingerprint e veredito em `domain` | Teste puro de casos e estados.                                                                                    | Estados inválidos, repetição e casos limítrofes.                             |
| Caso de uso ou porta em `application`                     | Comportamento pela interface pública com adapters controlados no limite externo.                                  | Output parcial, ordem adversa, negação e efeito duplicado.                   |
| Schema em `contracts`                                     | Parse de exemplo válido e rejeição de entrada inválida; serialização quando persistido/enfileirado.               | Campos desconhecidos, tamanho, versões retiradas e dados hostis.             |
| Diff, configuração e identificação de projetos            | Fixtures pequenas e verificáveis com resultado independente.                                                      | Paths, symlink/lockfile, formatos malformados, omissão e limite de recursos. |
| GitHub, modelo ou executor                                | Teste do adapter e do contrato em seu limite; para Sandbox, incluir Workerd/fixture de comando quando necessário. | Credencial, timeout ambíguo, resposta truncada, egress, escopo e retry.      |
| Queue, Workflow, ledger ou serviço de Worker              | Plugin Vitest oficial para Workers, exercitando bindings, persistência e RPC quando envolvidos.                   | Redelivery, concorrência, supersession, eviction/retry e cleanup terminal.   |
| CLI e schema de editor                                    | Invocação local do comando e comparação com o compilador de configuração.                                         | Drift de schema, erro de entrada e código de saída.                          |
| Avaliação de review                                       | Corpus, recordings, graders e adapter live somente quando autorizado.                                             | Findings falsos/omitidos, cobertura e mudança de modelo/prompt.              |

Os testes concretos ficam em `apps/*/test`, `packages/*/test` e
`tooling/config-cli/test`. O teste de direção de imports fica em
`tooling/architecture` e verifica também ciclos de imports relativos; roda por
`pnpm test:architecture`, `pnpm test` e `pnpm test:coverage`. O control plane
usa a configuração Vitest Workers;
o executor possui testes Node e `vitest.worker.config.ts`. Consulte os scripts
de cada `package.json` antes de escolher comando filtrado.

## Regras de prova

1. Derive o esperado de contrato, exemplo trabalhado ou fixture independente,
   não do mesmo algoritmo sob teste. Mocks servem para limites externos;
   preserve o caminho real interno quando ele é o alvo.
2. Em fronteira de confiança, teste operação permitida e rejeição de entrada
   ou autoridade inválida. Em estado durável, teste repetição e reordenação.
3. Não introduza código de produção, wrappers ou novos exports só para testar
   uma função privada. Prefira a interface observável do módulo.
4. Mantenha testes significativos de regressão; não reduza limiares de
   cobertura, exclua produção do cálculo ou remova falhas para obter verde.
5. Para healthchecks, separe liveness, presença dos bindings atuais e prova de
   disponibilidade remota. Um binding antigo não satisfaz o contrato vigente;
   teste a configuração esperada e a rejeição de aliases retirados.
6. Teste local de modelo com mock não mede qualidade de review. Use
   [avaliações](../operations/evaluations.md) para corpus e live manual,
   distinguindo sua evidência de integração GitHub/Cloudflare real.

## Comandos e escopo

Na raiz, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm test:coverage`, `pnpm build` e `pnpm verify` são os scripts oficiais.
`pnpm verify` inclui validação de configuração, cobertura e build. O build é
local, mas precisa de Docker para a imagem do Sandbox. Para mudança focada,
execute primeiro o script do workspace afetado e amplie quando a integração
atravessar pacotes/deployables. Os exemplos e pré-requisitos estão em
[desenvolvimento local](../operations/local-development.md).

| Evidência                         | O que demonstra                                   | Limite                                                    |
| --------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Teste puro, lint e typecheck      | Contratos e invariantes exercitados localmente.   | Não provam binding Workerd ou recurso remoto.             |
| Vitest Workers/DO                 | Composição local do runtime e estado exercitados. | Não prova GitHub App, conta Cloudflare ou provider reais. |
| Bundle, imagem e Wrangler dry-run | Artefatos construídos localmente.                 | Não é deploy nem smoke remoto.                            |
| Corpus offline                    | Resultado nos casos e recordings versionados.     | Não mede comportamento em PR privado real.                |
| Smoke remoto autorizado           | Caminho específico com integrações reais.         | Não substitui regressão, cobertura ampla ou produção.     |

Relate comandos, sucesso/falha, ambiente e o que ficou sem prova. Não declare
CI, publicação ou produção validados a partir de um gate local.

## Dashboard: critérios acordados para implementação futura

A [rodada 1 da entrevista](../planning/dashboard-engineering-decision-review.md#rodada-1-decisões-acordadas-em-2026-10-04)
confirmou estes critérios em **2026-10-04** para lista/detalhe por repositório
autorizado no futuro Worker `apps/dashboard`:

- Chrome/Edge, Firefox e Safari nas duas versões estáveis mais recentes;
  Safari iOS e Chrome Android. Registrar versões/plataformas efetivamente
  exercitadas; declaração de suporte não é resultado de CI.
- Alvo [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/), com critérios Holon de
  teclado, foco, zoom a 200%, 320 px, textos longos e movimento reduzido.
  Checks automáticos de contraste/tokens não comprovam conformidade completa.
- PRs de implementação devem passar formatação/lint/types, prova de comportamento
  e contratos, direção de imports, isolamento servidor/cliente, marca/tokens/
  contraste e fluxos críticos em browser. Cada novo comportamento acompanha
  sua evidência no mesmo PR, sem esperar uma fase posterior de QA.
- Preservar os limiares atuais nas camadas instrumentadas; cobertura numérica
  não substitui prova de interação, hidratação e navegação. Não mudar a config
  Node global para acomodar UI.

M1 implementa marca/contraste em `verify`, scanner AST src/app/workers com
fixtures negativas TSX/aliases/subpaths/servidor e configs Node/DOM/Workers/browser.
A [arquitetura](../architecture/user-dashboard.md) e o
[registro da fundação](../research/2026-10-06-dashboard-foundation-results.md)
separam o que esses gates provam dos cenários privados ainda futuros. O wildcard
404, idiomas, preferências e componentes mínimos exercitam o artefato real.

A primeira prova deve exercitar a composição real com fixtures sintéticas
e limites externos controlados: HTML inicial e hidratação sem duplicação
involuntária, filtros/respostas fora de ordem, refresh manual sem perda de foco,
resultado parcial versus completo, vazio versus falha e movimento interrompido.
Usar controle explícito das respostas, sem sleeps arbitrários. Identidade
sintética fica no harness de teste, sem endpoint/cookie de bypass no artefato
de produção; essa prova não valida Better Auth. Cenários reais de sessão e
autorização entram depois do debate de autenticação.

A referência WCAG foi conferida em 2026-10-04. Não foram implementadas configs,
suites, autenticação ou deploy nesta etapa documental.

A [prova OAuth ampliada em 2026-10-05](../research/2026-10-05-dashboard-oauth-security-requirements.md)
exige observar challenge S256 distinto e verifier correspondente no request
nativo, negar injeção de code de outro fluxo com state/cookie válidos e explicitar
a premissa de rejeição de downgrade do provider. Contar token requests por code
nos callbacks concorrentes: uma sessão final não prova que o cliente não repetiu
a troca. O fake valida o limite externo; não comprova comportamento remoto.
Manter diagnósticos e gate de viabilidade distintos, sem inverter a expectativa
normativa quando o candidato falha. Depois de aprovar a composição, incluir
seus asserts de viabilidade nos comandos normais de teste/cobertura e na CI.
A [reserva de code aprovada em M0](../research/2026-10-05-dashboard-code-redemption-plugin.md)
exige também instâncias independentes, novo state, resultado D1 ambíguo/falho,
resposta externa perdida, retenção e manutenção limitada. Conservar a reprodução
sem plugin como baseline explicitamente identificado, nunca como fallback.

## Dashboard: direção de teste após Q8/Q10/Q11

Em 2026-10-04 foram confirmados DOM + browser e a cadência. A engenharia
deriva esta composição, materializada na fundação M1 para os comportamentos já implementados:

| Responsabilidade                                 | Composição                                                        | Cadência                                     |
| ------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------- |
| Regras/apresentação/contratos puros              | Vitest Node atual                                                 | PR correspondente                            |
| Componentes/interação/semântica                  | Vitest + React Testing Library/user-event + jsdom, config própria | PR correspondente                            |
| Bindings/handlers/loaders/DO/D1                  | Vitest Workers, config própria                                    | PR correspondente                            |
| SSR/hidratação/navegação/foco/layout/motion      | Playwright Test, Chromium/Firefox/WebKit                          | Crítico por PR; amplo em main/pré-publicação |
| Problemas acessíveis detectáveis automaticamente | axe no Playwright, em estados reais exibidos                      | Junto ao fluxo browser                       |

Safari/mobile reais e versões suportadas complementam a automação na primeira
publicação e nas mudanças que afetem seus componentes/fluxos. Registrar
plataforma/versão e limitações; emulação não prova dispositivo real, e axe
não substitui avaliação humana. A promoção aguarda matriz ampla completa.

Bibliotecas de teste são devDependencies de quem executa a suite, com versões
centralizadas. Sem wrappers de ferramentas em packages próprios. Manter
includes/configs independentes para Node, DOM, Workers e browser. O catálogo
atual usa Vitest 4; consultar [documentação v4](https://v4.vitest.dev/guide/environment)
na prova, sem copiar configuração da linha latest por acidente.

Browser exercita o build real servido localmente. Usar fixtures sintéticas
independentes e condições observáveis; controlar respostas fora de ordem.
Padrão inicial: zero retries, timeout explícito, trace/screenshot retidos na
falha; relatório/JUnit e evidência sintética por 7 dias, alinhados à retenção
atual de CI. Não reexecutar job para esconder falha. Uma repetição diagnóstica
futura deve continuar falhando o gate se a primeira execução falhou.

Traces incluem DOM e tráfego: fixtures também usam cookies/headers sintéticos.
Esta política não autoriza captura de sessão real, dados privados ou produção.
Nenhum fluxo de login foi implementado; identidade controlada é limite de teste.

Q8 retirou polling/auto-refresh e a meta de 5 s. Testar refresh manual preservando
conteúdo/foco, falha transitória preservando dado confirmado somente com escopo
ainda autorizado, e limpeza da apresentação/cache privados após 401/403 ou
grant expirado sem confirmação. Resposta ou erro A tardio não pode sobrescrever
nem fechar B permitido; ausência de refetch automático por foco/reconexão
ou duplicação após hidratação. Não testar streams/timers inexistentes. SSE é
evolução com contratos e prova próprios.

Antes da publicação, registrar baseline no build real: bundle comprimido por
rota, tempo até conteúdo útil, SSR/hidratação, latência de filtro/refresh,
rows_read/plano D1 e atraso da projeção. Carga/dispositivo de referência foram
confirmados em Q14/Q15. Cache frio/quente e protocolo precisam ser explícitos; thresholds
vêm da medição e requisito, não de uma corrida CI ou número arbitrário.
Validar o artefato/SHA que será promovido e registrar limitações da prova.

Fontes conferidas em **2026-10-04**: [Testing Library](https://testing-library.com/docs/react-testing-library/intro/),
[user-event](https://testing-library.com/docs/user-event/intro/),
[Playwright acessibilidade](https://playwright.dev/docs/accessibility-testing),
[traces](https://playwright.dev/docs/trace-viewer). Configuração, versão exata,
compatibilidade do build e publicação continuam sem prova de execução.

## Dashboard: bilinguismo e carga de referência acordados

Q14/Q15/Q16 confirmaram, em **2026-10-04**, desktop comum/mobile intermediário
com conexão limitada e **pt-BR + inglês desde o início**. A carga sintética é
10.000 PRs indexados por repositório, páginas de 50 e detalhe com 200 achados
com textos extensos. Não são quotas/limites de produto e não há backfill real.
A UI renderiza a página limitada, não 10.000 rows para substituir paginação.

A matriz crítica passa a ser **pt-BR/en × Chromium/Firefox/WebKit**, usando
o mesmo corpo de teste parametrizado. Acrescentar SSR/hidratação bilíngues,
requests simultâneos de idiomas distintos sem vazamento, preferência pessoal → navegador → inglês
conforme Q19, troca preservando rota/filtro/foco, nomes acessíveis,
plurais 0/1/2 e datas/números com fuso explícito. Resultado parcial e erro/vazio
continuam distinguíveis nos dois idiomas; texto original da análise é preservado.

Catálogo de cada idioma deve estar completo e sincronizado com fonte; fallback
não encobre tradução ausente no gate. Pseudolocalização/texto expandido entra
na suite ampla de layout, sem virar idioma público ou pressupor RTL. Medir
chunks/catálogos e troca de idioma com o build real, frio/quente, nos dois
idiomas; enviar inicialmente somente o necessário para tela/idioma.

Lingui é primeira candidata na pesquisa, ainda sem adoção. Na documentação
Lingui 6 conferida em 2026-10-04, `check sync` e `check missing --mode catalog`
validam sincronização/completude de cada catálogo; `compile --strict` pode
resolver ausência por fallback e não prova sozinho os dois idiomas completos.
[Fonte primária: CLI](https://lingui.dev/ref/cli). Validar comandos na versão
real adotada; não afirmar que há gate/configs instalados.

O perfil físico e parâmetros de rede/throttling precisam ser registrados na
prova. Metas de tempo/bundle vêm de requisito e baseline, não destes números
de fixture; ainda não existe benchmark do dashboard. Q12 confirmou leitura
apenas, então não exigir testes de comandos/forms de review inexistentes.

## Dashboard: escopo SaaS e critérios após Q19–Q30

Q19/Q20 confirmaram preferência de idioma pessoal → navegador → inglês e fuso
pessoal, com UTC explícito até conhecê-lo. Servidor/browser usam locale/fuso
idênticos; request concorrente de outro usuário não muda sua escolha.

Q22 confirmou interseção privada e Q24 sessão móvel; duração da sessão não
prova membership ou grant válido. A prova de auth posterior deve negar leitura
por ID de workspace/recurso alheio, preservar A/B em abas distintas, negar A
após remoção de membership com sessão ainda válida e manter os outros espaços
permitidos. Response antiga após logout/troca não reintroduz conteúdo no cache.

Usar o [modelo acordado](dashboard-identity-and-workspaces.md) como mapa de
responsabilidades, não como prova de isolamento atual. Gates de auth/convite/
provisionamento entram com comportamentos reais após o debate, sem endpoints
de bypass. Q30 exige negar nova leitura após revogação local de sessão ou
membership; grants GitHub podem permanecer em cache por até 60 s. Testar
limite com relógio controlado, invalidação por evento e falha de confirmação
após expiração, sem sleeps de um minuto ou requests reais por teste.
Não declarar apagamento remoto instantâneo do que já chegou ao browser sem SSE.

Provar isolamento de papéis por membership, exclusividade do pessoal, criação
idempotente do pessoal em callback repetido e rejeição de convite para identidade
diferente do alvo. Uma instalação não pode ganhar segundo workspace por corrida
ou repetição de callback. Q31 exige gestão GitHub comprovada: titular pessoal
ou owner ativo da org e owner Holon; não substituir por posse de installation ID,
acesso de leitura à instalação ou login/username informado pelo browser.

### Onboarding e email após Q31–Q34

Q32 usa convite por email verificado, Q33 admite múltiplos owners e Q34 inclui
self-service mínimo. Na futura implementação, provar:

- Duas saídas/rebaixamentos concorrentes não deixam a equipe sem owner; promoção
  não é concedida por aceite de convite comum nem a member sem autoridade.
- Convite não permite entrada com email diferente/não verificado, após revogação
  ou expiração. Aceitação repetida não cria memberships duplicadas. Erro/timeout
  de envio não exige criar outro convite, nem representa ingresso na equipe.
- Convite não transfere instalação, não cria grant GitHub e não funde usuários
  por email igual. Email privado/ausente/divergente no login tem estado explícito.
- Templates pt-BR/en usam marca e HTML/texto, escapam dados externos e geram URL
  somente da origem configurada. Não capturar endereço, conteúdo ou link/token
  de convite em logs/traces do Holon ou artefatos publicados.
- Simular falhas do sender, quotas, rejeição/supressão e resultados ambíguos no
  teste local; aceitação pela API não prova entrega à caixa de entrada.

Q35/Q36 acrescentaram Worker/fila e recuperação automática desde a primeira
entrega. Provar convite+intenção no mesmo commit, crash antes/depois de publicar,
republicação do mesmo ID, consumer concorrente, lease expirado, estado novo durante
I/O e resultado durável antes de ack individual. DLQ/falha persistida, retenção,
quota/supressão e replay obsoleto precisam de cobertura. Sucesso externo sem
registro é resultado desconhecido; não afirmar exatamente uma vez.
A [investigação de entrega](../research/2026-10-04-dashboard-email-delivery-investigation.md)
define as janelas; Q37 aceitou retry limitado da mesma intenção em resultado
desconhecido, com possível mensagem duplicada. Provar que isso não cria convite
ou membership adicionais. A [investigação de auth/D1](../research/2026-10-04-dashboard-auth-persistence-investigation.md)
acrescenta falha User/Account, refresh concorrente e cookies SSR às condições de prova.

### Provas de robustez antes de iniciar a entrega

O [plano consolidado](../planning/dashboard-implementation-plan.md#matriz-mínima-de-regressão)
liga as garantias aos cenários e fronteiras. Exercitar interrupção após cada
commit/efeito externo, mensagem/revisão fora de ordem, zero rows na guarda,
outage além da retenção/retries nativos, lease antiga com sucesso e restore
com entrega antiga em trânsito. Fakes controlam o limite externo; a transição
de D1/DO e a composição de handlers permanecem reais no runtime de teste.

Para auth, distinguir repetição de operação de negócio de replay de credencial:
state/code OAuth consumidos são rejeitados; cadastro interrompido deve recuperar
por **novo fluxo OAuth**, sem órfão bloqueante ou User duplicado. A
[política de linking ajustada em 2026-10-05](dashboard-identity-and-workspaces.md#vinculação-por-email-verificado-ajuste-aprovado-em-2026-10-05)
permite o vínculo nativo por mesmo email verificado no provider e no User local;
provar ambos os casos negativos e estabilidade do User para Account já vinculada.
Aceite repetido de convite não funde usuários nem recria membership removida.
Testar respostas auth reduzidas, métodos/paths não expostos, cookies/CSRF,
conteúdo hostil em SSR/Markdown e nonce no build. As regras estão no
[guia de segurança web](web-security-and-data-boundaries.md).

A fundação M1 implementa fixtures negativas para imports server no cliente,
internals de rota/feature, subpaths/aliases, `.js`→`.tsx` e ciclos, além do caminho
permitido. O build inspeciona as identidades dos módulos dos chunks cliente:
grafo TypeScript verde não prova que SDKs de servidor desapareceram do artefato.
Cada novo export, alias ou fronteira precisa ampliar essas provas na mesma mudança.

Teste local usa sender fake controlado; não enviar email para validar CI.
Prova remota de Email Sending precisa de autorização própria, domínio configurado,
remetente restrito e destinatário de teste fora da lista verificada da conta.
Registrar aceitação e entrega separadamente; a discrepância das fontes está na
[pesquisa](../research/2026-10-04-dashboard-authentication-discovery.md#cloudflare-email-sending-condições-e-discrepância--2026-10-04).
Nenhum email real foi enviado nesta etapa.

## Fontes verificadas em 2026-10-03

- [Cloudflare: integração Vitest para Workers](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Cloudflare: regras de Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)

## Dashboard: comandos da fundação M1

| Camada             | Configuração/comando dono                              | Evidência                                                                                                  |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Contratos e portas | `pnpm --filter @holon/contracts test:coverage`         | DTOs strict, estados/IDs/páginas e erros sem segredo                                                       |
| Node               | `apps/dashboard/vitest.config.ts`                      | negociação, Intl e headers/CSRF/limites puros                                                              |
| DOM                | `pnpm --filter @holon/ui test:coverage`                | controles/semântica e eventos via user-event; foco nativo exige browser                                    |
| Workerd HTTP       | `pnpm --filter @holon/dashboard test:coverage:workers` | a mesma fronteira HTTP no runtime alvo                                                                     |
| Workerd D1         | `pnpm --filter @holon/db test:coverage`                | migrations, autoridade, constraints, concorrência/rollback e reserva OAuth                                 |
| Workerd RPC        | `pnpm --filter @holon/email-delivery test:coverage`    | HTTP negado e capability privada no bundle construído separadamente                                        |
| Browser            | `pnpm --filter @holon/dashboard test:browser`          | build/dry-run + pt-BR/en × Chromium/Firefox/WebKit, CSP/SSR/teclado/foco/tema/reduced-motion/axe/cache/404 |
| Imports/marca      | `pnpm test:architecture`, `pnpm brand:check`           | regras positivas/negativas e tokens/contraste                                                              |

`@holon/dashboard` mantém Node (V8) e Workers (Istanbul) com 90% de linhas,
funções/statements e 85% de branches nos módulos de política HTTP/i18n e no
validador de identidades de módulos cliente. UI/DB/email
instrumentam suas fontes inteiras nos respectivos runtimes, com os mesmos limites.
Root/rotas/entries de composição framework são cobertos pelo artefato Playwright;
nenhum threshold do core foi reduzido ou caminho removido para esconder falha.
A CI instala os três engines, roda `verify` e retém JUnit/trace/screenshot sintéticos
por sete dias. Suites browser têm zero retries e cache desligado; falhas não passam
porque uma repetição sem correção ficou verde.

Axe cobre regras automatizáveis nos estados exibidos, não conformidade WCAG 2.2
completa. A suite inclui largura 375 px; 320 px, zoom, dispositivos reais, duas
versões estáveis e os fluxos privados completos permanecem gates da entrega UI.
Local preference via URL não prova perfil persistido; health não prova readiness
de auth ou banco; reserva OAuth local não comprova callback real do GitHub.
