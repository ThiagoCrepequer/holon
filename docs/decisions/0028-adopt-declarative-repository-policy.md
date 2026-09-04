---
id: ADR-0028
kind: decision
status: accepted
date: 2026-09-03
owners:
  - core-team
related:
  - 0013-use-tiered-structural-and-textual-review.md
  - 0014-version-executor-rpc-and-broker-github-credentials.md
  - 0015-use-causal-admission-and-durable-terminal-cleanup.md
  - 0019-derive-deterministic-review-verdict-by-policy.md
  - ../architecture/security-and-trust-boundaries.md
---

# Adotar configuração declarativa por repositório com ancoragem na base e revalidação dual

## Contexto e problema

Repositórios demandam customização de escopo e rigor de revisão, tais como excluir caminhos
gerados ou dependências (`vendor/**`, `generated/**`) e configurar a sensibilidade do veredito
(`verdict.strictness: block_all_confident_medium`). No entanto, pull requests constituem uma
fronteira não confiável (_untrusted boundary_). Permitir configuração declarativa traz riscos críticos
de segurança e confiabilidade:

1. **Bypass de revisão via PR**: Se o arquivo de política for lido do `headSha` proposto no PR, um
   autor malicioso poderia adicionar regras como `additional_excludes: ["**"]` para desativar a revisão
   de código vulnerável ou backdoors inseridos no mesmo PR.
2. **Deriva da branch base e autorização inválida**: Se a política for avaliada no início e a branch
   base avançar durante a execução da review, a análise pode ser publicada contra uma política obsoleta
   ou inválida. A causalidade exige revalidação do par `{ headSha, baseSha }`.
3. **Exclusões universais e cegueira de revisão**: Permitir padrões como `*` ou `**/*` esvazia
   completamente a revisão, transformando o bot em um mecanismo inútil de aprovação cega.
4. **Manipulação de arquivos de governança e segurança**: Excluir arquivos de política (`.github/holon.yml`),
   workflows de CI/CD (`.github/workflows/**`), políticas de segurança (`SECURITY.md`) ou atribuição
   de donos de código (`CODEOWNERS`) desativa a vigilância em superfícies vitais do repositório.
5. **Vulnerabilidades de parser YAML**: Ataques de negação de serviço (Billion Laughs / YAML bombs),
   âncoras recursivas, merge keys e instanciação de tags customizadas podem comprometer o control-plane.
6. **Downgrade silencioso de RPC**: Caso um executor desatualizado receba uma requisição com política
   customizada e a trate como versão legada (sem aplicar as exclusões), a política do usuário seria
   silenciosamente ignorada.

## Decisão

1. **Ancoragem Exclusiva no `baseSha`**:
   O arquivo de configuração (`.github/holon.yml` ou `.holon.yml`) é lido única e exclusivamente do
   commit canônico da branch base (`baseSha`) através da GitHub Contents API (`ref: baseSha`). O
   conteúdo proposto no PR (`headSha`) é estritamente ignorado para fins de política.
2. **Revalidação Dual Obrigatória (`{ headSha, baseSha }`)**:
   Antes de publicar qualquer finding, resposta de resolução, resumo ou Check Run terminal com
   resultado, o Workflow revalida atômica e
   determinística a identidade do PR consultando os refs ao vivo no GitHub. Se `headSha` OU `baseSha`
   tiverem avançado, o workflow aborta imediatamente com status `stale` / cancelamento durável,
   impedindo a publicação de resultados baseados em políticas ou bases desatualizadas. A única
   mutação terminal permitida depois dessa detecção é concluir o Check Run já ancorado ao SHA antigo
   com `conclusion: cancelled`; ela não contém resultado da análise.
3. **Parser YAML Blindado e Fail-Closed**:
   - O parser utiliza `YAML.parseDocument`, percorre a AST e rejeita aliases, âncoras, tags explícitas
     e merge keys antes de chamar `toJS({ maxAliasCount: 0 })`.
   - Tamanho máximo do arquivo limitado a 64 KiB e rejeição de caracteres ASCII de controle nulos.
   - Exclusão de ambiguidade: a presença simultânea de `.github/holon.yml` e `.holon.yml` resulta em
     `RepositoryPolicyConflictError`.
   - Quaisquer erros de sintaxe, schema ou segurança encerram o workflow com `NonRetryableError` e
     publicam um Check Run informativo com conclusão `failure`.
4. **Caminhos Permanentemente Protegidos**:
   A lista de caminhos protegidos (`.github/holon.yml`, `.github/holon.yaml`, `.holon.yml`, `.holon.yaml`,
   `.github/workflows/**`, `SECURITY.md`, `.github/SECURITY.md`, `CODEOWNERS`, `.github/CODEOWNERS`,
   `docs/CODEOWNERS`) não pode ser excluída em hipótese alguma. Qualquer tentativa de exclusão é
   rejeitada na validação de schema (`RepositoryPolicySecurityError`).
5. **Proibição de Wildcards Universais e Modelo de Waivers**:
   Padrões que representam exclusão irrestrita (`*`, `**`, `***`, `*/*`, `**/*`, etc.) são proibidos.
   Arquivos suprimidos pela política são contabilizados explicitamente como waivers de cobertura
   (`waiversCount`). Se todos os arquivos de um PR forem dispensados por política, o escopo resultante é
   marcado como `partial_by_policy`, com 0 arquivos analisados e N waivers declarados, nunca `unsupported`.
   Se apenas parte dos arquivos for dispensada, os shards restantes continuam sendo analisados; os
   caminhos protegidos têm precedência sobre qualquer glob adicional tanto no contexto quanto nas tools.
6. **Contrato RPC V3 sem Downgrade Silencioso**:
   - Novos schemas versionados: `ExecutorRequestV3`, `ReviewContextV3`, `PreparedRepositoryV3` e
     `ReviewScopePolicyV2`.
   - Se uma política personalizada estiver ativa (`source !== "default"`), o control-plane exige
     estritamente `prepareRepositoryV3` / `loadContextV3`. Qualquer tentativa de downgrade para V2 ou V1
     é sumariamente bloqueada com `NonRetryableError` (_fail-closed_).
7. **Rastreabilidade por Dois Digests SHA-256**:
   - `sourceDigest`: hash criptográfico dos bytes UTF-8 brutos do arquivo original (ou `null` se default).
   - `effectivePolicyDigest`: hash canônico do JSON normalizado da política aplicada.
     Ambos os digests são propagados para o contexto de execução, telemetria e saída do Check Run.
8. **Configuração de Veredito Declarativa**:
   Suporte a `verdict.strictness`: `"default"` ou `"block_all_confident_medium"`. Quando ativado,
   o control-plane injeta `{ mediumSeverityThreshold: 1 }` na política de veredito, bloqueando PRs
   com achados médios de alta confiança.

## Consequências

### Positivas

- Segurança preservada: PRs não podem fraudar suas próprias diretrizes de segurança ou desativar análises.
- Integridade causal: execuções não publicam análises baseadas em bases defasadas.
- Rastreabilidade ponta a ponta: o resumo do PR e o Check Run exibem a fonte da política e o número de waivers.
- Imunidade a ataques de DoS por YAML bombs e ReDoS via `matchesPathGlob` determinístico.
- Garantia de que políticas customizadas nunca serão silenciosamente desativadas por downgrades acidentais.

### Negativas

- Quando um PR altera a própria política no `headSha`, essa nova política só passará a valer para PRs
  futuros após o merge para a branch base padrão.
- Adições de novas branch bases que avançarem rapidamente podem requerer novas sincronizações de PR.

## Estado de verificação

O comportamento foi validado através de suítes de testes unitários e de integração em todos os pacotes
modificados (`contracts`, `domain`, `github`, `repository-analysis`, `repository-executor` e `control-plane`),
além da execução completa do portão de qualidade `pnpm verify`.

## Evidência externa

Verificada em 2026-09-03:

- [Cloudflare — Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/):
  steps concluídos persistem seu resultado, enquanto estado em memória fora de steps não é durável.
- [Cloudflare — Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/):
  `NonRetryableError` encerra imediatamente erros permanentes sem repetir o step.
- [GitHub — Repository contents](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28):
  leitura de conteúdo por API, incluindo conteúdo Base64 e seleção de ref.
- [GitHub — Check runs](https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28):
  atualização terminal exige `conclusion` e suporta `cancelled`, `failure`, `neutral` e `success`.
