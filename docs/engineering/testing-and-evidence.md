---
id: ENGINEERING-TESTING-EVIDENCE
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Testes e evidência de entrega

Escolha testes pelo comportamento observável e pelo limite capaz de falhar por
seu motivo real. Para correção comportamental, reproduza o defeito primeiro;
para capacidade nova, avance em fatias verticais. Um teste que refaz a mesma
fórmula do código ou verifica apenas chamadas a colaboradores internos não
prova o contrato. Consulte a skill [`tdd`](../../.agents/skills/tdd/SKILL.md)
quando desenvolvimento guiado por testes ajudar a tarefa.

## Escolha por responsabilidade

| Mudança                                                   | Teste principal                                                                                                   | Falhas que merecem atenção                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Identidade, lifecycle, fingerprint e veredito em `domain` | Teste puro de casos e estados.                                                                                    | Estados inválidos, repetição e casos limítrofes.                             |
| Caso de uso ou porta em `application`                     | Comportamento pela interface pública com adapters controlados no limite externo.                                  | Output parcial, ordem adversa, negação e efeito duplicado.                   |
| Schema em `contracts`                                     | Parse de exemplo válido e rejeição de entrada inválida; serialização quando persistido/enfileirado.               | Campos desconhecidos, tamanho, versões retiradas e dados hostis.             |
| Diff, configuração e identificação de projetos            | Fixtures pequenas e verificáveis com resultado independente.                                                      | Paths, symlink/lockfile, formatos malformados, omissão e limite de recursos. |
| GitHub, modelo ou executor                                | Teste do adapter e do contrato em seu limite; para Sandbox, incluir Workerd/fixture de comando quando necessário. | Credencial, timeout ambíguo, resposta truncada, egress, escopo e retry.      |
| Queue, Workflow, ledger ou serviço de Worker              | Plugin Vitest oficial para Workers, exercitando bindings, persistência e RPC quando envolvidos.                   | Redelivery, concorrência, supersession, eviction/retry e cleanup terminal.   |
| CLI e schema de editor                                    | Invocação local do comando e comparação com o compilador de configuração.                                         | Drift de schema, erro de entrada e código de saída.                          |
| Avaliação de review                                       | Corpus, recordings, graders e adapter live somente quando autorizado.                                             | Findings falsos/omitidos, cobertura e mudança de modelo/prompt.              |

Os testes concretos ficam em `apps/*/test`, `packages/*/test` e
`tooling/config-cli/test`. O teste de direção de imports fica em
`tooling/architecture` e verifica também ciclos de imports relativos; roda por
`pnpm test:architecture`, `pnpm test` e `pnpm test:coverage`. O control plane
usa a configuração Vitest Workers;
o executor possui testes Node e `vitest.worker.config.ts`. Consulte os scripts
de cada `package.json` antes de escolher comando filtrado.

## Regras de prova

1. Derive o esperado de contrato, exemplo trabalhado ou fixture independente,
   não do mesmo algoritmo sob teste. Mocks servem para limites externos;
   preserve o caminho real interno quando ele é o alvo.
2. Em fronteira de confiança, teste operação permitida e rejeição de entrada
   ou autoridade inválida. Em estado durável, teste repetição e reordenação.
3. Não introduza código de produção, wrappers ou novos exports só para testar
   uma função privada. Prefira a interface observável do módulo.
4. Mantenha testes significativos de regressão; não reduza limiares de
   cobertura, exclua produção do cálculo ou remova falhas para obter verde.
5. Para healthchecks, separe liveness, presença dos bindings atuais e prova de
   disponibilidade remota. Um binding antigo não satisfaz o contrato vigente;
   teste a configuração esperada e a rejeição de aliases retirados.
6. Teste local de modelo com mock não mede qualidade de review. Use
   [avaliações](../operations/evaluations.md) para corpus e live manual,
   distinguindo sua evidência de integração GitHub/Cloudflare real.

## Comandos e escopo

Na raiz, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm test:coverage`, `pnpm build` e `pnpm verify` são os scripts oficiais.
`pnpm verify` inclui validação de configuração, cobertura e build. O build é
local, mas precisa de Docker para a imagem do Sandbox. Para mudança focada,
execute primeiro o script do workspace afetado e amplie quando a integração
atravessar pacotes/deployables. Os exemplos e pré-requisitos estão em
[desenvolvimento local](../operations/local-development.md).

| Evidência                         | O que demonstra                                   | Limite                                                    |
| --------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Teste puro, lint e typecheck      | Contratos e invariantes exercitados localmente.   | Não provam binding Workerd ou recurso remoto.             |
| Vitest Workers/DO                 | Composição local do runtime e estado exercitados. | Não prova GitHub App, conta Cloudflare ou provider reais. |
| Bundle, imagem e Wrangler dry-run | Artefatos construídos localmente.                 | Não é deploy nem smoke remoto.                            |
| Corpus offline                    | Resultado nos casos e recordings versionados.     | Não mede comportamento em PR privado real.                |
| Smoke remoto autorizado           | Caminho específico com integrações reais.         | Não substitui regressão, cobertura ampla ou produção.     |

Relate comandos, sucesso/falha, ambiente e o que ficou sem prova. Não declare
CI, publicação ou produção validados a partir de um gate local.

## Fontes verificadas em 2026-10-03

- [Cloudflare: integração Vitest para Workers](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Cloudflare: regras de Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
