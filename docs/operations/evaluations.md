---
id: OPERATIONS-EVALUATIONS
kind: runbook
status: current
owners:
  - core-team
last-reviewed: 2026-08-31
---

# Execução das avaliações

Holon mantém avaliação offline em Pull Requests e avaliações com modelo somente
por ação manual. O live eval básico chama o adapter de produção diretamente. A
comparação opcional implanta um terceiro Worker **exclusivo de avaliação** para
exercitar Agents SDK/Think; ele não recebe webhooks nem participa do review de
produção.

## Pull Requests

`.github/workflows/evaluation-offline.yml` executa:

1. testes do pacote com subjects mockados;
2. corpus V3 contra recordings sintéticas versionadas;
3. resumo no GitHub Actions Job Summary;
4. relatório `recorded-output.json` como artifact por 14 dias.

Esse workflow possui apenas `contents: read`, não recebe secrets e a execução
da avaliação não chama provedores externos. A instalação reproduzível das
dependências ainda acessa o registry configurado pelo runner. O relatório contém
configuração, IDs, métricas e tipos enumerados de falha; não contém patches nem
respostas integrais.

## GitHub Environment live-evaluation

Crie o Environment `live-evaluation` em **Settings > Environments** e, quando o
plano do repositório oferecer essa protection rule, restrinja as deployment
branches a `main`. O próprio workflow rejeita refs diferentes de `main`, mesmo
quando a proteção do Environment não estiver disponível. Uma aprovação
obrigatória também pode ser adicionada, quando suportada, para impor revisão
humana antes de liberar o secret.

Configure como Environment variables:

```text
AI_GATEWAY_ACCOUNT_ID
AI_GATEWAY_ID
AI_MODEL_ID=dynamic/pr-review
```

Configure como Environment secret:

```text
AI_GATEWAY_API_TOKEN
```

Para executar também a comparação de harnesses, acrescente:

```text
# Environment variable
THINK_EVALUATION_URL=https://holon-harness-evaluation.<subdomain>.workers.dev/

# Environment secret
THINK_EVALUATION_API_TOKEN
```

O token deve ter somente a permissão necessária para executar o AI Gateway. A
chave do provedor permanece no BYOK do Gateway e não entra no GitHub.

Secrets de Environment só ficam disponíveis depois que as protection rules
forem satisfeitas. Fonte verificada em 2026-08-31:
[GitHub Environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

## Live model manual

Em **Actions > Evaluation (live model) > Run workflow**, selecione `main`. O job
também verifica `refs/heads/main`; outra branch fica inelegível. Uma única
execução live pode ocorrer por vez e execuções manuais não são canceladas por
uma solicitação posterior.

O workflow:

1. faz checkout do SHA selecionado;
2. instala o lockfile exato;
3. envia somente os cinco casos sintéticos V3 ao modelo pela rota dinâmica;
4. aplica validação canônica e graders locais;
5. escreve o Job Summary;
6. salva `live-model.json` por 30 dias;
7. termina com falha quando algum caso, contrato ou subject falha.

O header de coleta de payload permanece negado e o cache do Gateway é ignorado,
conforme o adapter de produção. A rota dinâmica exige Gateway autenticado e
Provider Keys/BYOK. Fonte verificada em 2026-08-31:
[Cloudflare dynamic routes](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/).

As ferramentas retornam somente o estado enumerado
`self_contained_evaluation_case`; esse modo mede o prompt e o modelo a partir do
contexto presente no corpus. Ferramentas reais, clone, Sandbox, ledger e
publicação pertencem ao smoke remoto separado.

## Interpretação

O corpus atual possui cinco casos de desenvolvimento. Um resultado verde prova
esses casos, não qualidade geral nem prontidão para produção. Mudanças de
prompt, política, modelo ou harness devem ser comparadas na mesma suíte. A OpenAI
recomenda avaliações representativas e contínuas porque saídas generativas são
variáveis; verificação realizada em 2026-08-31:
[Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

O corpus V1 permanece versionado para reproduzir a primeira execução live. A V2
substitui o caso positivo ambíguo por um patch autocontido no qual o novo limiar
literal contradiz uma constante de política preservada no próprio diff.

## Comparação manual de harnesses

O workflow **Evaluation (harness comparison)** só aceita `main` e usa dois
GitHub Environments. `harness-evaluation` implanta o Worker experimental no SHA
exato; `live-evaluation` libera as credenciais do modelo e o token de chamada.
O segundo job só inicia depois do deploy.

Configure `harness-evaluation` com:

```text
# Environment variable
CLOUDFLARE_ACCOUNT_ID

# Environment secret
CLOUDFLARE_API_TOKEN
```

O token de deploy deve ser limitado ao Worker experimental. No runtime do
Worker, configure uma única vez as variables `AI_GATEWAY_ACCOUNT_ID`,
`AI_GATEWAY_ID` e `AI_MODEL_ID`, e os secrets `AI_GATEWAY_API_TOKEN` e
`THINK_EVALUATION_API_TOKEN`. O deploy usa `--keep-vars` e muda somente
`SOURCE_REVISION`; secrets remotos nunca são removidos pelo deploy.

Cada execução compara três trials dos mesmos cinco casos em quatro braços:

1. structured output com o schema de domínio atual;
2. structured output com schema JSON-portável;
3. tool terminal `submit_review` no AI SDK;
4. `ThinkWorkflow.step.prompt()` com a mesma saída portável.

Os braços são executados sequencialmente para evitar concorrência contra a rota
do provider, mas a ordem inicial é rotacionada a cada trial. A identidade de
execução combina `run_id` e `run_attempt`; portanto, um re-run não reutiliza o
Workflow durável de uma tentativa anterior.

O relatório `harness-comparison.json` mantém cada suíte e agrega conclusão,
aprovação no grader, precisão, recall, outputs inválidos, erros de subject,
tokens, tool calls e latência por braço. Custo monetário deve ser correlacionado
separadamente no AI Gateway pelo `evaluation_run_id`, pois a resposta compatível
não o fornece. O relatório não contém prompt, patch nem resposta completa, e não
escolhe vencedor automaticamente. Uma opção só deve ser promovida após os
critérios do [ADR-0017 proposto](../decisions/0017-select-review-output-harness-from-evidence.md)
e uma validação holdout.

O endpoint experimental aceita somente IDs existentes em `baseline-v3`; o
corpus é carregado dentro do Worker. O caller nunca envia diff ou prompt. O
endpoint também atesta account, Gateway, rota de modelo e SHA contra o runtime,
rejeitando qualquer drift entre os braços. O Agent desabilita workspace Bash,
MCP, fetch, reasoning e armazenamento de mensagens/tools, e o status expõe
somente resultado validado, telemetria numérica e razões enumeradas. Um callback
durável destrói o Agent e seu estado após um dia, alinhado à retenção do
Workflow.

Fontes verificadas em 2026-08-31:

- [Wrangler deploy e `--keep-vars`](https://developers.cloudflare.com/workers/wrangler/commands/#deploy)
- [Cloudflare Think Workflows](https://github.com/cloudflare/agents/blob/main/docs/think/workflows.md)
- [Cloudflare harnesses](https://developers.cloudflare.com/agents/harnesses/)
