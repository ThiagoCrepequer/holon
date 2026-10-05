---
id: HOLON-UI-COMPONENTS
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Componentes e acessibilidade

O [UI Kit](ui-kit/index.html) demonstra a aparência e interações locais. Ao
implementar uma aplicação, conectar controles ao domínio real, sem copiar os
dados fictícios como fatos. Usar elementos HTML nativos ou primitivas
acessíveis do framework escolhido; não criar um pacote novo apenas para
replicar a documentação.

## Botões e links

| Variante   | Uso                               | Tratamento                                                |
| ---------- | --------------------------------- | --------------------------------------------------------- |
| Primário   | A principal ação daquele contexto | `action-bg` + `action-fg`                                 |
| Secundário | Alternativa de mesma superfície   | Fundo neutro e borda de controle                          |
| Discreto   | Ação auxiliar                     | Texto/link e fundo de hover sutil                         |
| Destrutivo | Ação com perda real               | Cor de perigo, verbo explícito e confirmação proporcional |

Alturas: 32 px compacto, 44 px padrão, 52 px destacado. O alvo padrão para
toque é 44 × 44 px; controles compactos precisam de área clicável ampliada ou
espaçamento suficiente. WCAG 2.2 AA define 24 × 24 CSS px com exceções; a
regra interna de 44 px é mais confortável e não deve ser confundida com esse
limite mínimo.

O rótulo começa com verbo. Link navega; botão executa uma ação. Ícone sem texto
exige nome acessível e, quando útil, tooltip disponível também por foco.
Tooltip não substitui nome acessível nem instrução obrigatória.

Estados: default, hover, pressed, focus-visible, disabled e loading. Loading
preserva o rótulo ou o substitui por ação em andamento, impede repetição da
mesma operação e usa `aria-busy`. Não fazer o botão mudar de largura. Disabled
usa o atributo nativo quando aplicável; explique pré-requisitos próximos,
sem depender de hover sobre um botão desabilitado.

Feedback usa a receita de hover/seleção e troca de estado do
[guia de movimento](motion.md#receitas-de-interação), sem atrasar a ação.

## Campos e seleção

Input padrão tem altura mínima de 44 px, padding horizontal de 12 px, raio de
10 px e borda `border-control`. Label permanece visível; placeholder é exemplo,
nunca a única identificação. Instrução e erro ficam abaixo, ligados por
`aria-describedby`. Erro usa texto e `aria-invalid`, não apenas borda vermelha.

Valide em momento útil, preservando o valor digitado. Para erros após envio,
leve foco ao resumo ou primeiro campo inválido. Checkbox seleciona opções
independentes; radio escolhe uma entre alternativas; switch aplica uma
configuração imediata. Não usar switch para uma ação irreversível.

Select nativo é a referência inicial. Um combobox customizado exige suporte a
teclado, leitura por tecnologia assistiva e estados vazio/carregando/erro.

## Navegação e tabs

Item atual usa sinal visual e semântico (`aria-current`). Tabs trocam painéis
locais; links navegam entre páginas. Tabs customizadas precisam das relações
tablist/tab/tabpanel, seleção única, roving tabindex, setas e Home/End.
Quando isso não for necessário, botões ou navegação convencional são mais simples.

## Superfícies, listas e tabela

Cards têm raio de 16 px, padding padrão de 24 px e borda discreta. Use um card
quando seu conteúdo constituir uma unidade; não coloque cada parágrafo dentro
de outro card. Listas densas podem compartilhar a mesma superfície.

Tabela usa cabeçalhos semânticos, alinhamento numérico consistente e ação de
linha previsível. Não tornar toda a linha clicável quando já houver vários
controles nela. Em mobile, priorize colunas essenciais e ofereça contexto por
expansão ou rolagem regional, sem truncar informação decisiva.

Expansão e reordenação seguem [receitas de continuidade](motion.md#receitas-de-interação).
Manter IDs estáveis e seleção; não animar entrada a cada remontagem por scroll.

## Estados de uma revisão

| Estado apresentado      | Aparência                        | Conteúdo necessário                              |
| ----------------------- | -------------------------------- | ------------------------------------------------ |
| Em andamento            | Informação                       | Etapa real ou indicação indeterminada            |
| Concluída, sem achados  | Sucesso                          | Escopo revisado; ausência de achados confirmados |
| Concluída, com achados  | Neutro + indicadores dos achados | Contagem e acesso às evidências                  |
| Parcial                 | Atenção                          | Limite da revisão e o que ficou pendente         |
| Falhou                  | Perigo                           | Falha compreensível e caminho de recuperação     |
| Cancelada / substituída | Neutro                           | Motivo contextual, quando disponível             |

Gravidade de um achado e completude da execução são dimensões diferentes.
Use rótulos P0/P1/P2/P3 ou os valores reais do contrato acompanhados de descrição;
não inferir gravidade pela cor da execução. O kit não adiciona alertas
heurísticos de testes ausentes ou “pontos de atenção” ao review.

Um card de achado deve expor título, gravidade, arquivo/linha, explicação do
impacto e evidência. Código usa Mono, linhas identificáveis e região de rolagem
própria. Exclusões e adições precisam de sinais `−`/`+` ou rótulos além da cor.

## Feedback e sobreposição

Alert inline fica perto do objeto afetado. Erros que exigem decisão persistem
até resolução. Toast é adequado para confirmação auxiliar, com `role="status"`
quando necessário; não deve ser o único lugar onde uma falha importante aparece.

Dialog usa título acessível, foco inicial útil, contenção de foco, Escape quando
permitido e retorno ao acionador. A ação destrutiva deve nomear o objeto. Uma
gaveta lateral segue as mesmas regras se bloquear o restante da interface.

Empty state explica o que aparecerá ali e o próximo passo disponível. Skeleton
preserva a geometria aproximada do conteúdo e respeita movimento reduzido.
Um estado de erro não deve parecer vazio, nem ser substituído por dados falsos.

Popovers, drawers, indicadores e transições de status seguem o
[guia de movimento](motion.md). Foco e interação não esperam a animação de saída.

## Critérios para uma interface pronta

Confirme teclado, foco visível, ordem de leitura, nomes acessíveis, contraste,
zoom a 200%, largura de 320 px, conteúdo longo, idiomas e movimento reduzido.
Teste os estados que realmente ocorrem naquela integração. Cálculo de contraste
e uma captura de tela não demonstram sozinhos conformidade de acessibilidade.

Para o dashboard, WCAG 2.2 AA e a matriz de suporte foram acordados em
2026-10-04; consulte os [critérios de prova frontend](../engineering/testing-and-evidence.md#dashboard-critérios-acordados-para-implementação-futura).
A conformidade precisa ser avaliada na interface implementada.
