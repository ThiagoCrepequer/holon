---
id: RUNBOOK-GITHUB-APP-KEY-ROTATION
kind: operations
status: current
owners:
  - core-team
last-reviewed: 2026-09-03
related:
  - ../decisions/0026-centralize-github-app-keyring-and-enable-zero-downtime-rotation.md
  - deployment.md
  - local-development.md
---

# Runbook: Rotação de Chave Privada do GitHub App

Este runbook define o procedimento operacional para rotacionar a chave privada
do GitHub App utilizado pelo Holon sem indisponibilidade de serviço (_zero downtime_)
e com garantia de compatibilidade com versões N-1 do Cloudflare Worker.

## Pré-requisitos

1. Acesso administrativo às configurações do GitHub App no GitHub.
2. Acesso à CLI do Cloudflare (`wrangler`) com permissão de deploy e segredos no ambiente alvo.
3. Versão do Holon com suporte ao Keyring (ADR-0026) já implantada ou em processo de deploy.

## Visão Geral do Ciclo de Rotação

O GitHub App suporta até **25 chaves privadas ativas simultaneamente**. A rotação
utiliza um modelo de transição segura de cinco etapas:

```mermaid
flowchart LR
    A["1. Gerar Chave Nova no GitHub"] --> B["2. Deploy Atômico de Secrets"]
    B --> C["3. Janela de Observação"]
    C --> D["4. Revogar Chave Antiga no GitHub"]
    D --> E["5. Limpeza de PREVIOUS"]
```

---

## Procedimento Passo a Passo

### Etapa 1: Gerar a nova chave no GitHub App

1. Acesse as configurações da sua organização no GitHub > **Settings** > **Developer settings** > **GitHub Apps** > **[Nome do seu App]**.
2. Na seção **Private keys**, clique em **Generate a private key**.
3. O GitHub fará o download de um novo arquivo `.pem`. Guarde este arquivo em local seguro.
4. _Atenção_: Ambas as chaves (antiga e nova) permanecem ativas simultaneamente no GitHub.

### Etapa 2: Atualização atômica dos segredos no Cloudflare Worker

Para evitar estados intermediários desincronizados entre comandos individuais de `wrangler secret put`,
atualize as variáveis em conjunto ou via deploy versionado:

- `GITHUB_APP_PRIVATE_KEY_CURRENT`: Conteúdo PEM da **chave nova**.
- `GITHUB_APP_PRIVATE_KEY_PREVIOUS`: Conteúdo PEM da **chave antiga**.
- `GITHUB_APP_PRIVATE_KEY`: Conteúdo PEM da **chave nova** (garante que, se houver rollback do Worker para uma versão N-1 que lê apenas a variável legada, ela continue funcionando).

Exemplo via Wrangler:

```bash
wrangler secret put GITHUB_APP_PRIVATE_KEY_CURRENT < nova-chave.pem
wrangler secret put GITHUB_APP_PRIVATE_KEY_PREVIOUS < antiga-chave.pem
wrangler secret put GITHUB_APP_PRIVATE_KEY < nova-chave.pem
```

### Etapa 3: Janela de observação e validação

1. Acompanhe a telemetria do Holon e os logs estruturados no Cloudflare:
   - Verifique a emissão regular de tokens nos quatro fluxos (review, clone broker, CI enrichment e feedback).
   - Confirme que não há eventos `github_app_auth.circuit_breaker_opened` nem `github_app_auth.all_keys_rejected`.
2. Mantenha a chave anterior em observação por pelo menos 1 a 2 horas (ou o tempo correspondente ao ciclo de vida de deploys do seu time).

### Etapa 4: Revogação da chave antiga no GitHub

1. Após constatar a estabilidade dos fluxos autenticando com a chave nova:
2. No GitHub App > **Private keys**, localize a chave antiga (identificada pela data de criação) e clique em **Delete**.
3. A partir deste momento, apenas a chave nova é válida perante a API do GitHub.

### Etapa 5: Limpeza da chave anterior

1. Remova a variável `GITHUB_APP_PRIVATE_KEY_PREVIOUS` do ambiente do Cloudflare Worker:

```bash
wrangler secret delete GITHUB_APP_PRIVATE_KEY_PREVIOUS
```

2. A variável legada `GITHUB_APP_PRIVATE_KEY` deve ser mantida com o valor da nova chave enquanto houver possibilidade de rollback para versões de código que não suportavam as variáveis do Keyring.

---

## Procedimento de Rollback Operacional

Se durante a Etapa 3 (Janela de Observação) a nova chave falhar ou apresentar rejeição:

1. **Ação Automática**: O circuit breaker em memória do Holon redireciona imediatamente as chamadas para `PREVIOUS` assim que a chave `CURRENT` falhar com HTTP 401, evitando impacto imediato aos usuários.
2. **Ação Manual de Rollback**:
   Caso deseje cancelar a rotação e retornar permanentemente para a chave antiga:
   ```bash
   wrangler secret put GITHUB_APP_PRIVATE_KEY_CURRENT < antiga-chave.pem
   wrangler secret put GITHUB_APP_PRIVATE_KEY < antiga-chave.pem
   wrangler secret delete GITHUB_APP_PRIVATE_KEY_PREVIOUS
   ```
   Em seguida, exclua a chave nova não utilizada no GitHub App.
