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
