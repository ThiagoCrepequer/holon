---
id: ARCH-INTERNAL-CONSOLE-UI
kind: architecture
status: current
owners:
  - core-team
last-reviewed: 2026-09-04
---

# Interface do console operacional

O dashboard de `apps/admin` usa superfícies grafite, navegação lateral discreta,
cartões arredondados e vermelho como cor primária. A composição segue as
referências visuais fornecidas para o redesign de 2026-09-04. O cartão de volume
recebe destaque bordô sólido; métricas secundárias permanecem em superfície escura.
O shell também envolve Runs, Readiness e detalhes de execução. O documento HTML
seleciona `data-theme="dark"` desde a renderização no servidor, sem flash claro.
Os componentes compartilhados usam tokens semânticos para superfícies, texto,
bordas e status, inclusive em portais (selects, dialogs e drawers). O tema escuro
mantém ações em vermelho bordô e usa vermelho claro para links e foco, com cores
próprias para sucesso, aviso e informação. `color-scheme: dark` também adapta os
controles nativos e barras de rolagem.

## Hierarquia e dados

A identidade do operador fica no rodapé da sidebar; em mobile, aparece ao lado
da marca. Não há barra superior separada. O conteúdo ocupa a largura disponível,
com margens laterais de 24 px em desktop, e começa pelo
título e pelo seletor de período, seguido de avisos operacionais, métricas,
latência, distribuição de veredictos, fila e execuções recentes. Os blocos usam
espaçamentos de 12–14 px e os estados vazios evitam altura e bordas redundantes.
O aviso operacional usa uma faixa em vermelho suave com rótulos textuais de
indisponibilidade ou degradação, mantendo os papéis `status` e `alert`. O rodapé do
conteúdo mantém o início do histórico disponível e a última projeção recebida.

O anel de veredictos representa as contagens existentes do resumo D1. Quando
não existem veredictos, o painel mostra um estado vazio textual, sem anel ou
percentuais artificiais. Um período sem reviews mostra travessão em taxa de
sucesso e duração; uma execução real sem sucesso continua mostrando `0%`. A legenda
textual inclui contagens e percentuais; o SVG decorativo é ocultado de leitores
de tela para evitar informação duplicada. Cada categoria tem o mesmo tom no
anel e em sua legenda. Badges de estado mantêm as cores semânticas existentes.
Não são adicionados dados fictícios, comparações históricas ou gráficos de exemplo.

O gráfico de latência mantém a tabela acessível com valores exatos. Ausência
conhecida de telemetria é renderizada no servidor, sem carregar a biblioteca
de gráficos para mostrar um estado vazio. Uma integração disponível sem
amostras tem texto próprio, diferente de uma integração indisponível. p50 usa uma
linha vermelha contínua; p95 usa outro tom e traçado descontínuo, permitindo
distinguir as séries além da cor. Ausência de telemetria e degradação continuam
sendo estados distintos. Contratos, autenticação, consultas e persistência não
são modificados pelo redesign; permanece o limite read-only da
[ADR-0029](../decisions/0029-adopt-internal-operational-console-and-d1-read-model.md).

## Responsividade e acessibilidade

Em telas menores, os indicadores passam a duas colunas e os painéis são
empilhados. Abaixo de 768 px, a navegação lateral vira navegação horizontal no
topo. Tabelas preservam a rolagem horizontal do componente existente.

Botões primários, seletores e campos de filtro usam os tokens vermelhos
`--accent` e `--focus-ring` do design system. Links e botões têm foco visível. O link "Skip to content" permite saltar a
navegação; a página e o período selecionados são expostos por `aria-current`.
A interface usa fontes do sistema, respeita redução de movimento e não depende
de downloads de fontes ou bibliotecas novas.

## Fontes de orientação

Consultadas em **2026-09-04**. São orientações usadas na implementação, não uma
certificação de conformidade ou uma auditoria completa de acessibilidade:

- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/): contraste, foco, uso de cor e
  tamanho dos alvos de interação.
- [Carbon: empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/):
  estados vazios devem explicar a ausência de dados e sua causa, sem representar
  informação indisponível como zero ou sucesso.

## Contrato visual e responsabilidade dos componentes

O console prioriza decisões operacionais sobre revisões: resultados, execuções,
latência e disponibilidade. Preserva vermelho como acento, superfícies grafite,
layout amplo, densidade compacta e identidade na sidebar. Não usa slogans,
crescimentos inventados, ícones dentro de círculos decorativos ou gráficos vazios
como ornamentação.

`@holon/ui` controla a anatomia dos cards e métricas. `MetricCard` oferece
`emphasis="primary"` e grupos acessíveis nomeados por seus rótulos. Slots
`data-slot` identificam partes estáveis de `Card`, sem dependência da posição dos
filhos. `ChartFrame` permite títulos específicos para estados vazios.

`PageHeader` e `VerdictDistribution` pertencem ao console: o primeiro unifica os
cabeçalhos; o segundo interpreta os veredictos do domínio. Estilos de shell,
dashboard e controles ficam separados em `apps/admin/app/styles/`; o arquivo de
entrada apenas importa essas camadas. Detalhes de execução preservam quebra de
identificadores longos e o mesmo tratamento dos avisos operacionais.

### Revisão com as skills de UI — 2026-09-04

Aplicados os playbooks de refinamento de `anti-ui-slop` e `ui-design` e a busca
focada de `ui-radar`. Duas consultas ao catálogo público UIZZE retornaram listas
vazias; nenhuma referência externa foi apresentada como evidência visual. A
composição foi avaliada na interface local e nas referências fornecidas pelo
usuário. Os testes distinguem ausência de reviews, falha real, ausência de
telemetria e integração disponível sem amostras.

## Movimento do painel de detalhes

O painel usa transições de `transform` (280 ms para abrir e 220 ms para fechar)
e o backdrop usa apenas opacidade, sem blur. O estado controlado permanece na
rota até `onOpenChangeComplete(false)`, inclusive ao usar Close, Escape e os
links de retorno dentro do painel. Não há timer duplicando a duração do CSS.
Movimento reduzido desativa as transições; a navegação continua funcionando
quando não existem animações ativas. A estrutura inclui `Drawer.Viewport` para
coordenação de toque e rolagem do Base UI.

Consultados em **2026-09-04**: [Base UI Drawer](https://base-ui.com/react/components/drawer)
e [Tailwind Animations](https://tailwind-animations.com/). As utilidades CSS da
biblioteca não substituem o controle de montagem da rota; a implementação usa
o ciclo de transições do Base UI já instalado.

## Navegação do workflow executado

O canvas apresenta as etapas de cima para baixo na ordem da execução, com as
fases identificadas ao longo da sequência. A área tem altura limitada e rolagem
nativa: mouse permite arrastar, touch preserva pan/inércia do navegador e teclado
permite explorar a região e focar os nós. Um arraste não seleciona a etapa.

O zoom preserva o centro visível e atualiza as dimensões roláveis, mantendo as
bordas alcançáveis. “Ajustar” calcula o enquadramento com as dimensões reais da
área; “Reset” volta a 100% e ao início. Os controles ficam fora da área rolável.
O painel lateral usa um Dialog modal com aparência de drawer, sem gesto de
fechamento por arraste; mantém foco contido, Escape, botão de fechamento e
animações de entrada/saída com respeito a movimento reduzido.
