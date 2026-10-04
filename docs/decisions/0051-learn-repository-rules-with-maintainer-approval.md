---
id: ADR-0051
kind: decision
status: accepted
date: 2026-10-04
owners: [core-team]
related:
  - 0021-capture-human-feedback-and-calibration-signals.md
  - 0037-compile-repository-configuration-per-run.md
  - 0040-retire-admin-and-analytical-storage.md
  - ../architecture/repository-memory.md
---

# Aprender regras do repositório com aprovação de mantenedor

## Contexto e decisão

O responsável aprovou implementar memória incremental de achados, descobertas e
feedbacks, com origem, escopo, aprovação humana e revalidação. A capacidade amplia
o MVP com memória funcional por repositório. Não modifica a autoridade da
configuração no base SHA nem as políticas obrigatórias do host.

Adicionar `RepositoryMemoryObject` SQLite ao control plane. O índice de
instalação existente governa também a geração dessa memória: instalação,
repository ID e geração identificam o destino. Remoção/suspensão revoga o acesso
e purga cache e memória; restauração cria outra geração. Eventos atrasados não
podem repovoar a nova geração.

O ledger do PR registra uma outbox na mesma transação que salva análise ou
feedback. Seu alarm entrega observações por RPC com idempotência e backoff.
Observações do modelo nunca aprovam regras. Feedback justificado equivalente em
três PRs distintos pode gerar uma proposta para o arquivo, sem ativá-la. Não há
agrupamento semântico nem extrapolação automática para outros diretórios.

Mantenedores com permissão atual `write`, `maintain` ou `admin` podem propor,
inspecionar, aprovar, rejeitar, revogar e substituir regras por ChatOps em uma
thread inline pertencente ao Holon. A associação do webhook sozinha não autoriza
uma regra. Aprovação identifica o conteúdo imutável pelo ID e digest, incluindo
escopo, evidências, substituição e expiração. Substituição aprovada terminaliza a
regra anterior atomicamente. Dispensa e resolução de thread continuam locais ao
finding e não são aprovação permanente.

Cada run sela um snapshot privado antes da análise. Shards recebem projeções
por path e retries usam o conteúdo selado. Somente o número da revisão cruza o
checkpoint de resolução do Workflow. Observações históricas são pistas com SHA
original; sempre exigem verificação no código atual. Regras aprovadas orientam
investigação; não mudam cobertura, severidade, veredito, tools ou evidência e não
suprimem automaticamente achados. Base configuration e host prevalecem.

## Dados e limites

Observações guardam conclusões limitadas, path/linha quando conhecidos, SHA,
identidade da run e origem humana quando aplicável. Não guardam excerpts,
prompts nem raciocínio privado. Redação heurística é defesa complementar.
A análise temporária já existente pode conter a evidência original e continua
sob seu cleanup normal.

- Observações: 90 dias, até 10.000 por geração de repositório.
- Regras/propostas: validade de 180 dias por padrão; até 64 registros. Evidência
  mínima incorporada à regra acompanha seu ciclo de vida. Registro e recibos de
  decisão expiram 30 dias após a validade da regra.
- Snapshots privados: 30 dias; até 64.000 bytes por run e 16.000 por shard.
- Até 16 observações recentes pertinentes aos arquivos alterados entram no
  snapshot. Essa seleção auxiliar não representa cobertura histórica completa.
- Regras aprovadas que não cabem no orçamento provocam falha explícita; não são
  truncadas para prosseguir com uma política incompleta.

A migration 20 é aditiva. Fontes de identidade da run permanecem junto ao ledger
funcional para feedback posterior à expiração do snapshot. Snapshot expirado
não pode ser recriado com regras novas sob a mesma run. O prazo geral do ledger
continua sujeito à política operacional pendente; não se promete deleção de
histórico GitHub, backups ou cópias retidas pela plataforma Workflows.

## Alternativas e consequências

Guardar somente conversas do Agent acoplaria política à saída do modelo e não
ofereceria aprovação independente. RAG vetorial e compartilhamento entre
repositórios acrescentariam infraestrutura e risco antes de provar utilidade.
Guardar toda memória somente por PR impediria aprendizado entre PRs. Essas
alternativas foram rejeitadas para esta entrega.

A capacidade exige um binding/migration novo, aumenta storage e contexto, e
limita os registros por geração. A recorrência textual conservadora perde
paráfrases e não substitui revisão humana. O fluxo depende de uma thread Holon
existente; não adiciona admin, escrita de Contents ou abertura automática de PR.

## Confirmação e revisão futura

Provar persistência após eviction, isolamento, redelivery, aprovação exata,
substituição/revogação, snapshot selado, outbox transacional, expiração e
purga por revogação. Avaliação local não comprova integração GitHub/Cloudflare
real nem redução de falsos positivos com modelo live.

Revisitar índices/limites após medir volume; ampliar classificação semântica,
consulta de fontes não alteradas ou memória organizacional somente com casos de
avaliação, governança e autorização próprias.
