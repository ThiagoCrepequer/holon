---
id: HOLON-BRAND
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Identidade e design system do Holon

A **Semente da primeira exploração** é a identidade escolhida. O símbolo
contém uma unidade inteira dentro de outra: o núcleo tem forma própria e
participa de uma estrutura maior. Essa relação orienta a marca e a organização
das interfaces. O nome permanece **Holon**; a assinatura visual usa `holon`.

![Assinatura principal](assets/logo/holon-lockup-primary.svg)

Este conjunto define a referência de marca para sites, landing pages,
documentação, apresentações e painéis. O UI Kit é uma implementação estática de
referência, independente de framework. Ele não representa um admin implantado
nem altera o escopo do runtime descrito na ADR-0040.

## Abrir a referência visual

- [Brand Guidelines e UI Kit navegável](ui-kit/index.html): marca, cores,
  tipografia, composição, componentes, estados e exemplos de aplicação.
- [Prancha de identidade](assets/previews/brand-overview.png): visão rápida para
  compartilhar e comparar aplicações.
- [Arquivos de marca](assets/README.md): SVGs, fontes locais e respectivas licenças.

O HTML pode ser aberto diretamente em um navegador. Todos os recursos são
locais; a página não carrega fontes, bibliotecas ou analytics externos. Os
controles interativos apenas demonstram o kit com dados fictícios.

## Caminhos de leitura

| Preciso…                           | Referência                                       |
| ---------------------------------- | ------------------------------------------------ |
| Entender personalidade e escrita   | [Essência e voz](brand-and-voice.md)             |
| Aplicar ou exportar a logo         | [Sistema de assinatura](logo.md)                 |
| Escolher cores e tipografia        | [Fundamentos](foundations.md)                    |
| Compor uma LP, site ou painel      | [Layout e aplicações](layout-and-patterns.md)    |
| Definir animações e continuidade   | [Movimento e continuidade](motion.md)            |
| Implementar controles e estados    | [Componentes e acessibilidade](components.md)    |
| Consumir e atualizar tokens        | [Integração e manutenção](implementation.md)     |
| Reutilizar uma exploração anterior | [Arquivo de explorações](explorations/README.md) |

## Fonte de verdade

1. A forma oficial está nos SVGs de `assets/logo/`. Eles não dependem de fontes
   instaladas: o lettering foi convertido em contornos.
2. Valores visuais estão em [tokens/tokens.json](tokens/tokens.json). O CSS e o
   relatório de contraste são gerados desse arquivo.
3. Os guias definem uso, hierarquia e comportamento. O HTML demonstra essas
   regras; não é uma biblioteca de componentes de produção.
4. As explorações são históricas e **não orientam a identidade ativa**.

Para um trabalho novo, comece pelo guia relevante e pelos tokens semânticos.
Uma página de apresentação pode ser expressiva; uma tela operacional deve
preservar leitura, estados e evidências. Ambas pertencem à mesma marca.

## Direção em uma página

- **Ideia:** compreender cada mudança dentro de seu contexto.
- **Forma:** contorno orgânico inclinado e núcleo independente.
- **Cores:** papel mineral, tinta azul profunda e núcleo violeta.
- **Texto:** Manrope para leitura; Instrument Serif para expressão editorial;
  IBM Plex Mono para código e identificadores.
- **Ritmo:** escala de 4 px, espaço generoso entre assuntos, proximidade entre
  elementos relacionados.
- **Interface:** superfícies discretas, ação principal evidente, estado
  acompanhado por palavras, evidência perto da conclusão.
- **Voz:** precisa, serena, humana e consciente dos limites da análise.

As fontes externas e suas verificações em 2026-10-04 estão em
[fundamentos](foundations.md#fontes-e-verificação) e no
[manifesto das fontes](assets/fonts/sources.json).
