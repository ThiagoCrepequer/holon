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
por ação manual. O live eval básico chama o adapter de produção diretamente
usando a arquitetura em duas fases (ADR-0018).

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

`AI_GATEWAY_API_TOKEN` deve ter somente `AI Gateway Run`. A chave do provedor
permanece no BYOK do Gateway e não entra no GitHub.

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
prompt, política, modelo ou arquitetura devem ser comparadas na mesma suíte. A OpenAI
recomenda avaliações representativas e contínuas porque saídas generativas são
variáveis; verificação realizada em 2026-08-31:
[Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

O corpus V1 permanece versionado para reproduzir a primeira execução live. A V2
substitui o caso positivo ambíguo por um patch autocontido no qual o novo limiar
literal contradiz uma constante de política preservada no próprio diff. A V3
inclui limites de findings estruturados, prompt injection e revisão parcial.

Fontes verificadas em 2026-08-31:

- [OpenAI model selection and evaluation](https://developers.openai.com/api/docs/guides/latest-model)
- [Cloudflare dynamic routes](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/)
