---
id: HOLON-DESIGN-FOUNDATIONS
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Fundamentos visuais

## Paleta

| Cor de marca | Valor     | Função                                        |
| ------------ | --------- | --------------------------------------------- |
| Papel 50     | `#FAF9F6` | Fundo editorial e página clara                |
| Papel 100    | `#F3F1EB` | Superfícies secundárias e separação de seções |
| Tinta 900    | `#17243A` | Logo, títulos e leitura principal             |
| Tinta 950    | `#111C2D` | Fundo do tema escuro                          |
| Violeta 500  | `#8864E7` | Núcleo da marca e elementos decorativos       |
| Violeta 700  | `#603EB0` | Ação e links no tema claro                    |
| Violeta 300  | `#C4ADF2` | Ação, foco e núcleo no tema escuro            |
| Sálvia 100   | `#E8EEE6` | Apoio editorial ocasional                     |

Neutros devem dominar a composição. O violeta identifica ação, seleção e
presença de marca; não preencher todo painel com a cor. Sálvia é apoio
editorial, não uma substituição automática para o estado de sucesso.

O núcleo `violet.500` não é a cor do botão primário claro: o botão usa
`action-bg`, que resolve para `violet.700`, com texto branco. As funções
visuais permanecem estáveis enquanto os valores mudam entre temas.

## Tokens semânticos

| Uso                                       | Token CSS                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Página / superfície / agrupamento         | `--holon-bg-page`, `--holon-bg-surface`, `--holon-bg-subtle`                               |
| Texto principal / apoio / metadados       | `--holon-text-primary`, `--holon-text-secondary`, `--holon-text-muted`                     |
| Divisória decorativa / limite de controle | `--holon-border-subtle`, `--holon-border-control`                                          |
| Ação primária                             | `--holon-action-bg`, `--holon-action-fg`, `--holon-action-hover`, `--holon-action-pressed` |
| Seleção / foco / link                     | `--holon-selected-bg`, `--holon-selected-fg`, `--holon-focus`, `--holon-link`              |
| Sucesso / atenção / falha / informação    | `--holon-success-*`, `--holon-warning-*`, `--holon-danger-*`, `--holon-info-*`             |

Cada estado possui `bg` e `fg`. Texto normal exige relação de contraste de
pelo menos 4,5:1; texto grande, 3:1. Para limites necessários à identificação de
controles e sinais de foco, a meta é 3:1 contra a superfície adjacente. O
[relatório gerado](tokens/contrast-report.json) verifica 46 combinações nos
dois temas. Isso verifica as cores escolhidas, não certifica toda interface.

`border-subtle` serve para agrupamento visual redundante. Inputs e controles
que dependem da borda usam `border-control`. Nunca usar apenas cor para
distinguir achado, erro, seleção, execução parcial ou sucesso.

## Tipografia

| Família          | Pesos usados         | Papel                                               |
| ---------------- | -------------------- | --------------------------------------------------- |
| Manrope          | 400, 500, 600, 700   | Interface, títulos, parágrafos e navegação          |
| Instrument Serif | 400 normal e itálico | Expressão editorial em hero, citação ou frase curta |
| IBM Plex Mono    | 400, 500             | Código, SHAs, caminhos, contagens e identificadores |

Manrope é a voz cotidiana. Instrument Serif aparece em no máximo um foco
expressivo por seção e preferencialmente a partir de 32 px; não usar em
controles, tabelas ou texto longo. Mono deve marcar conteúdo técnico, sem
transformar parágrafos inteiros em terminal. Usar algarismos tabulares quando
comparar números, e deixar caminhos quebrarem ou rolarem em sua própria área.

| Estilo             | Desktop  | Mobile   | Peso / altura de linha |
| ------------------ | -------- | -------- | ---------------------- |
| Hero               | 72 px    | 40 px    | 600 / 1,08             |
| Título de página   | 48 px    | 32 px    | 600 / 1,2              |
| Título de seção    | 36 px    | 28 px    | 600 / 1,2              |
| Título de grupo    | 24 px    | 24 px    | 600 / 1,2              |
| Título pequeno     | 20 px    | 20 px    | 600 / 1,2              |
| Introdução         | 18 px    | 18 px    | 400 / 1,625            |
| Corpo              | 16 px    | 16 px    | 400 / 1,625            |
| Interface compacta | 14 px    | 14 px    | 500 / 1,45             |
| Legenda            | 12 px    | 12 px    | 500 / 1,45             |
| Código             | 13–14 px | 13–14 px | 400 / 1,625            |

Os tamanhos são expressos em `rem`; a tabela considera base de 16 px. Não fixar
a raiz para impedir zoom. Corpo corrido deve ocupar aproximadamente 55–75
caracteres por linha, com limite de leitura de 44 rem. Espaçamento negativo
leve (`-0.03em`) é permitido em títulos grandes; não comprimir corpo ou código.

## Espaçamento e forma

A unidade é **4 px**. A escala em px é `0, 4, 8, 12, 16, 20, 24, 32, 40, 48,
64, 80, 96, 128`. Componentes usam tokens, não valores ocasionais por arquivo.

| Relação                | Espaço padrão                   |
| ---------------------- | ------------------------------- |
| Ícone e rótulo         | 8 px                            |
| Rótulo e campo         | 8 px                            |
| Campo e instrução      | 4–8 px                          |
| Elementos relacionados | 12–16 px                        |
| Conteúdo de cartão     | 24 px; 16 px em telas estreitas |
| Grupos de formulário   | 24–32 px                        |
| Seções de painel       | 32–48 px                        |
| Seções editoriais      | 64 px mobile; 96 px desktop     |

Raios: 6 px para pequenos agrupamentos, 10 px em controles, 16 px em cartões,
24 px em painéis destacados. O raio totalmente circular é reservado a pills,
avatares e indicadores. Bordas padrão têm 1 px; foco usa 2 px com afastamento
de 3 px. Elevação baixa é opcional; sombra maior identifica sobreposição.
Não usar sombra para separar cada linha de conteúdo.

## Ícones e camadas

Ícones funcionais usam grade de 24 × 24 px, traço de 1,75 px, pontas e junções
arredondadas. Tamanhos usuais são 16, 20 e 24 px. O conjunto inicial próprio
está em `assets/icons/`: busca, cópia, setas, link externo, confirmação,
fechamento, informação, atenção e pull request. Insira o SVG inline para
herdar `currentColor`; ícones decorativos usam `aria-hidden="true"`.
Controles sem texto precisam de nome acessível que descreva a ação.

Preserve o mesmo peso óptico ao ampliar o conjunto. Não misture emoji, ícones
tridimensionais e conjuntos com espessuras distintas dentro da mesma navegação.
Em plataformas externas como GitHub, símbolos de texto podem complementar
rótulos porque os recursos gráficos são controlados pela plataforma.

| Camada   | Token `layer` | Finalidade                  |
| -------- | ------------- | --------------------------- |
| Base     | 0             | Conteúdo normal             |
| Sticky   | 10            | Cabeçalho ou navegação fixa |
| Dropdown | 20            | Menu ou popover contextual  |
| Overlay  | 30            | Fundo de uma sobreposição   |
| Dialog   | 40            | Conteúdo modal              |
| Toast    | 50            | Feedback auxiliar           |

O stacking context do componente continua relevante; valores altos não
resolvem uma hierarquia incorreta. Elementos nativos na top layer, como
`dialog`, seguem as regras próprias do navegador.

## Fontes e verificação

Verificado em **2026-10-04**. Cópias locais mantêm as licenças OFL e o
[commit e hashes de origem](assets/fonts/sources.json). WOFFs são reempacotamentos
locais dos TTFs, com os mesmos desenhos e metadados.

- [Manrope / Google Fonts](https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/manrope).
- [Instrument Serif / Google Fonts](https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/instrumentserif).
- [IBM Plex Mono / Google Fonts](https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/ibmplexmono).
- [W3C — contraste de texto](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- [W3C — contraste não textual](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
- [W3C — tamanho mínimo de alvo](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
