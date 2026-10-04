---
id: HOLON-BRAND-LOGO
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Sistema de assinatura

## Construção

O símbolo oficial preserva a geometria da **Semente da rodada inicial**: um
contorno orgânico envolvente, com inclinação ascendente e um núcleo
cheio. O desenho usa uma prancheta de 100 × 100 unidades, traço externo de
9 unidades e proporção fixa. O espaço entre núcleo e contorno é parte da marca.

O lettering é `holon`, em Manrope 600, com espaçamento óptico ajustado. O
arquivo final usa contornos vetoriais. Não redigitar o nome para reconstruir a
assinatura; a tipografia de interface pode variar em tamanho sem alterar a logo.

| Arquivo em `assets/logo/`                               | Aplicação                                       |
| ------------------------------------------------------- | ----------------------------------------------- |
| `holon-lockup-primary.svg`                              | Assinatura horizontal em fundo claro            |
| `holon-lockup-inverse.svg`                              | Assinatura horizontal em tinta ou fundo escuro  |
| `holon-lockup-mono.svg` / `holon-lockup-white.svg`      | Uma tinta, gravação, limitação de reprodução    |
| `holon-lockup-stacked.svg`                              | Composição vertical com espaço suficiente       |
| `holon-symbol-primary.svg` / `holon-symbol-inverse.svg` | Símbolo isolado com nome presente no contexto   |
| `holon-wordmark-primary.svg`                            | Nome isolado quando o símbolo já está próximo   |
| `holon-avatar.svg`                                      | Avatar quadrado; manter o respiro do arquivo    |
| `holon-favicon.svg`                                     | Favicon com fundo sólido e contraste previsível |
| `holon-symbol-micro.svg`                                | Uso claro entre 16 e 23 px; traço reforçado     |

## Área de proteção

Considere **S** a largura da prancheta do símbolo, não apenas a área pintada.
Reserve **S/4** livres em cada lado do símbolo ou da assinatura completa.
Exemplo: símbolo de 40 px → 10 px de proteção. Essa área não recebe texto,
borda, fotografia ou outra marca. O espaço interno entre símbolo e lettering
já está resolvido no SVG horizontal de 304 × 100 unidades.

Para co-branding, separe marcas por pelo menos **S/2**. Use divisor apenas
quando houver relação editorial clara; não combine símbolos em uma marca nova.

## Tamanhos mínimos

| Versão                  | Mínimo digital    | Referência impressa                  |
| ----------------------- | ----------------- | ------------------------------------ |
| Símbolo padrão          | 24 × 24 px        | 8 mm de prancheta                    |
| Símbolo micro / favicon | 16 × 16 px        | Não usar a versão micro em impressão |
| Horizontal              | 112 px de largura | 30 mm de largura                     |
| Vertical                | 100 px de largura | 25 mm de largura                     |
| Avatar                  | 32 × 32 px        | Conforme aplicação                   |

As medidas impressas são pontos de partida: faça prova no material final.
As versões 16, 24, 32, 48 e 96 px aparecem no UI Kit. Nunca comprima a assinatura
inteira para caber em um favicon.

## Cores e fundos

A assinatura principal usa **Tinta 900** `#17243A` e **Violeta 500** `#8864E7`.
A inversa usa **Papel 50** `#FAF9F6` e **Violeta 300** `#C4ADF2`. A versão
monocromática aplica a mesma tinta ao contorno, núcleo e nome.

Use fundos lisos claros, tinta escura ou fotografia com área controlada.
Sobre fotografia complexa, coloque a assinatura dentro de uma superfície
neutra com a área de proteção. Preserve opacidade integral na logo funcional.

## Usos incorretos

- Girar, espelhar, achatar ou esticar a semente.
- Mover o núcleo, fechar seu espaço negativo ou engrossar o contorno padrão.
- Adicionar gradiente, sombra, contorno extra, brilho ou textura à assinatura.
- Usar a versão violeta clara como texto ou como único sinal de um estado.
- Misturar a semente com outras propostas do arquivo de exploração.
- Trocar o núcleo por check, estrela, inicial, rosto ou ícone de status.

O campo de sementes é um **elemento gráfico separado**, destinado a capas e
seções editoriais. Ele pode ser recortado e variar de escala; essas liberdades
não se aplicam à logo oficial.

## Exportação

Prefira SVG para web e interface. PNG deve ser exportado do vetor no tamanho
necessário, mantendo transparência ou um fundo aprovado; use 2× para posições
rasterizadas em telas de alta densidade. Arquivos PNG de avatar acompanham o kit.
Não converter repetidamente a partir de PNGs antigos.

A paleta é definida em sRGB. Para impressão, converter para o perfil indicado
pela gráfica e aprovar uma prova; não tratar valores CMYK automáticos como uma
cor oficial equivalente. As fontes possuem licenças próprias em `assets/fonts/`.
