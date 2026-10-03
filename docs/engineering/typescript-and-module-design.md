---
id: ENGINEERING-TYPESCRIPT-MODULES
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-03
---

# TypeScript, módulos e padrões no Holon

O objetivo da tipagem é tornar estados, entradas e efeitos explícitos sem
esconder o protocolo real. O monorepo usa TypeScript ESM, `workspace:*`, exports
por pacote e a configuração compartilhada em `tooling/typescript/base.json`.
Consulte o [grafo de dependências](../architecture/technical-ecosystem.md) e o
manifest do pacote antes de mover código ou criar um módulo.

## Tipos e validação

- Payload de GitHub, Queue, RPC, storage, arquivo, configuração e modelo é dado
  externo. Faça parse no limite com os schemas de `packages/contracts`; só
  entregue tipos internos após validação. TypeScript não valida bytes recebidos
  nem rows persistidas por outra versão do código.
- Prefira `unknown` em entradas sem contrato, narrowing explícito e uniões
  discriminadas para resultados e estados. Diferencie ausência, `undefined`,
  `null` e falha. Um `throw` ou cast não deve ocultar estado terminal exigido
  pelo caller.
- Use inferência local. Declare tipos públicos onde ajudam o contrato entre
  pacotes, sem duplicar manualmente o shape de um schema Zod. `readonly` e
  tipos de identidade ajudam quando a mutação ou troca de IDs seria erro real.
- Evite `any`, `as`, non-null assertion e `@ts-ignore` para silenciar um limite
  mal definido. Quando o SDK exigir cast, concentre-o no adapter com validação
  e teste focado; não espalhe assertions pelos casos de uso.
- Tipos condicionais, mapped types e genéricos complexos só valem quando
  preservam relação real entre entradas e saídas para vários callers. Se
  exigirem casts em todos os usos ou tornarem o erro ilegível, simplifique.
- O `tsconfig` já ativa `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride` e outras proteções.
  Confira a configuração efetiva antes de propor flag, lint ou helper novo.

## Organização e dependências

| Camada                                                               | Responsabilidade                                         | Dependência que deve evitar                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `domain`                                                             | Identidades e invariantes puras.                         | Zod, GitHub, Cloudflare, AI SDK ou adapter.                     |
| `application`                                                        | Casos de uso, portas e políticas do produto.             | SDK externo ou implementação concreta da porta.                 |
| `contracts`                                                          | Validação de fronteiras e formas serializadas.           | Orquestração e efeitos externos.                                |
| `repository-analysis`, `repository-config`, `project-identification` | Capacidades reutilizáveis a partir de dados delimitados. | Binding de Worker ou autoridade de publicação.                  |
| `github`, `model` e `apps`                                           | Adapters e composição com infraestrutura.                | Regra de domínio escondida no SDK ou no handler.                |
| `evaluation`, `test-kit`, `tooling`                                  | Medição, fixtures ou comandos locais.                    | Dependência de runtime de produção sobre suporte de testes/CLI. |

Use imports ESM explícitos e o `exports` publicado por cada workspace. A
criação de um pacote novo exige fronteira importável e grafo mais claro que
uma subpasta. Uma porta é útil quando protege uma decisão de aplicação frente
a uma capacidade externa; não crie interface que apenas espelha todo um SDK.

## Padrões pelo problema

Nomeie primeiro a regra, o dado e quem precisa conhecê-los. A skill
[`codebase-design`](../../.agents/skills/codebase-design/SKILL.md) ajuda a
escolher a interface e testar se o módulo concentra complexidade.

| Pressão real                                     | Solução comum                                                             | Sinal de excesso                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| API externa muda sem mudar o caso de uso.        | Porta em `application`, adapter em `github`, `model` ou app.              | Interface com todas as opções do SDK e nenhuma política do Holon. |
| Mensagem, Workflow ou publicação pode repetir.   | Identidade determinística, transição condicional e reconciliação durável. | Dedupe apenas em memória ou por texto de log.                     |
| Entrada tem variantes válidas.                   | Schema de fronteira e união discriminada interna.                         | Objeto de muitos campos opcionais com combinações impossíveis.    |
| Regras puras precisam de composição.             | Função ou módulo com interface pequena.                                   | Fábrica, herança ou registry para uma implementação estável.      |
| Duas implementações reais compartilham contrato. | Porta e adapters testáveis no limite.                                     | Abstração criada só para uma possibilidade futura.                |
| Vários callers precisam da mesma invariante.     | Concentrar a regra no módulo dono.                                        | Helpers duplicados ou wrappers que só delegam.                    |

Adapter, Strategy e State são nomes para soluções possíveis, não metas de
quantidade de classes. O [catálogo de padrões](https://refactoring.guru/design-patterns)
ajuda a comparar alternativas. Evite pass-throughs, singletons ocultos,
configuração global mutável, classes para cada função e abstrações que
espalham uma regra causal entre pacotes.

## Evolução de contratos

Holon ainda não mantém contratos públicos de compatibilidade interna. Ao
mudar API, RPC, evento ou payload persistido, altere produtores e consumidores
juntos e retire o caminho interno obsoleto. Isso não autoriza editar migrações
aplicadas, perder dados ou ignorar protocolos externos. A
[ADR-0036](../decisions/0036-use-single-current-development-contracts.md) e
os [contratos executáveis](../contracts/README.md) detalham essa distinção.

## Fontes verificadas em 2026-10-03

- [TypeScript: narrowing e unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript: referência de tsconfig](https://www.typescriptlang.org/tsconfig/)
- [Refactoring Guru: design patterns](https://refactoring.guru/design-patterns)
