---
id: ADR-0002
kind: decision
status: accepted
date: 2026-08-29
owners:
  - core-team
supersedes: []
related:
  - ../research/2026-08-29-typescript-monorepo-toolchain.md
  - ../architecture/technical-ecosystem.md
  - ../planning/technical-bootstrap.md
---

# Adotar monorepo TypeScript com pnpm e Turborepo

## Contexto e problema

O MVP tera ao menos um deployable Workers, um executor isolado candidato e
pacotes internos para dominio, casos de uso, contratos e adaptadores. Precisamos
definir um ecossistema reproduzivel sem transformar o task runner em framework
da aplicacao nem criar uma etapa de build para cada pacote antes de ela ser
necessaria.

## Direcionadores

- Favorecer navegacao, diagnosticos e comandos previsiveis para humanos e
  agentes de codigo.
- Usar TypeScript estrito nas fronteiras externas e no dominio.
- Evitar aliases que so existem no compilador.
- Executar typecheck e testes na ordem do grafo de dependencias.
- Preservar a possibilidade de separar deployables sem duplicar codigo.
- Manter cache restrito a tarefas deterministicas.

## Opcoes consideradas

### A. pnpm workspaces sem task runner

- Pros: menos uma dependencia e configuracao minima.
- Contras: scripts recursivos nao modelam tao claramente dependencias entre
  tarefas, outputs e cache conforme o numero de pacotes cresce.

### B. pnpm workspaces com Turborepo

- Pros: usa o grafo do proprio workspace, acrescenta ordenacao, paralelismo,
  filtros e cache sem controlar dependencias ou builds.
- Contras: exige configurar inputs e outputs corretamente e adiciona uma
  ferramenta ao bootstrap.

### C. Nx

- Pros: project graph, tarefas inferidas, affected, generators e recursos de CI
  mais abrangentes.
- Contras: uma plataforma de workspace maior do que o MVP necessita e maior
  custo de configuracao e atualizacao.

## Decisao

Escolhemos a opcao B.

O repositorio sera um monorepo ESM em TypeScript 7. Node.js 24 LTS sera a linha
de runtime para ferramentas locais e CI ate uma migracao explicita. pnpm
workspaces sera a fonte de verdade para pacotes e dependencias; Turborepo sera
usado apenas para compor e armazenar em cache tarefas.

As dependencias internas usarao `workspace:*`. Versoes externas compartilhadas
usarao pnpm catalogs, e ciclos entre workspaces serao rejeitados. A versao do
package manager sera fixada no manifesto raiz quando o bootstrap for executado.

Pacotes internos com consumidores capazes de transpilar TypeScript comecarao no
modelo just-in-time, exportando source por `exports`. Nao usaremos
`compilerOptions.paths`. Pacotes publicaveis ou consumidos sem bundler devem
migrar explicitamente para compilacao com `tsc`.

O toolchain de qualidade sera:

- Oxfmt para formatacao;
- Oxlint com regras type-aware para lint semantico;
- `tsc --noEmit` como autoridade de tipos;
- Vitest para testes;
- `@cloudflare/vitest-plugin` para testes dentro do runtime Workers;
- Wrangler para desenvolvimento, geracao de tipos, bundle e deploy de Workers.

Turborepo podera armazenar localmente resultados de typecheck, testes e builds
deterministicos. Remote cache fica desativado ate haver CI e medicao que o
justifique. `dev`, `deploy`, migracoes e qualquer tarefa com efeito externo nao
serao cacheadas.

## Consequencias

### Positivas

- Um unico contrato de comandos pode atender varios pacotes e deployables.
- Workspace, lockfile e versoes compartilhadas ficam centralizados.
- TypeScript 7 e Oxlint type-aware usam a mesma geracao do sistema de tipos.
- Pacotes puros nao precisam de bundle proprio no primeiro slice.
- O grafo do monorepo fica explicito para pessoas, CI e agentes.

### Negativas

- Turborepo exige disciplina ao declarar inputs, outputs e variaveis de ambiente.
- TypeScript 7 e o toolchain Oxc precisam de validacao conjunta no bootstrap.
- O lint type-aware do Oxlint ainda nao cobre todas as regras do ecossistema
  ESLint.
- Exportar TypeScript diretamente limita os tipos de consumidores dos pacotes.

## Criterios de confirmacao

- Uma instalacao limpa usa um unico lockfile e nao resolve pacote `@holon/*` no
  registry.
- Typecheck atravessa fronteiras de pacote e falha em erro de dependencia.
- O grafo de tarefas executa dependencias antes dos consumidores.
- Uma segunda execucao sem mudancas reutiliza apenas tarefas deterministicas.
- `dev` e `deploy` nunca apresentam cache hit.
- Testes Workers executam no runtime local suportado pela Cloudflare.
- `wrangler types --check` detecta drift entre bindings e tipos versionados.

## Gatilhos para revisitar

- Necessidade real de generators, distributed execution ou affected analysis
  alem do que Turborepo oferece.
- Plugin obrigatorio de ESLint ou Prettier sem equivalente confiavel.
- Pacotes internos passam a ser publicados ou consumidos fora do monorepo.
- Node.js 26 entra em LTS e as dependencias do repositorio o suportam.
- Custos de CI justificam remote cache.
