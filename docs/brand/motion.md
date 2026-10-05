---
id: HOLON-DESIGN-MOTION
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Movimento e continuidade

Movimento no Holon mostra o que uma ação mudou e mantém o contexto legível.
A interface é moderna, minimalista e fluida: superfícies discretas, expansão
local, seleção suave e dados atualizados no mesmo lugar. Estas regras valem
para site, dashboard dos usuários e demais interfaces da marca.

As [referências analisadas](../research/2026-10-04-dashboard-ui-motion-references.md)
informaram esta definição. Os valores abaixo são escolhas do Holon, não
medições das curvas ou durações originais. A identidade, cores, fontes e
Semente oficiais continuam orientando a aparência.

## Vocabulário e tokens

A fonte dos valores é [tokens/tokens.json](tokens/tokens.json), grupo
`primitives.motion`; o CSS gerado usa o prefixo `--holon-motion-`.
Cada receita abaixo atribui uma responsabilidade aos valores da escala.

| Token             | Valor                          | Responsabilidade                                              |
| ----------------- | ------------------------------ | ------------------------------------------------------------- |
| `instant`         | 0 ms                           | Preferência por movimento reduzido; feedback sem interpolação |
| `fast`            | 120 ms                         | Hover, pressão e seleção                                      |
| `exit`            | 160 ms                         | Saída de superfície pequena                                   |
| `base`            | 180 ms                         | Troca curta de conteúdo; saída de painel                      |
| `enter`           | 240 ms                         | Entrada de popover ou menu                                    |
| `slow`            | 280 ms                         | Painel, expansão e reorganização solicitada                   |
| `data`            | 320 ms                         | Atualização de número ou geometria de gráfico                 |
| `stagger`         | 32 ms                          | Intervalo de uma sequência inicial curta                      |
| `stagger-limit`   | 160 ms                         | Limite do atraso total da sequência                           |
| `indicator-cycle` | 1200 ms                        | Ciclo do indicador indeterminado                              |
| `distance-micro`  | 4 px                           | Troca de rótulo e entrada de popover                          |
| `distance-small`  | 8 px                           | Entrada curta de bloco ou contexto                            |
| `scale-surface`   | 0.98                           | Escala inicial opcional de superfície pequena                 |
| `ease`            | `cubic-bezier(0.2, 0, 0, 1)`   | Movimento com chegada suave, sem overshoot                    |
| `ease-in-out`     | `cubic-bezier(0.4, 0, 0.2, 1)` | Expansão e mudança de geometria entre dois estados            |
| `linear`          | `linear`                       | Ciclo do indicador, sem aceleração espacial                   |

Abertura de superfície é mais lenta que fechamento. Mudanças reversíveis de
geometria usam a mesma duração nos dois sentidos. Não aplicar `transition: all`;
nomear somente as propriedades envolvidas. Blur, bounce e elasticidade não
fazem parte do padrão. Não animar a posição de toda a página ao navegar.

## Receitas de interação

| Receita                           | Entrada / atualização                              | Saída         | Regra de continuidade                                                                             |
| --------------------------------- | -------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| Hover e checkbox                  | `fast`, cor/opacidade                              | `fast`        | Seleção e nome acessível mudam imediatamente; sem deslocar linha                                  |
| Rótulo, ícone ou status           | `base`, opacidade e até `distance-micro`           | `base`        | Reservar espaço; uma única representação acessível do valor atual                                 |
| Menu, select e popover            | `enter`, `ease`, opacidade; até 4 px e escala 0.98 | `exit`        | Origem junto ao acionador; posicionamento e foco continuam sob a primitiva                        |
| Drawer ou dialog                  | `slow`, `ease`; backdrop por opacidade             | `base`        | Lista e scroll de origem preservados; drawer pode percorrer sua própria largura a partir da borda |
| Disclosure e expansão de linha    | `slow`, `ease-in-out`, altura/layout               | `slow`        | Expandir apenas o contexto solicitado; texto não deve esticar                                     |
| Reordenação solicitada por filtro | `slow`, `ease-in-out`, posição                     | Mesma duração | IDs estáveis; identidade acompanha o item; preservar seleção e foco                               |
| Número e gráfico                  | `data`, `ease`, do estado anterior ao recebido     | —             | Retarget de atualizações rápidas; sem replay da entrada ou contagem a partir de zero              |
| Primeira apresentação de um grupo | `base`, opacidade e até 8 px; intervalo `stagger`  | Sem sequência | Atraso `min(índice × 32 ms, 160 ms)`; nunca repetir por refetch                                   |
| Indicador indeterminado           | `indicator-cycle`, opacidade dos pontos            | Imediata      | Apenas durante espera real; texto explica a operação                                              |

Stagger é opcional e restrito a poucos itens de apresentação. Não atrasar
respostas a clique, validação, erros ou seleção. Skeleton reserva a geometria
na primeira carga; ao atualizar dados existentes, manter conteúdo e mostrar
estado local de atualização. Não trocar todo o dashboard por skeletons.
Continuidade visual não permite reter conteúdo privado após negação de acesso;
nesse caso, fechar a apresentação conforme a política de segurança.

Uma atualização recebida em background não reorganiza automaticamente a lista
sob o ponteiro ou durante leitura. Oferecer indicação de novos dados ou uma
atualização solicitada quando a ordenação mudar. Virtualização de listas pode
remontar linhas; isso não deve disparar uma entrada a cada scroll.

## Dados, progresso e verdade

Usar dígitos tabulares e reservar espaço para número, unidade e rótulo.
A representação semântica recebe o valor real de imediato; frames de
interpolação são visuais e não geram anúncios repetidos. Não apresentar
números intermediários como resultados confirmados. Mudanças decorativas não
precisam de `aria-live`; eventos úteis usam anúncios curtos e agregados.

Gráficos mantêm escalas e identidade das séries quando fizer sentido. Mudanças
de escala precisam ficar claras por eixos/rótulos; animação não deve sugerir
comparabilidade falsa. Barras simples podem usar CSS/SVG. A animação nativa
do gráfico e Motion não controlam a mesma geometria ao mesmo tempo.

O indicador padrão é uma matriz discreta 3 × 3 de pontos, com uma onda de
opacidade. Usar somente um indicador por operação/contexto, com texto visível.
Não girar a Semente, inventar porcentagem, manter loops decorativos ociosos
ou usar animação para esconder latência. Progresso determinado exige medida real.

## Acessibilidade e interrupção

Com `prefers-reduced-motion: reduce`, remover deslocamento, escala,
reordenação animada, rolagem suave, rotação de dígitos, stagger e loops.
Neste padrão, as transições ficam instantâneas; manter texto, seleção,
indicador estático e resultado compreensíveis. Aplicar a preferência tanto
no CSS quanto no motor JavaScript; observar mudanças da preferência em execução.

Motion não substitui foco, nomes, teclado e semântica. Modais continuam com
foco inicial, contenção, Escape e retorno ao acionador. Elementos que estão
saindo não podem continuar focáveis; ao fechar, ajustar foco e interação
imediatamente sem esperar a animação. Expansões usam `aria-expanded` e
`aria-controls`; conteúdo fechado fica fora da navegação e da árvore acessível.

Uma segunda interação cancela ou redireciona o movimento atual, sem filas de
animações. O estado final deve ser correto mesmo sem animação, após erro ou
cancelamento. Não bloquear comandos para esperar uma curva terminar.

## Implementação e revisão

CSS atende hover, seleção, expansão simples e indicador de pontos. Motion
for React é o candidato para presença, layout e continuidade entre estados
complexos. As bibliotecas são avaliadas na pesquisa; este guia não instala
nenhuma nem depende de um framework. Veja [integração](implementation.md#integrar-movimento).

`MotionConfig reducedMotion="user"` não implementa sozinho a receita instantânea
do Holon: a opção remove transform/layout, mas preserva animações de opacidade/
cor. As receitas também precisam observar a preferência, usar duração zero,
eliminar stagger e parar loops, inclusive quando ela mudar durante uma animação.
Aplicar a mesma regra a primitivas, gráficos, números e eventual View Transition;
não deixar outro motor continuar o movimento removido pelo primeiro.

Verificar os dois temas, desktop e 320 px, teclado, movimento reduzido,
abertura/fechamento rápidos e atualizações sucessivas. Avaliar se a transição
preserva leitura, espaço e identidade; não basta estar tecnicamente suave.
Não manter `will-change` em todos os componentes. Medir animações de altura,
listas grandes e gráficos antes de generalizar efeitos.

O [UI Kit](ui-kit/index.html#motion) demonstra expansão e atualização local
com dados fictícios, CSS e JavaScript nativos. Não demonstra integração React,
SSR, gráfico em produção nem sincronização remota.

## Fontes verificadas em 2026-10-04

- [Motion: layout](https://motion.dev/docs/react-layout-animations),
  [presença](https://motion.dev/docs/react-animate-presence) e
  [acessibilidade](https://motion.dev/docs/react-accessibility).
- [NumberFlow](https://number-flow.barvian.me/): candidato especializado;
  preferência de movimento e limitações de browser/locale exigem prova própria.
