---
id: OPS-REPOSITORY-MEMORY
kind: reference
status: current
owners: [core-team]
last-reviewed: 2026-10-04
---

# Operar propostas e regras de memória

Responder a uma thread inline criada pelo Holon. Comandos são aceitos somente
em comentários novos; editar ou apagar um comentário não modifica uma regra
aprovada. Use revogação ou nova proposta para corrigir uma decisão.
A permissão atual precisa ser `write`, `maintain` ou `admin` no repositório.
Bots não executam comandos de memória. O fluxo usa as permissões já existentes;
não requer escrita em Contents nem novo console.

```text
/holon memory list
/holon memory propose src/auth | Verifique o middleware antes de alegar ausência de autorização no handler.
/holon memory inspect <id> <digest>
/holon memory approve <id> <digest>
/holon memory reject <id> <digest>
/holon memory revoke <id> <digest>
/holon memory propose src/auth replaces:<id-anterior> | Verifique o novo gateway e seus chamadores antes de alegar autorização ausente.
```

Root é `.` ou path relativo normalizado, sem glob ou traversal, e precisa conter
o arquivo do achado que originou a proposta. ID e digest são hashes completos
de 64 caracteres fornecidos na resposta/listagem. `inspect` apresenta texto,
evidências, origem, expiração e decisão; revise isso antes de aprovar.
Aprovação de substituição terminaliza a regra anterior na mesma transação.

Dispensar achado com `/holon dismiss` continua alterando somente seu lifecycle;
não aprova regra. Justificativas recorrentes em três PRs podem aparecer em
`list` como propostas. A geração automática não publica uma notificação extra;
a descoberta e inspeção são feitas pelos comandos acima.

Regras orientam a investigação e não são ignoradores automáticos de achados.
A validade padrão é 180 dias; renovar requer nova proposta e aprovação.
Revogação afeta próximas runs. Não existe sincronização automática com YAML.

## Implantação

O código acrescenta o namespace SQLite `REPOSITORY_MEMORIES` e migration
`repository-memory` no Wrangler; migration 20 do ledger preserva dados antigos.
Antes de deploy autorizado, drenar runs em andamento: a nova etapa exige
snapshot que workflows antigos ainda não selaram. Confirmar bindings e tipos,
executar o gate local e depois fazer smoke com uma thread Holon real.
Não executar reset do ledger. Esta implementação não realiza deploy.

## Retenção e investigação operacional

Prazos e limites estão na [ADR-0051](../decisions/0051-learn-repository-rules-with-maintainer-approval.md).
Saturação não autoriza reduzir evidência ou esquecer regras ativas. Revisar o
volume antes de alterar os limites. Outbox pendente deve ser investigada no
ledger funcional; logs não contêm justificativas nem conteúdo da memória.
Remoção/suspensão da instalação bloqueia acesso e agenda purga da memória da
geração. Restauração não recupera regras antigas; o repositório começa outra
geração. Backups/plataforma e comentários GitHub têm ciclos de vida separados.
