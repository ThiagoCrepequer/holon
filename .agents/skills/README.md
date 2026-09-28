# Skills compartilhadas do projeto

As skills abaixo foram copiadas para o formato aberto Agent Skills e são
carregadas sob demanda pelo Codex. O conteúdo upstream é mantido sem adaptação;
verifique dependências e instruções específicas do host antes de executar seus
fluxos. Os links apontam para a fonte consultada em 2026-09-28.

| Diretório                                                                                                                  | Origem                                                                          | Uso neste projeto                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ip-as-logo`                                                                                                               | [s1dashu/ip-as-logo-skill](https://github.com/s1dashu/ip-as-logo-skill)         | Mascotes e personagens IP, somente quando solicitados. Inclui licença upstream.                                                                                                                                                         |
| `review`, `qa`, `cso`, `plan-eng-review`                                                                                   | [garrytan/gstack](https://github.com/garrytan/gstack)                           | Revisão, QA, segurança e planejamento de engenharia. Alguns fluxos dependem do setup, scripts, browser ou outros hosts do gstack; a cópia da skill não instala essas dependências.                                                      |
| `layout-grid`, `responsive-design`, `visual-hierarchy`, `design-token`, `accessibility-audit`, `critique-visual-hierarchy` | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills) | UI web/admin, responsividade, design tokens, acessibilidade e crítica visual. A coleção upstream é publicada como plugins Claude Code/Gemini CLI; estes diretórios individuais foram selecionados por conterem instruções autocontidas. |

## Licenças

- `ip-as-logo/LICENSE`: MIT, s1dashu.
- `LICENSES/gstack-MIT.txt`: MIT, Garry Tan. Aplicável às quatro skills gstack.
- `LICENSES/designer-skills-MIT.txt`: MIT, MC Dean. Aplicável às seis skills de design.

Quando atualizar uma skill, confira novamente a estrutura, o conteúdo, as
dependências e a licença no upstream. Atualize esta lista se o conjunto mudar.
