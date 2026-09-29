---
id: OPS-LOCAL-REVIEW-REPRODUCTION
kind: operation
status: current
owners: [core-team]
last-reviewed: 2026-09-29
---

# Reproduzir o PR #106 sem publicar uma revisão

O runner está em `apps/control-plane/local-review/`. Usa código atual contra o
snapshot imutável do incidente, em vez de alterar o checkout ou depender do head
atual do PR:

- Base: `b34acd285eaf0f59cfca6e9b7ffa53d5f5f80c5b`.
- Head: `7299188ca10cd4f20c5c63a05a96f993ee12c216`.
- Expectativa: 32 arquivos elegíveis, 1.368 linhas alteradas, oito shards.
- Configuração lida do objeto Git da base pelo leitor de produção.

## Execução offline

Use Node 24, pnpm 11.24.0, Docker e os dois objetos Git disponíveis localmente.
A imagem `holon-repository-executor-holonsandbox:worker` é construída pelo
`pnpm build` do projeto. O runner falha se imagem ou commits estiverem ausentes;
não faz fetch, instala dependências ou busca credenciais automaticamente.

```sh
pnpm --filter @holon/control-plane test:local-review
```

O Docker monta objetos Git somente para leitura, sem rede, com filesystem de imagem
somente leitura, CPU/memória limitadas e workspace temporário. Cada cenário cria seu
container e o compartilha entre os shards. O ledger solicita cleanup pelo binding
local, que destrói esse container; um `finally` cobre falhas do runner. Nenhum teste
executa scripts do repositório ou publica no GitHub. O servidor local usa porta
aleatória, loopback e capacidade aleatória; limita o tamanho de requests.

São reais: planejamento, composição do reviewer, AI SDK e parsing, reservas SQLite,
preparação de contexto/inventário, ferramentas do executor, verificação de evidência,
reconciliação, serialização da publicação e alarm do ledger. São adaptados:
transporte do Sandbox, steps imediatos do Workflow, sessão GitHub e resposta HTTP
do provider. A sessão coleta os efeitos que seriam enviados ao GitHub.

Cenários:

1. Conclusão completa sem achados: `APPROVE`.
2. Dois checkpoints inválidos seguidos de reparo por parte: `APPROVE`, com rejeições registradas.
3. Defeito proposital adicionado apenas ao snapshot temporário: `REQUEST_CHANGES` e comentário na linha 3.
4. Falha permanente de provider numa parte: comentário informativo, sem aprovação.
5. Checkpoints persistentemente inválidos: incompletude, sem aprovação e encerramento limitado.

O terceiro caso testa transporte, evidência e publicação de um achado conhecido;
o provider simulado recebe uma resposta programada. Não demonstra detecção pelo modelo.
A suíte normal pula esse runner quando não há bridge; o comando explícito acima
é obrigatório para validar essa composição com Docker. `pnpm verify` continua
validando os testes unitários/Workers e os limites de cobertura existentes.

## Avaliação local com modelo real

Esta modalidade envia contexto privado para um serviço externo e consome tokens.
Exige autorização explícita e credencial com acesso ao gateway pretendido. Não
confundir com teste offline. A credencial fica somente no processo, nunca na fixture.

```sh
AI_GATEWAY_ACCOUNT_ID='<conta autorizada>' \
AI_GATEWAY_ID='<gateway autorizado>' \
HOLON_CREDENTIAL_FILE='<arquivo local com CLOUDFLARE_API_TOKEN>' \
pnpm --filter @holon/control-plane test:local-review --live
```

Também aceita `CLOUDFLARE_API_TOKEN` no ambiente. A rota é `dynamic/pr-review`.
O modo live envia apenas o shard de índice 3; os outros sete mantêm respostas
simuladas. Limites independentes: quatro requests externos, 300.000 bytes cumulativos
de request, 60 segundos por chamada, resposta de até 1 MB. Os máximos de saída do
ledger continuam aplicados. Limites excedidos fazem o teste falhar, sem ampliar
automaticamente o orçamento. O Gateway recebe instrução de não coletar payload de
log e de ignorar cache. Metadados identificam `local-evaluation`/`pr106-shard3`.

O relatório registra contagens, status e veredito, sem prompts, código, respostas
ou credenciais. Um teste live verde dessa parte não comprova a revisão real das oito
partes, a estabilidade estatística do provider, custos de produção ou a operação
remota de Workflows/GitHub/Sandbox. Antes de ampliar uma avaliação, inspecione a
primeira execução e defina um orçamento explícito; não repita automaticamente.

## Evidência local em 2026-09-29

Os cinco cenários offline passaram. Com o provider programado, o cenário normal
fez 25 requests de modelo simulados e oito consultas reais ao executor; o cenário
de reparo fez 41 requests simulados e registrou 16 rejeições. A fixture com defeito
produziu uma publicação `REQUEST_CHANGES` e um comentário inline. Todos os cenários
confirmaram cleanup concluído no ledger e destruição do container. `pnpm verify`
passou sem alteração dos limites de cobertura. Esses números não estimam custo
ou qualidade de um modelo real. O modo live não foi executado nesta evidência.
