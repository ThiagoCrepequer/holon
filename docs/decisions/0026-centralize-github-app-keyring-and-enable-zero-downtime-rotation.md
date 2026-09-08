---
id: ADR-0026
kind: decision
superseded-by: 0036-use-single-current-development-contracts.md
status: superseded
date: 2026-09-03
owners:
  - core-team
related:
  - 0014-version-executor-rpc-and-broker-github-credentials.md
  - 0015-use-causal-admission-and-durable-terminal-cleanup.md
  - ../architecture/security-and-trust-boundaries.md
  - ../operations/github-app.md
---

# Centralizar keyring do GitHub App e habilitar rotação sem indisponibilidade

## Contexto e problema

O Holon dependia de uma única chave privada de GitHub App (`GITHUB_APP_PRIVATE_KEY`),
e a instanciação de sessões Octokit estava dispersa por quatro pontos independentes
do `control-plane`: execução do review/mutação, broker de credenciais para checkout
no Sandbox, enriquecimento de evidências de CI e captura de feedback ChatOps.

O GitHub permite até 25 chaves privadas ativas simultâneas por GitHub App para viabilizar
rotação sem indisponibilidade (_zero-downtime key rotation_). Contudo, um fallback ingênuo
de chave traria riscos severos de produção:

1. Se a chave corrente estiver revogada ou inválida, tentar a chave corrente em todo
   request geraria uma sequência contínua de 401s, ativando a proteção anti-abuso temporária
   do GitHub (HTTP 403) e bloqueando inclusive a chave secundária válida.
2. Uma rotação que revogasse a chave antiga sem manter compatibilidade com versões N-1 do
   Worker causaria indisponibilidade em caso de rollback operacional.
3. Fallback cego em erros de permissão (403), rate limit (429) ou instabilidade de rede (5xx)
   duplicaria chamadas sem resolver a causa raiz.
4. O broker de credenciais convertia indiscriminadamente qualquer erro de resolução de
   instalação em `CredentialRepositoryNotInstalledError`, mascarando falhas de autenticação.

## Decisão

1. **Keyring Centralizado**: Introduzir `GitHubAppKeyring` em `@holon/github` suportando
   `currentPrivateKey` e opcionalmente `previousPrivateKey`. Todos os serviços do
   `control-plane` passam a consumir as credenciais por um único provider centralizado.
2. **Precedência Normativa de Variáveis**:
   - `CURRENT` + `PREVIOUS` + `LEGACY`: `current = CURRENT`, `previous = PREVIOUS` (mantendo `LEGACY` para workers N-1).
   - `CURRENT` + `LEGACY`: `current = CURRENT`, `previous = LEGACY` (durante janela de migração).
   - `CURRENT` apenas: `current = CURRENT`.
   - `LEGACY` apenas: `current = LEGACY`.
   - `PREVIOUS` isolada sem `CURRENT`: rejeição na inicialização (configuração inválida).
   - Chaves idênticas: deduplicação automática para evitar requisições redundantes.
3. **Classificação Estrita e Fallback Cirúrgico**:
   O fallback para a chave anterior é estritamente confinado a erros comprovados de
   autenticação da aplicação:
   - Falha local de importação/validação criptográfica do PEM;
   - HTTP 401 durante a emissão do _installation access token_;
   - HTTP 401 durante a autenticação do App para resolução de instalação.
     Erros de rate limit (403/429), repositório não encontrado (404), erros upstream (5xx)
     e timeouts de rede nunca acionam fallback de chave.
4. **Proteção por Circuit Breaker em Memória**:
   Quando a chave `CURRENT` falha com erro de autenticação e a `PREVIOUS` obtém sucesso,
   o keyring aciona um circuit breaker com TTL configurável (padrão 5 minutos). Durante
   esse intervalo, novas requisições utilizam `PREVIOUS` diretamente, eliminando tempestades
   de 401s e prevenindo bloqueios anti-abuso da API do GitHub. O circuit breaker é resetado
   automaticamente quando uma tentativa futura com `CURRENT` tiver sucesso.
5. **Zero Data Leakage**:
   Identificadores de chave em telemetria são derivados via SHA-256 dos bytes Base64/DER
   normalizados da chave pública/PEM (`key:[a-f0-9]{8}`). Nenhum PEM, JWT ou token é
   registrado em logs.
6. **Preservação de Status no Credential Broker**:
   Somente HTTP 404 é transformado em `CredentialRepositoryNotInstalledError`. Falhas de
   autenticação (401), rate limits (429) e erros transitórios (5xx) preservam sua
   classificação original.
7. **Runbook de Rollout Seguro**:
   A rotação segue o protocolo em 5 etapas documentado em
   `docs/operations/github-app-key-rotation-runbook.md`, atualizando atomicamente
   `CURRENT`, `PREVIOUS` e `LEGACY` antes de qualquer revogação no GitHub.

## Consequências

### Positivas

- Viabiliza rotação de credenciais do GitHub App sem interrupção quando o
  procedimento operacional é seguido e validado no ambiente alvo.
- Mantém um caminho de rollback de código para versões N-1 durante a janela de
  compatibilidade da chave legada.
- Reduz tentativas repetidas com uma chave inválida por isolate via circuit
  breaker em memória.
- Diagnóstico preciso de falhas no broker de credenciais sem mascaramento de causas.

### Negativas

- Gerenciamento operacional temporário de múltiplas chaves durante a janela de transição.

## Estado de verificação

O comportamento foi verificado localmente por testes unitários e pelo gate
`pnpm verify`. Ainda não foi exercitado contra um GitHub App real nem por uma
rotação de secrets em uma conta Cloudflare; portanto, _zero downtime_ permanece
uma propriedade de desenho a confirmar no primeiro rollout controlado.

## Evidência

Verificada em 2026-09-03:

- [GitHub: gerenciamento e rotação de chaves privadas de GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)
- [GitHub: limites de taxa da REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Cloudflare Workers: secrets e upload conjunto](https://developers.cloudflare.com/workers/configuration/secrets/)
