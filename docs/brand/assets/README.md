# Arquivos da marca

Os SVGs em `logo/` são os arquivos oficiais da direção Semente. O lettering
está convertido em contornos e preserva sua aparência sem fontes instaladas.
Consulte [logo.md](../logo.md) para tamanho mínimo, proteção e variantes.

- `logo/`: assinaturas, símbolo, avatar e favicon, mais exportações PNG.
- `patterns/seed-field.svg`: composição decorativa de sementes.
- `icons/`: amostras autorais anteriores à preferência por Lucide, grade de 24 px
  e traço de 1,75 px; novas interfaces seguem a [política de ícones](../foundations.md#ícones-e-camadas).
- `previews/brand-overview.png`: apresentação resumida do sistema.
- `fonts/`: Manrope, Instrument Serif e IBM Plex Mono em TTF e WOFF.

## Símbolo para interfaces

- [SVG principal](logo/holon-symbol-primary.svg): vetor responsivo com
  enquadramento quadrado compacto.
- PNG principal transparente: [1024 px](logo/holon-symbol-primary-1024.png) ou
  [2048 px](logo/holon-symbol-primary-2048.png), ambos em proporção 1:1.

As variantes isoladas `primary`, `inverse`, `mono`, `white` e `micro` compartilham
o mesmo `viewBox` de 80 × 80 unidades. A margem transparente é de aproximadamente
3–4% por lado no símbolo padrão. Defina a área de proteção no layout; o arquivo
não inclui esse padding. Avatar, favicon e assinaturas completas mantêm suas
composições próprias.

## Fontes e origem

Fontes baixadas do repositório Google Fonts em 2026-10-04, no commit
`9710da1eacb3be272583c3224dcb70f9da6eadbb`. URLs e hashes estão em
[sources.json](fonts/sources.json): `sha256` verifica o arquivo local;
`sourceSha256`, quando presente, preserva o hash original. Os arquivos
`OFL.txt` tiveram apenas finais de linha e espaços finais normalizados,
sem alteração do texto da licença. WOFF é um reempacotamento local
dos TTFs; não foram alterados os desenhos nem os nomes das fontes.

As formas da logo foram desenhadas para o Holon durante a exploração de marca.
As imagens de inspiração enviadas pelo usuário não foram copiadas para o
repositório nem usadas como arquivos oficiais.
