# UI Holon

Primitivas React sem domínio de reviews ou integrações servidor. O app importa
subpaths explícitos; `components.json` direciona o shadcn para este workspace.

## Componentes e procedência

Button, Input, Card, Badge, Dropdown Menu e Sheet adaptam os componentes de **shadcn/ui** sob MIT,
verificados em 2026-10-10 no commit
[`2d3f1cd436b18ea12f24130de4df781355925b08`](https://github.com/shadcn-ui/ui/tree/2d3f1cd436b18ea12f24130de4df781355925b08/apps/v4/registry/new-york-v4/ui).
O Dropdown Menu segue a [composição Base UI no mesmo commit](https://github.com/shadcn-ui/ui/blob/2d3f1cd436b18ea12f24130de4df781355925b08/apps/v4/registry/bases/base/ui/dropdown-menu.tsx).
A [licença original](LICENSE.shadcn.md) acompanha o código. A composição `cva`
materializa variantes de Button/Badge; classes Tailwind v4 substituem receitas
CSS manuais. Input e SelectField compartilham o mesmo dono de label, hint,
invalid e describedby. Os IDs vêm de React `useId`, inclusive em SSR.

A adaptação usa React 19, propriedades/ref nativos e cores/espaçamento/foco
semânticos do Holon. Não importa o catálogo shadcn inteiro nem introduz Slot,
asChild ou Radix. Dropdown Menu usa `@base-ui/react/menu` 1.9.0, conforme
[o componente Base UI solicitado](https://ui.shadcn.com/docs/components/base/dropdown-menu):
Base UI possui roving focus, seleção e fechamento do menu. O app não recria
o comportamento de teclado. Select de formulários usa o controle nativo,
com aparência consistente; Dialog continua `<dialog>` conforme ADR-0054,
com Escape, top layer e retorno ao gatilho. Sheet usa o layout lateral shadcn
com o mesmo ciclo nativo em um módulo privado compartilhado; não adiciona um
segundo motor para dialogs. As jornadas qualificam menu → dialog/Sheet com CSP
estrita nos três engines. A receita CSS própria limita-se ao
ciclo nativo do dialog e à preferência de movimento reduzido.

`styles.css` expõe tokens via `@theme inline`, carrega as três fontes locais e
estabelece foco visível. O consumidor compila Tailwind e escaneia `src/**`.
Não há tema paralelo com hexadecimais nos componentes. A Semente usa a geometria
oficial; assets e tokens vêm de `docs/brand/`. `pnpm brand:check` verifica a fonte.

## Verificação

`pnpm --filter @holon/ui test:coverage` cobre interações, estado busy/disabled,
campos, render seguro, composição e o ciclo do dialog. Os browsers do dashboard
verificam CSS compilado, CSP, foco/teclado, temas e reflow; testes DOM isolados
não demonstram essas propriedades visuais.
