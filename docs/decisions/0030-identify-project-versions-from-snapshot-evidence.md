---
id: ADR-0030
kind: decision
superseded-by: 0036-use-single-current-development-contracts.md
status: superseded
owners: [core-team]
last-reviewed: 2026-09-05
---

# Identificar versões por projeto com evidências do snapshot

## Decisão

Implementar a identificação aprovada no [plano](../planning/project-version-identification-plan.md), com resultado por raiz/ecossistema em `@holon/project-identification`. O pacote não executa builds nem acessa provedores, GitHub ou storage. Parsers fornecem fatos; o adapter do modelo classifica tecnologias usando exclusivamente IDs desses fatos. O verificador do host preserva versões e não permite que o modelo invente ou apague declarações.

O resultado diferencia faixa declarada, declaração exata, lockfile, configuração de runtime, alvo de compilação e condição não resolvida. `complete` descreve a coleta dentro do suporte estático, não uma certificação do ambiente implantado. Herança externa e scripts dinâmicos permanecem explicitamente não resolvidos.

A coleta usa blobs Git do SHA autorizado e a política efetiva ancorada na base. `discoverProjectMetadataV1` combina inventário e leitura limitada no executor: conteúdos não atravessam o RPC; somente fatos e digests. Essa consolidação substitui os dois RPCs propostos no plano, reduzindo o contrato de acesso e mantendo a análise dos arquivos local ao executor. Cache hit evita inferência, mas ainda verifica os metadados do snapshot.

## Persistência e workflow

Um Durable Object SQLite por instalação/repositório guarda resultados por fingerprint, com leases, fencing monotônico, orçamento durável por run e expiração após 90 dias sem uso. Um registro por instalação mantém a fila de purge. Revogação bloqueia escritas; reautorização troca a geração do cache, sem ressuscitar conteúdo revogado.

Workflows separa descoberta, identificação por projeto e gravação. Espera por outro dono usa `step.sleep`; erros opcionais preservam a review. O ledger registra o snapshot imutável usado pela run, e o admin o consulta pelo RPC `getRunDetailV2`. O V1 público mantém seu formato anterior.

## Consequências e limites

- Modelo usa o Gateway existente, com payload logging desligado. O perfil do host participa da chave; deve mudar quando a rota dinâmica mudar de modelo/prompt/configuração.
- Não tentamos reproduzir resolvers Maven/Gradle/uv nem executar configurações. Declarações conflitantes ou condicionais continuam visíveis com sua origem.
- Inferência sequencial limita concorrência a um projeto por run. Chamadas já aceitas pelo provedor podem consumir tokens mesmo após perda da resposta; não há promessa de exactly-once de cobrança.
- A feature começa desligada; `observe` grava sem alterar a review, `enrich` requer avaliação operacional. Nenhuma documentação técnica externa é recuperada nesta entrega.
- Snapshot de auditoria da run segue o lifecycle do ledger; não é o cache descartável de 90 dias. Ele contém nomes/versões/caminhos e evidências normalizadas, sem manifests integrais.

## Alternativas rejeitadas

Usar somente o modelo permitiria versões sem evidência. Resolver dependências com instalações/builds violaria a fronteira do executor. Cache apenas por commit desperdiçaria inferência; cache apenas pelo manifest ignoraria fontes compartilhadas. KV eventualmente consistente não é o coordenador de leases escolhido.

## Confirmação

Testes locais de parsers, coleta por SHA, cache/fencing/revogação, workflow e admin; corpus sintético offline com 44 casos e split fixo. Avaliação live, custo real e deploy continuam pendentes de autorização operacional e não são comprovados pelos mocks.
