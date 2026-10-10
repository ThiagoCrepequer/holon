---
id: DASHBOARD-MILESTONE-SEVEN-EVIDENCE
kind: planning
status: current
owners: [core-team]
last-reviewed: 2026-10-10
---

# Dashboard 7: contrato visual e evidência

A [matriz integral #187–#194, critérios, testes e limites](https://github.com/ThiagoCrepequer/holon/blob/f86a6289864fc5956119fc4252aac6ffd9522000/docs/planning/dashboard-milestone-seven-evidence.md) permanece no commit imutável. Sua cópia exata integra o [arquivo de evidências](dashboard-seven-assets/README.md#arquivo-das-capturas-anteriores); não houve perda de critérios, capturas ou resultados.

A UI usa Semente/fontes/tokens oficiais, Tailwind e componentes shadcn; temas claro/escuro e pt-BR/en. O único controle de workspace fica na sidebar, com criação em Sheet lateral. Preferências/Sair ficam no Dropdown Menu Base UI do usuário; não há botão de sessões ativas. Inputs/selects têm label/hint/error, foco e estados explícitos.

Colaboração usa intents e escopo/geração; Query é dono dos dados de reviews, com leituras explícitas e SSR sem leitura de hidratação. Email conserva Semente PNG CID e fallback textual, CTA bilíngue e idempotência. A [galeria](dashboard-seven-assets/README.md) mantém comparações, estados, menus, Sheet, zoom e email, usando somente fixtures sintéticas.

O usuário autorizou o orçamento total de 240.000 bytes JS gzip; CSS/fontes mantêm 12.000/160.000 bytes. O gate local passou com 131 jornadas autenticadas e 12 de fundação, além de cobertura/build/dry-runs. A [continuação](../research/2026-10-10-pr186-review-recovery-fixes.md) registra a nova execução do gate e as correções do core.

## Email

A confirmação humana da logo/CTA no Gmail e a limpeza da fixture permanecem pendentes. O PR mantém draft. Browser automatizado não certifica Safari/aparelhos físicos, CWV de campo, WCAG integral nem VoiceOver físico; #163–#167/#127/#157 não fecham por inferência. O layout/core desta etapa não foi implantado.
