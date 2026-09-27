---
id: OPERATIONS-REPOSITORY-CONFIGURATION
kind: reference
status: current
owners: [core-team]
last-reviewed: 2026-09-09
---

# Configuração de review e editores

A [ADR-0037](../decisions/0037-compile-repository-configuration-per-run.md)
governa o contrato. A implementação está disponível para validação local; esta
entrega não comprova deploy, permissões do GitHub App ou inferência live.

## Arquivo e autoridade

Use `.github/holon.yml` ou `.holon.yml`, nunca os dois. Ausência comprovada de
ambos usa defaults: `en`, `concise`, 40 novos comentários inline. O workflow lê
configuração, instruções e referências do **base SHA exato** observado no evento.
Alterar o YAML no PR não muda a configuração aplicada à própria review.
Configuração inválida falha antes do Sandbox; erro de acesso não vira ausência.

```yaml
output:
  language: pt-BR
  detail: detailed
  max_inline_comments: 10
review:
  focus: [correctness, security]
verdict:
  strictness: block_all_confident_medium
instructions:
  - |
    Verifique a autorização antes de retornar dados de outro tenant.
    Preserve os trechos de código usados como evidência.
```

Exemplos completos: [mínimo](../contracts/examples/holon-minimal.yml),
[monorepo](../contracts/examples/holon-monorepo.yml) e
[referências](../contracts/examples/holon-references.yml). O contrato estrutural
é [input.ts](../../packages/contracts/src/repository-config/input.ts).

O próprio Holon usa [`.github/holon.yml`](../../.github/holon.yml) como exemplo
comentado de todas as opções. Ele configura saída em português, detalhe completo,
rigor alto, os workspaces reais e regras por caminho. O modeline aponta para o
schema local, permitindo usar o exemplo no editor antes de qualquer deploy.
A validação dessa configuração faz parte de `pnpm verify`, antes dos testes e
builds, para detectar opções ou referências inválidas no próprio repositório.

## Composição e efeitos

`instructions` aceita texto multilinha ou `{ path: docs/review.md }`.
Referências de instruções de projeto são relativas ao seu `root`; as globais e
as de `path_rules` são relativas à raiz do repositório. Não há includes recursivos.
`review.reference_files` fornece contexto, sem autoridade de instrução.

Para cada arquivo, aplicam-se instruções globais, depois as do projeto com root
mais específico e depois as regras correspondentes na ordem declarada. Um
projeto filho não herda implicitamente instruções do pai. Nomes e roots duplicados
são inválidos. Roots devem existir na base; caminhos são sensíveis a maiúsculas.

`review.focus` prioriza temas sem desabilitar outros defeitos. Exclusões adicionais
não alcançam paths protegidos nem relaxam a autorização das tools. Idiomas
suportados: `en`, `pt-BR`, `es`; código, paths, identificadores e evidências não são
traduzidos. `detail` regula narrativa. `max_inline_comments` aceita 0–40 e limita
novos comentários; summary, Check Run, análise, veredito e resultados integrais
no console permanecem. O rigor `block_all_confident_medium` permite que um único
medium com confiança suficiente bloqueie, inclusive no recálculo por feedback.

Compatibilidade declarada em `projects[].compatibility` permanece separada de
versões detectadas. O console mostra escopo declarado e associação aos IDs dos
projetos detectados. Resultados: `matches`, `conflicts`, `unknown`, `not_detected`.
Ranges npm usam SemVer; Python usa PEP 440. Java compara famílias numéricas;
intervalos/qualificadores Maven aceitos sem comparação segura ficam `unknown`.
Declarações condicionais, tecnologias desconhecidas e detecção incompleta não
viram afirmações de compatibilidade. Conflito isolado não prova um defeito.

## Validação local

Na raiz do checkout Holon, informe o diretório do repositório a validar:

```bash
pnpm config:validate --directory /caminho/do/repositorio
pnpm config:explain --directory /caminho/do/repositorio --path apps/api/src/main.ts
pnpm config:validate --directory /caminho/do/repositorio --ref HEAD
pnpm config:explain --directory /caminho/do/repositorio --ref HEAD --path apps/api/src/main.ts
pnpm config:schema:check
```

Sem `--ref`, a CLI valida o working tree; com `--ref`, resolve a referência para
um SHA e lê objetos Git sem checkout. Para simular a autoridade de produção,
forneça o SHA da base; validar `HEAD` é um preflight da configuração proposta.
Não altere o working tree simultaneamente à validação local. A CLI não busca
refs remotas nem instala dependências do repositório. A saída inclui metadados,
digests e origens das instruções, sem imprimir textos privados. Erros incluem
código e localização segura quando disponíveis, nunca trechos do documento.

## Editor e schema

O control-plane serve o artefato do build em `/schemas/holon.schema.json`, com
GET/HEAD, ETag, revalidação e CORS público. Use o host real do seu deploy:

```yaml
# yaml-language-server: $schema=https://SEU-HOST/schemas/holon.schema.json
```

No VS Code com a extensão YAML da Red Hat, esse modeline habilita autocomplete,
hover e diagnósticos estruturais. Também é possível associar o arquivo local
`docs/contracts/holon.schema.json` nas configurações `yaml.schemas` do editor.
O runtime ignora o comentário e não acessa URLs de schema. O editor não verifica
existência na base, limites agregados em bytes, proteção de paths ou semântica
de versões; execute a CLI para esses gates. O schema é draft-07 gerado de Zod:
`pnpm config:schema:generate` atualiza schema e identidade do compilador; o CI
falha se os artefatos divergirem dos fontes.

## Limites e privacidade

| Recurso                 | Limite      |
| ----------------------- | ----------- |
| YAML                    | 64 KiB      |
| Arquivo referenciado    | 32 KiB      |
| Fontes agregadas        | 256 KiB     |
| Snapshot serializado    | 512 KiB     |
| Instrução inline        | 16 KiB      |
| Guidance por shard      | 32 KiB      |
| Arquivos referenciados  | 32          |
| Instruções              | 200         |
| Projetos / regras       | 20 / 50     |
| AST: profundidade / nós | 12 / 10.000 |

Aliases, âncoras, tags explícitas, merge keys, URLs, traversal, symlinks,
submodules e ponteiros LFS não são fontes válidas. O compilador rejeita estouro;
não trunca instruções obrigatórias. Guidance de todos os shards é projetado e
verificado antes de iniciar a inferência de review. O preflight de prompt usa
um orçamento conservador para rotas com janela mínima de 128K; isso não substitui
o limite final do provedor para toda a conversa de ferramentas.

Texto de configuração resolvido é privado, em chunks no DO do PR, e recebe
cleanup terminal durável mesmo quando não houve Sandbox. Metadados/digests e
preferências necessárias ao feedback permanecem. Resultados verificados dos
findings são retidos separadamente para leitura autenticada no console, incluindo
sugestões e evidências que não foram publicadas por causa do cap. Não são enviados
a D1 ou logs. O prazo geral de retenção/deleção do ledger continua pendente em
[ciclo de vida dos dados](../architecture/data-lifecycle.md).

## Rollout coordenado

Esta mudança é incompatível com estado de desenvolvimento anterior: run IDs
incluem head e base, e snapshots/decisões possuem novos campos. Antes de um deploy
autorizado, drene runs antigas, confira cleanup, atualize consumidores juntos e
valide o schema servido. Um eventual reset de desenvolvimento exige autorização
separada; nenhum comando de CLI/generação executa reset ou migração remota.
Eventos exclusivos de mudança da base e reexecução manual da mesma dupla não
são automatizados por esse YAML. Use novas runs sintéticas para o smoke live.
