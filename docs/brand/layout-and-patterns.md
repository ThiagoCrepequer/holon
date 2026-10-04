---
id: HOLON-DESIGN-LAYOUT
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Layout, movimento e aplicações

## Parte, grupo, página

A metáfora da marca organiza o conteúdo: um achado é uma unidade compreensível,
pertence a uma revisão e pode levar ao contexto do arquivo. Use agrupamentos
claros e títulos descritivos. O usuário deve reconhecer onde está e o que uma
ação afeta, sem depender da decoração.

Uma página tem um foco principal. A sequência recomendada é orientação,
conteúdo que sustenta a decisão e ação. Metadados ficam próximos do objeto a
que pertencem. Informações secundárias podem ser expandidas sem esconder um
erro ou uma limitação importante.

## Grade responsiva

| Faixa               | Colunas | Margem externa | Gutter | Comportamento                             |
| ------------------- | ------- | -------------- | ------ | ----------------------------------------- |
| Menos de 640 px     | 4       | 20 px          | 16 px  | Conteúdo empilhado; navegação compacta    |
| 640–1023 px         | 8       | 32 px          | 24 px  | Duas colunas quando a tarefa comporta     |
| A partir de 1024 px | 12      | 48 px          | 24 px  | Navegação lateral e contexto complementar |

Conteúdo padrão tem limite de 1200 px; páginas densas podem usar 1440 px.
Texto longo mantém limite de 704 px. A grade é uma ferramenta, não uma razão
para criar colunas sem conteúdo. Breakpoints são registrados nos tokens,
mas variáveis CSS não funcionam diretamente em condições de media queries;
use os valores correspondentes ou a integração do framework.

Em 320 px, a página deve reorganizar os elementos sem rolagem horizontal
global. Código e tabelas podem rolar dentro de regiões identificadas. Links,
nomes de arquivo e IDs longos devem quebrar de forma previsível. Zoom e
preferências de tamanho de texto não podem ser bloqueados.

## Landing page e site

1. Navegação curta com assinatura horizontal e uma ação principal.
2. Hero com proposta concreta, frase editorial e exemplo visível do produto.
3. Explicação do fluxo por etapas ou relações entre partes.
4. Evidência do que a ferramenta apresenta: exemplo de achado, contexto e
   trecho de código, sempre identificado como demonstração quando fictício.
5. Limites, integração e chamada final coerentes com capacidades reais.

Títulos grandes usam Manrope; uma expressão curta pode receber Instrument
Serif. O campo de sementes pode ocupar a lateral ou o fundo de uma seção,
com contraste baixo e sem atravessar conteúdo. Não cobrir toda a página com
formas ou distribuir o mesmo cartão em todas as seções.

## Painel operacional

Navegação lateral de referência: 240 px em desktop. Em tablet, pode virar uma
barra superior; em mobile, um menu acessível com rótulo. O conteúdo principal
prioriza repositório, pull request, commit e estado. A ação contextual aparece
perto desses identificadores.

Listas de revisões devem permitir leitura por linha. Use estado + texto,
título do PR, repositório/branch, commit e momento da execução quando úteis.
Não preencher a abertura com métricas inventadas. Uma revisão individual
apresenta resumo, completude, achados e evidências em ordem de decisão.

Gráficos só entram quando ajudam uma pergunta concreta. Use rótulos,
marcadores ou padrões além da cor; disponibilize resumo ou dados equivalentes.
Não reutilize a cor de gravidade como mera decoração de séries.

## Página de documentação

Navegação persistente, leitura de 44 rem e sumário em conteúdos longos.
Hierarquia sem saltos arbitrários, tabelas com cabeçalhos e código com botão
de cópia quando implementado. Metadados de fonte e data devem ser legíveis.

## Mensagens em plataformas externas

GitHub controla fontes, cores e temas. A identidade se manifesta por tom,
estrutura, títulos, links e avatar. Não simular um painel com tabelas enormes
em comentários. Um review pequeno deve continuar pequeno. Informações críticas
não podem existir apenas numa imagem anexada.

## Movimento

| Token         | Duração | Uso                                 |
| ------------- | ------- | ----------------------------------- |
| `motion-fast` | 120 ms  | Cor e feedback de hover             |
| `motion-base` | 180 ms  | Abertura pequena e troca de estado  |
| `motion-slow` | 280 ms  | Entrada de painel ou contexto maior |

Curva padrão: `cubic-bezier(0.2, 0, 0, 1)`. Prefira opacidade e deslocamentos
curtos, sem empurrar conteúdo durante leitura. Movimento deve indicar causa,
continuidade ou resultado. Não girar a semente como um loader; use indicador
de progresso independente, com texto e estado real.

Respeite `prefers-reduced-motion`: remova deslocamentos e animações contínuas,
mantendo feedback textual. Nunca invente porcentagem para uma execução sem
progresso mensurável. Uma transição não deve atrasar confirmação ou bloquear
teclado.

## Aplicações de marca

Avatar usa a prancheta própria com área segura. Social cards usam formato
1200 × 630 px, assinatura, mensagem curta e uma composição de sementes.
Apresentações podem usar capas amplas e conteúdo em superfícies claras;
repetir o nome discretamente em vez de multiplicar símbolos em cada bloco.

O arquivo `assets/patterns/seed-field.svg` é decorativo. Na web, usar
`aria-hidden="true"` ou imagem de fundo. A geometria deve ocupar no máximo
três escalas perceptíveis, para manter a simplicidade da identidade.
