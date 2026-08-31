---
id: ADR-0016
kind: decision
status: accepted
date: 2026-08-30
owners:
  - core-team
supersedes: []
related:
  - 0013-use-tiered-structural-and-textual-review.md
  - ../architecture/review-runtime-flow.md
  - ../architecture/security-and-trust-boundaries.md
---

# Exigir patches completos e evidência verificável pelo host

## Contexto e problema

Cortar um diff por bytes pode terminar no meio de um hunk e produzir contexto
que nunca existiu no Pull Request. Validar apenas a coordenada do finding também
permite evidência inventada ou obtida por tool fora da superfície publicável. A
reconciliação por marcador, se aceitar qualquer autor ou texto gerado pelo
modelo, pode confundir conteúdo copiado com efeito do Holon.

## Decisão

- ReviewContext V2 contém patches completos por arquivo, com caminho e modo. O
  executor seleciona no máximo 60 kB por arquivo e 120 kB agregados; o request
  de 2 MB e todos esses budgets são medidos em bytes UTF-8.
- O prompt seleciona patches inteiros até seu budget de 64 kB. Um patch que não
  cabe é omitido; nunca se corta arquivo ou hunk. Toda omissão aparece como
  `partial` no resumo.
- O host reconstrói as linhas de new-file do patch canônico e só aceita finding
  quando cada excerpt de evidência existe no path e intervalo declarados. Tool
  output pode orientar investigação, mas não é evidência publicável no MVP sem
  contrato de proveniência próprio.
- A política de paths é única para contexto e tools. Rename/copy é rejeitado se
  qualquer lado cruzar uma exclusão; destinos aparentemente seguros ficam em
  uma política run-scoped que também restringe busca e leitura.
- ast-grep sempre usa configuração confiável em caminho absoluto da imagem.
  Configuração do repositório não pode alterar regras, linguagem ou execução.
- Todo comando possui timeout e limite explícito de output; o host filtra e
  limita resultados novamente antes de devolvê-los ao modelo.
- Findings low-confidence continuam descartados. Findings low-severity válidos
  aparecem apenas no resumo; medium/high podem virar inline. O resumo informa
  review parcial de forma determinística.
- Reconciliação busca somente o endpoint correspondente ao tipo de publicação,
  limita páginas e exige login e tipo `Bot` exatos do GitHub App. Texto com
  aparência de marcador é neutralizado antes de anexar o marcador confiável.

## Alternativas rejeitadas

### Truncar o diff como string

Rejeitada porque cria hunks sintaticamente incompletos e evidência ambígua.

### Confiar na evidência declarada pelo modelo

Rejeitada porque schema estrutural não prova que o trecho existe.

### Aceitar qualquer comentário que contenha o marcador

Rejeitada porque usuário, outro bot ou prompt injection podem copiar o texto.

## Consequências

### Positivas

- Toda evidência publicada é reproduzível no diff canônico recebido.
- Budgets não fabricam patches parciais.
- Configuração e conteúdo do repositório não ampliam tools nem reconciliação.

### Negativas

- Um arquivo grande pode ser omitido por inteiro mesmo quando parte dele caberia.
- Achados que dependem exclusivamente de contexto lido por tool são descartados
  até existir proveniência verificável.
- Paginação limitada pode não encontrar publicação muito antiga; a retenção e o
  ledger continuam sendo a defesa principal.

## Critérios de confirmação

- Teste com patch maior que o budget omite o arquivo inteiro e marca partial.
- Excerpt inexistente, path divergente ou intervalo fora do hunk descarta finding.
- Rename de caminho sensível para caminho comum não aparece em tool alguma.
- `.sgconfig.yml` hostil do repositório não altera ast-grep.
- Marcador copiado por usuário, outro bot ou texto do modelo não reconcilia.

## Evidência

Verificada em 2026-08-30:

- [GitHub REST: review comments](https://docs.github.com/en/rest/pulls/comments)
- [GitHub REST: pull request reviews](https://docs.github.com/en/rest/pulls/reviews)
- [ast-grep CLI run](https://ast-grep.github.io/reference/cli/run.html)
- [ast-grep project configuration](https://ast-grep.github.io/reference/sgconfig.html)
