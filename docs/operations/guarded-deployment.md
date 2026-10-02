---
id: OPS-GUARDED-DEPLOYMENT
kind: operation
status: current
owners: [core-team]
last-reviewed: 2026-10-02
---

# Deploy coordenado com confirmação de evidência

A entrada normal é `pnpm run deploy`, na raiz. Os scripts `deploy` dos dois apps e
`deploy:bootstrap` recusam a execução independente; builds/dry-runs permanecem
inalterados. Esta proteção reduz deploys acidentais durante uma revisão, mas não
impede um administrador de executar Wrangler diretamente ou agir pelo painel.
Não é um lock distribuído nem substitui o controle de acesso da conta.

O incidente do PR #107, em 2026-10-02, mostrou troca de versões dos Workers
com uma revisão ativa e reset explícito do Durable Object do Sandbox por
atualização de código. A proteção implementa a sequência do
[runbook de rollout](deployment.md#admissão-e-rollout-do-sandbox-após-o-incidente-do-pr-99),
sem alterar investigação, modelos, orçamentos ou retries.

## Pré-condições e autorização

O comando altera produção: pausa/retoma a fila e publica os dois Workers, incluindo
a imagem do executor. Execute somente em uma janela de deploy autorizada.
É obrigatório terminal interativo; não existe `--yes`, confirmação por variável
ou modo CI não interativo. Não reutilize um registro de confirmação de outra sessão.

- Node 24, pnpm 11.24.0 e dependências instaladas conforme o lockfile.
- Docker disponível para `pnpm verify`, que roda antes de qualquer mutação remota.
- Checkout Git completo, limpo, no SHA de 40 caracteres explicitamente escolhido.
  A guarda revalida SHA/status entre fases. Não use uma cópia parcial do repositório.
- Conta, ID da fila `holon-review-jobs` e ID da aplicação de Containers existentes.
  A aplicação precisa usar `scheduling_policy=default`, como o fluxo de rollout
  gerenciado. O modo `durable_object` não tem o mesmo contrato e é recusado.
- Credencial Cloudflare existente e já autorizada no ambiente como
  `CLOUDFLARE_API_TOKEN`, com acesso às leituras e operações exigidas. O comando não
  cria credenciais, não muda permissões nem salva tokens. Falta de acesso bloqueia.
- Um único operador mantém a janela exclusiva em toda a conta: suspender automações
  de deploy, criações/restarts manuais de Workflows e outras retomadas da fila.
  O lock local não coordena outros computadores. Webhooks podem continuar enfileirados.

```sh
pnpm run deploy \
  --account <account-id-32-hex> \
  --queue <queue-id-32-hex> \
  --application <container-application-uuid> \
  --revision <git-sha-40-hex>
```

`pnpm run deploy --help` não acessa a rede. A conta explícita é usada nas sondagens
REST e no ambiente do Wrangler. Todos os comandos Wrangler fixam `--env ""`
e configuração explícita; origem da API e sanitização de logs são fixadas,
sem herdar seletores de ambiente ou origem alternativa da sessão. Não há argumentos para trocar Worker, Workflow,
configuração, shell, profile ou flags arbitrárias. Os destinos são os dois Workers,
a fila e o Workflow definidos atualmente pelo projeto, no ambiente padrão.

## O que é verificado automaticamente

1. Checkout limpo, versão do toolchain e `pnpm verify`.
2. Antes de mutações, leitura verifica o ID/nome da fila. Após confirmação do destino e da janela exclusiva, pausa da entrega e leitura
   do ID/nome da fila com `settings.delivery_paused === true`.
3. Enumeração completa, sem filtro de data/status, dos Workflows. São terminais
   apenas `complete`, `errored` e `terminated`; qualquer outro estado bloqueia.
   Cursor repetido, página ambígua, identidade duplicada, resposta inválida,
   timeout, limite de páginas ou falha de autorização também bloqueiam.
4. Nova enumeração após a confirmação de drenagem. Uma nova instância, mesmo já
   terminal, invalida o snapshot e exige outra sessão. Isso reduz a janela de corrida,
   mas as listagens não são um snapshot atômico da plataforma.
5. Deploy do control plane e depois do executor, ambos marcados com o SHA do
   checkout, via `wrangler deploy --tag`. Após cada publicação: fila ainda pausada,
   deployment ativo com uma única versão em 100% e tag do SHA esperado. A tag é uma
   declaração de proveniência; não é uma prova criptográfica do conteúdo publicado.
6. Namespace da aplicação deve coincidir com o binding próprio `SANDBOXES`/
   `HolonSandbox` da versão exata do executor; outra aplicação da conta é recusada.
   Aplicação de Containers e todas as páginas de instâncias: aplicação/imagem/versão
   válidas, erros de saúde conhecidos recusados; instâncias em execução devem usar
   a imagem da aplicação. Estados desconhecidos, provisioning, stopping, failed ou
   unhealthy bloqueiam. Instâncias históricas stopped/inactive não provam readiness.
7. Antes de retomar: confirmação específica de rollout, checkout inalterado,
   mesmos deployments/versões/imagem/rollout, nova lista de Workflows e fila pausada.
8. Após retomar: leitura confirma que a entrega não está pausada. Nenhum smoke,
   rerun, abertura de PR ou chamada ao modelo é iniciado pelo comando.

## Evidência que o operador precisa fornecer

Há três confirmações. Cada uma mostra conta, destinos, SHA, sessão e hash do
contexto; exige um ID/referência de registro operacional, sem segredos. A confirmação
final exige digitar os dois IDs de versão do Worker, a imagem e o hash exibidos.
As confirmações são registradas em `.git/holon-deploy-audit/<sessão>.jsonl` com
permissão local restrita. O registro é trilha de auditoria, não detector de mentira
ou substituto da evidência referenciada.

Para confirmar **drenagem**, o registro deve demonstrar:

- batches entregues antes da pausa já concluídos, sem possibilidade de admitir
  outra run; pausa de Queue não cancela consumidores já em trânsito;
- inventário de runs relevantes, incluindo as que já saíram da retenção da API;
- nenhuma run não terminal e nenhuma obrigação de cleanup/supersession pendente
  nos ledgers; eventos `repository.cleanup_completed` podem apoiar o registro,
  mas check concluído, Workflow terminal ou Sandbox destruído isoladamente não
  demonstram ausência de outras obrigações;
- manutenção da janela exclusiva, inclusive para API/painel e outros computadores.

Se o inventário ou a conclusão não puderem ser comprovados, não confirme. Interrompa
com a fila pausada e obtenha a evidência operacional. O projeto não dispõe de um
registro global de quiescência; este patch não inventa um nem consulta um endpoint
inexistente. Backlog zero, duas consultas iguais e esperar alguns segundos não
substituem essa verificação.

Para confirmar **rollout e retomada**, o registro deve identificar a aplicação,
o resultado de rollout concluído no painel, a imagem esperada do build/deploy e os
dois IDs de versão exibidos. Compare-os com a leitura da guarda. Saúde amostrada,
`active_rollout_id`, retorno zero de Wrangler e lista vazia de instâncias **não**
comprovam rollout concluído. A API pública consultada não expõe um GET de rollout
com sinal autoritativo de conclusão; por isso essa confirmação continua manual.
Não confirme apenas por copiar a frase: registre a fonte observada e o resultado.

## Falhas, interrupções e recuperação

- Qualquer falha após iniciar a pausa impede avanço/retomada. A guarda faz uma
  tentativa de pausa de segurança e verifica o resultado. Se a própria pausa ou
  leitura falhar, informa estado não confirmado; não promete que a fila está pausada.
- Resposta perdida após retomada também aciona essa pausa. Não há retry automático
  de deploy ou retomada, rollback automático ou `finally` que libere a fila.
- Deploy parcial pode deixar os Workers em revisões diferentes. Mantenha a fila
  pausada, investigue e execute uma nova sessão autorizada do procedimento completo.
- Não trate cancelamento do processo, perda do terminal, SIGKILL ou queda de rede
  como prova de cancelamento remoto. Verifique fila, processo Wrangler e rollout
  antes de qualquer nova operação. Um lock remanescente deve ser removido apenas
  depois dessa inspeção; nunca roube o lock automaticamente.
- O lock `.git/holon-deploy.lock` cobre o checkout/worktrees locais, não a conta.
  Mudanças externas após a última sondagem continuam possíveis; a janela exclusiva
  é uma pré-condição explícita. A retomada não é atomicamente condicionada ao snapshot.

O bootstrap de uma conta vazia permanece procedimento excepcional explícito no
[runbook de provisionamento](deployment.md#recursos), com tráfego fechado. Os
atalhos antigos agora falham justamente para não confundi-lo com um upgrade normal.

## Validação local

`pnpm test:deploy` executa testes Node com transporte, comandos e confirmações
simulados. `pnpm test:deploy:coverage` mede também sua cobertura, exigindo 90% de linhas/funções e 85% de branches
dos módulos de produção da guarda. Ambos integram
os comandos raiz de teste e cobertura, portanto `pnpm verify` passa por esta suíte.
Não requerem token, Docker, rede ou conta Cloudflare. Nenhum teste invoca `deploy`
real. Os testes não validam permissões reais, esquema observado da conta, imagem,
rollout nem corrida entre administradores; esses itens exigem validação operacional
autorizada. As coberturas mínimas dos workspaces existentes não são alteradas.

## Fontes oficiais consultadas em 2026-10-02

- [Pausa de Queues](https://developers.cloudflare.com/queues/configuration/pause-purge/)
- [Detalhes da fila](https://developers.cloudflare.com/api/resources/queues/methods/get/)
- [Métricas aproximadas](https://developers.cloudflare.com/api/resources/queues/methods/get_metrics/)
- [Instâncias de Workflow e cursor](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/list/)
- [Deployments ativos](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)
- [Versão exata e tag, API beta](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/)
- [Aplicação de Containers](https://developers.cloudflare.com/api/resources/containers/subresources/applications/methods/get/)
- [Instâncias de Containers](https://developers.cloudflare.com/api/resources/containers/subresources/applications/subresources/instances/methods/list/)
- [Semântica de rollout](https://developers.cloudflare.com/containers/configuration/rollouts/)

- [Variáveis de sistema do Wrangler](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)
