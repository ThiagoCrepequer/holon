---
id: OPERATIONS-GITHUB-APP
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-08-30
---

# Configuração do GitHub App

Verificado em 2026-08-29 contra a documentação REST atual do GitHub.

## Permissões mínimas

| Permissão de repositório | Nível | Motivo                                                                    |
| ------------------------ | ----- | ------------------------------------------------------------------------- |
| Metadata                 | Read  | Concedida implicitamente a GitHub Apps                                    |
| Contents                 | Read  | Clone Git autenticado do repositório selecionado no commit exato (SHA)    |
| Pull requests            | Write | Obter diff/head, publicar inline comments, replies e reviews estruturados |
| Checks                   | Write | Criar e gerenciar o Check Run ("Holon Review") e atualizar vereditos      |
| Actions                  | Read  | Listar e baixar artefatos de cobertura e testes dos workflows do CI       |

Não conceder `Contents: write`, `Issues: write`, administração ou secrets. O
resumo usa uma Pull Request Review com `event=COMMENT` ou `event=REQUEST_CHANGES`
e sincroniza o Check Run correspondente.

### Eventos de Webhook Assinados (Subscribe to events)

Assine os seguintes eventos no GitHub App:

1. `pull_request`: Dispara revisões em `opened`, `reopened` e `synchronize`.
2. `workflow_run`: Dispara a ingestão de evidências de testes e cobertura após a conclusão do CI (`action=completed`).
3. `pull_request_review_comment`: Permite ao Holon escutar e processar comandos ChatOps (`/holon dismiss`, `/holon helpful`).
4. `pull_request_review_thread`: Permite detectar a resolução ou reabertura de conversas no GitHub (`action=resolved`).

Durante o piloto, instale o App apenas em repositórios explicitamente
selecionados.

## Webhook

- URL: `https://<control-plane>/webhooks/github`.
- Content type: `application/json`.
- Secret: valor aleatório forte, igual ao secret binding
  `GITHUB_WEBHOOK_SECRET`.
- SSL verification: habilitada.

O Worker limita o body a 2 MB e verifica `X-Hub-Signature-256` sobre os bytes
brutos antes de fazer parsing. A entrega vira um envelope mínimo sem token.

## Credenciais

Guarde App ID, App slug, chave privada e webhook secret em bindings externos ao
código. Tokens de instalação são emitidos sob demanda e restritos ao repository
ID da run. Eles não entram na Queue, SQLite, parâmetros ou filesystem do Sandbox
e são injetados no tráfego Git somente pelo outbound handler após autorização
do credential broker.

O diff inicial é obtido por `GET /repos/{owner}/{repo}/pulls/{pull_number}` com
media type `diff`. Não substituir essa leitura por comparação direta entre
`base.sha` e `head.sha`: a UI do PR usa merge-base e comparação de três pontos.

Fontes primárias:

- [GitHub App permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
- [Pull request reviews](https://docs.github.com/en/rest/pulls/reviews)
- [Pull request review comments](https://docs.github.com/en/rest/pulls/comments)
- [Comparing branches in pull requests](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/viewing-and-comparing-commits/about-comparing-branches-in-pull-requests)
- [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
