---
id: RESEARCH-2026-10-04-DASHBOARD-MOTION
kind: research
status: current
date: 2026-10-04
verified-at: 2026-10-04
owners:
  - core-team
related:
  - 2026-10-04-dashboard-library-landscape.md
  - ../brand/motion.md
---

# Referências de UI e movimento para o dashboard dos usuários

A [revisão de robustez](2026-10-04-dashboard-plan-robustness-review.md) e o
[plano de implementação](../planning/dashboard-implementation-plan.md) completam
as condições de integração. Compatibilidade visual abaixo não prova SSR/CSP,
autoridade, acessibilidade ou performance. Motion reduzido precisa da receita
instantânea do Holon em todos os motores; o default `reducedMotion` sozinho não
cobre opacidade/cor, stagger e loops. A observação dos anexos continua datada;
não foi usada para inferir suas bibliotecas ou código interno.

## Pergunta e método

As bibliotecas da coletânea conseguem apoiar os padrões das sete referências
fornecidas pelo usuário? Quais comportamentos vale incorporar à marca?

Análise visual de uma imagem e seis vídeos, por amostras distribuídas ao longo
dos clipes e sequências mais densas nos momentos de interação. Foram conferidos
metadados e frames locais. Os anexos não estão versionados no repositório;
os nomes abaixo identificam os originais. Não foram deduzidos código-fonte,
biblioteca usada, curvas exatas ou tempos de execução a partir dos vídeos.

Observações são evidência visual; adequação de bibliotecas e interpretação
para o Holon são inferências. Os tempos indicam onde inspecionar o clipe,
não medição exata da duração de uma transição. Textos, marcas e números dos
anexos são conteúdo de referência, não instruções ou dados do Holon.

## Catálogo e adequação

| ID / original                                   | Evidência visual                                                                                                          | Bibliotecas compatíveis                                              | Aplicação e cuidado no Holon                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0 · `HGMjEf4aIAAF3aB.avif` · 1600 × 1600       | Nós Trigger/Logic, cabeçalho colorido, conteúdo branco interno, portas de conexão                                         | HTML/CSS; React Flow se houver grafo interativo                      | Agrupar unidades e contexto; não criar editor de workflow só pela imagem. Uma imagem não comprova motion                                                 |
| R1 · `DHnYjqgn_DYo2oSz-optimized.mp4` · 10.03 s | Cards compactos; entrada em sequência (0.4–1.4 s), troca vertical de dígitos e sparklines (~2.5–3 s e depois)             | Motion; Recharts ou SVG; NumberFlow no radar                         | Manter tamanho, unidade e contexto; atualizar do número anterior para o real, sem contar de zero em cada refresh                                         |
| R2 · `h1hyPGrorzgJKgPR-optimized.mp4` · 5.57 s  | Tabela com hover discreto, checkbox e seleção parcial no cabeçalho (~1.3–1.6 s)                                           | TanStack Table + checkbox de Base UI/Radix + CSS                     | Table gerencia dados/seleção, a primitiva gerencia semântica; nenhuma delas torna a UI animada por si só                                                 |
| R3 · `qrvS413Cu-7GUvIa-optimized.mp4` · 43.93 s | Detalhe abre pela direita (~1.9–2.3 s), lista permanece sob backdrop; gráficos, atividade e feedback atualizam localmente | Sheet/Dialog acessível + Motion; Query; Recharts; Sonner             | Detalhe de revisão sem perder lista/scroll; operações de sensores do vídeo não definem capacidades do produto                                            |
| R4 · `5s1aVxODcGNEOjQK-optimized.mp4` · 16.53 s | Linha expande métricas (~0.35–0.9 s); filtro reorganiza posições (~11–12.4 s) preservando nomes/ícones                    | Motion layout/presença; CSS para barras; Table se houver tabela real | Expansão de evidência/contexto; IDs estáveis. Não deslocar uma lista em leitura por atualização espontânea                                               |
| R5 · `rJmuTYXGihrmIeT4-optimized.mp4` · 9.32 s  | Nove estudos de pontos em ondas, varreduras e pulsos de opacidade                                                         | CSS/SVG; sem necessidade de GSAP, Canvas ou Lottie                   | Escolher uma onda 3 × 3; loop somente durante espera real, texto e alternativa estática                                                                  |
| R6 · `-mxhilMV3hTYxvIN-optimized.mp4` · 53 s    | Menus ancorados, seleção e check, grupos, rótulos longos, exemplos claros/escuros e RTL                                   | shadcn com Base UI ou Radix; Lucide; CSS/Motion                      | Foco, colisão e teclado pertencem à primitiva. Zoom, cortes, wireframes e mudanças de enquadramento são edição da apresentação, não transições de página |

Em R1/R6, suavização percebida pode incluir efeitos do vídeo ou da edição.
Blur não se tornou regra de interface. Os anexos não demonstram performance,
acessibilidade, hidratação ou compatibilidade Workers das bibliotecas.

## Resultado da comparação

**Sim, a base mapeada é compatível com essas referências.** React/Tailwind
organizam a interface; shadcn fornece componentes adaptáveis; Motion atende
presença e layout; TanStack Table/Query atendem dados e continuidade de estado.
Lucide combina com os traços leves e com a grade/espessura já definidas pela
marca. A aparência exige aplicar fontes, tokens e estados do Holon; o estilo
padrão de uma biblioteca não é o design system.

Recharts permanece candidato direto para linhas, sparklines e métricas
comuns. Barras simples de R4 e pontos de R5 não justificam uma biblioteca de
gráficos. React Flow fica condicionado a uma necessidade real de relações
navegáveis. Motion e CSS cobrem os movimentos observados sem acrescentar
um segundo motor geral de animação.

NumberFlow acrescenta um caminho especializado para R1: recebe um valor e
anima a troca de dígitos. A documentação oferece timing configurável,
`respectMotionPreference` ativo por padrão e suporte a nonce/CSP. Em
2026-10-04, também registra limitações para RTL/dígitos não latinos e
notações científica/engenharia; isso importa diante de R6. Fica como opção,
com fallback estático, não dependência obrigatória.
[Fonte oficial](https://number-flow.barvian.me/).

TanStack Charts merece uma prova comparável a Recharts: tem gramática tipada,
renderização SVG/Canvas e exemplos de motion/shadcn. Está em **alpha**;
minor releases podem quebrar APIs antes de 1.0. Não substituímos a preferência
anterior apenas pela afinidade com o ecossistema.
[Visão oficial](https://tanstack.com/charts/v0) e
[política de estabilidade](https://tanstack.com/charts/latest/docs/stability).

## Definições incorporadas ao design system

O guia canônico [Movimento e continuidade](../brand/motion.md) define receitas
para seleção, troca de estado, popover, drawer, expansão, reordenação,
dados, sequência inicial e indicador. Os tokens mantêm a escala anterior
120/180/280 ms e acrescentam valores com funções nomeadas, saída mais curta
para superfícies e limites de sequência. Valores são decisões da marca.

Adotamos continuidade local, dados legíveis e identidade estável. Não adotamos
paletas dos anexos, animação de câmera, efeitos elásticos, loaders decorativos
ociosos nem métricas/funcionalidades fictícias. Motion reduzido, teclado,
interrupção e foco fazem parte das receitas.

## Próxima evidência necessária

Uma prova React deve comparar expansão com texto longo, fechamento durante
entrada, menu perto das bordas, atualização rápida de gráfico/número e lista
virtualizada. Conferir CSS versus Motion no mesmo componente, evitando dupla
animação. Medir bundles/frames e hidratação na composição escolhida com
Workers; vídeo e documentação não permitem declarar a opção mais performática.

## Validação local do design system

Em 2026-10-04, geração/check dos tokens aprovaram os 46 pares de contraste.
Formatação dos arquivos tocados, lint do JavaScript do kit e `git diff --check`
passaram. Os comandos pnpm usaram Node 24.19.0 e
`--config.verify-deps-before-run=false`: o pnpm tentou reinstalar módulos
automaticamente e interrompeu por ausência de TTY; o override preservou os
módulos locais existentes e permitiu executar os verificadores.

Playwright com Chrome e perfil temporário verificou expansão/fechamento,
reversão durante a transição, Space/foco do disclosure, espera mantendo o
valor anterior, resultado confirmado e preferência reduzida em CSS/JavaScript.
Capturas foram inspecionadas em claro/escuro e mobile; larguras 390/320 px
passaram sem overflow global. Não houve erro JavaScript.

A evidência cobre duas demonstrações nativas do kit. Não foi executado o gate
completo do runtime, benchmark, integração React das bibliotecas, smoke
Cloudflare, leitor de tela ou auditoria completa de acessibilidade.
