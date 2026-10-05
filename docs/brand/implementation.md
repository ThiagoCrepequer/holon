---
id: HOLON-DESIGN-INTEGRATION
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Integração e manutenção

## Consumir em uma interface

Carregue `tokens/fonts.css` e `tokens/tokens.css`, ou importe ambos no build
da aplicação preservando as URLs das fontes. Sirva os arquivos localmente.
Selecione o tema com `data-holon-theme="light"` ou `data-holon-theme="dark"`
no elemento raiz. O tema claro é o padrão.

```css
.review-panel {
  color: var(--holon-text-primary);
  background: var(--holon-bg-surface);
  border: var(--holon-border-thin) solid var(--holon-border-subtle);
  border-radius: var(--holon-radius-card);
  padding: var(--holon-space-6);
  font-family: var(--holon-font-sans);
}
```

Os tokens não dependem de Tailwind, React ou de uma biblioteca de componentes.
Em Tailwind, mapeie nomes do tema para as variáveis semânticas. Em outro
framework, mantenha o mesmo significado. Não copiar hexadecimais para cada
componente. Primitivos são usados na definição de tema, amostras e elementos
de marca; componentes usam aliases semânticos.

O JSON é um formato simples do projeto: `primitives` contém valores agrupados,
`themes` contém aliases e referências `{grupo.chave}`. Não é um arquivo de
intercâmbio DTCG nem um plugin de Figma. Importe valores e SVGs na ferramenta
de design e mantenha os nomes semânticos para facilitar a implementação.

## Fronteira de componentes em uma aplicação

A futura `packages/ui` concentra bibliotecas visuais e entrega componentes do
Holon: tokens, acessibilidade, ícones Lucide preferenciais e receitas de motion.
O app compõe páginas e UI de produto; não depende diretamente de cada motor
visual. Esta referência estática não é esse package e não o cria.

A [organização de aplicações web](../engineering/frontend-application-structure.md)
define critérios de extração, interfaces, subpaths e exceções core. Um componente
genérico não importa auth, banco, router do app ou DTO específico de review.
Preserve o contrato útil da marca, evitando wrappers que reproduzem todo o SDK.

## Integrar movimento

Consulte as [receitas de movimento](motion.md) antes de escolher um efeito.
CSS consome as variáveis geradas diretamente. Por exemplo, um disclosure pode
interpolar altura/layout por `--holon-motion-slow` com
`--holon-motion-ease-in-out`; hover usa `--holon-motion-fast`.

Uma futura integração Motion deve ler a mesma fonte de tokens e converter
as durações de milissegundos para segundos. `280ms` corresponde a `0.28`;
a curva CSS padrão corresponde à tupla `[0.2, 0, 0, 1]`. Não passar a variável
CSS de duração como se fosse o número esperado pelo motor nem replicar uma
segunda escala de números nos componentes. O kit nativo não implementa esse
adapter React; ele será parte da prova de integração.

Defina um responsável por propriedade: CSS para cor/hover, Motion para
layout/presença quando necessário, gráfico para sua geometria ou NumberFlow
para dígitos. Evite transições CSS concorrentes sobre transforms controlados
por Motion. Primitivas continuam responsáveis por foco, portal e posição.

CSS respeita `prefers-reduced-motion`; JavaScript usa a preferência equivalente
(`MotionConfig`/`useReducedMotion` na integração candidata), inclusive ao
interromper animações em andamento. Remover loops e stagger também: apenas
configurar Motion não muda animações CSS ou de uma biblioteca de gráficos.

## Atualizar tokens

Na raiz do repositório:

```bash
pnpm brand:generate
pnpm brand:check
```

Edite `docs/brand/tokens/tokens.json` e gere novamente. O comando escreve
`tokens.css` e `contrast-report.json`. O check compara artefatos com a fonte
e verifica os pares de contraste, usando o valor calculado sem arredondar
antes da aprovação. Cores compostas com transparência exigem avaliação
adicional sobre o fundo real.

O comando não faz build, deploy nem altera recursos remotos. Não foi inserido
no gate do runtime: é a verificação específica desta referência de design.
Para alterações no kit, confira também formatação e lint dos arquivos tocados.

## Fontes e performance

Os WOFFs são locais e usam `font-display: swap`. Carregue somente as famílias e
pesos usados naquela página; um painel pode usar apenas Manrope e Mono. Uma
LP pode adicionar Instrument Serif. Não precarrege todas as fontes por padrão.

O fallback sans é Segoe UI/Arial; editorial é Georgia; mono é
SFMono-Regular/Consolas. Verifique a quebra de linha durante o carregamento.
Os TTFs e licenças permitem reproduzir a identidade em ferramentas de design.
As assinaturas SVG não requerem fonte instalada.

## Organização

| Local                      | Responsabilidade                               |
| -------------------------- | ---------------------------------------------- |
| `docs/brand/*.md`          | Regras e contexto da identidade                |
| `assets/logo/`             | Assinaturas oficiais atuais                    |
| `assets/fonts/`            | Fontes, licenças e origem verificável          |
| `assets/patterns/`         | Elementos gráficos decorativos                 |
| `assets/previews/`         | Pranchas de apresentação e exemplos            |
| `tokens/`                  | Fonte de valores, CSS e relatório de contraste |
| `ui-kit/`                  | Referência HTML/CSS/JS com dados fictícios     |
| `explorations/`            | Histórico não ativo                            |
| `tooling/brand/tokens.mjs` | Geração e verificação dos tokens               |

## Evolução da identidade

Uma nova necessidade deve primeiro ser resolvida com tokens e componentes
existentes. Adicione um token quando houver uma função reutilizável e nomeável.
Ao mudar uma cor semântica, verifique os dois temas, estados e combinações de
contraste. Ao mudar uma assinatura, atualize o guia, variantes, exportações e
prévia na mesma entrega; preserve estudos históricos.

Os arquivos ativos não usam sufixos de versão. Git registra as alterações;
explorações usam datas e nomes descritivos. Uma mudança visual não altera
contratos do domínio nem autoriza criar ou reimplantar um admin.

## Roteiro para novos trabalhos

1. Identifique público, tarefa e objeto principal.
2. Leia o guia de marca e a seção relevante de componentes/layout.
3. Use assinatura oficial, fontes locais e tokens semânticos.
4. Modele estados reais antes de compor a tela principal.
5. Verifique temas, responsividade, teclado e conteúdo extremo.
6. Documente novas decisões visuais e os limites da validação realizada.
