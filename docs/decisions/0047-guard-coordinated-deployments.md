---
id: ADR-0047
kind: decision
status: superseded
superseded-by: 0048-restore-automatic-worker-deployments.md
date: 2026-10-02
owners: [core-team]
related:
  - 0043-bound-investigation-and-sandbox-lifecycle.md
  - 0046-protect-shard-completion-and-local-replay.md
---

# Proteger o caminho normal de deploy com evidência vinculada

## Contexto

Os logs fornecidos do PR #107 mostram reset do Durable Object por atualização de
código e troca de versões dos Workers enquanto a revisão estava ativa. O runbook
já exigia pausa, drenagem e rollout coordenado, mas os scripts dos apps executavam
Wrangler diretamente. Essa falha operacional é distinta da incompletude de revisão
por orçamento e não justifica mudar modelos ou tetos.

## Decisão

Adotar uma entrada coordenada `pnpm run deploy` e bloquear atalhos de deploy independente,
inclusive bootstrap. O primeiro provisionamento continua como operação excepcional
sem tráfego. A guarda local em `tooling/deploy` usa Node 24 e módulos ESM sem pacote
novo ou dependências de runtime, com testes isolados na verificação raiz.

A sequência valida checkout, toolchain e gate local; confirma destino; pausa e
verifica a fila; enumera todas as páginas de Workflows; exige evidência de drenagem;
revalida; publica os dois Workers no mesmo SHA; verifica versões ativas, aplicação e
instâncias de Containers; exige evidência específica de rollout; revalida antes de
retomar. Erros bloqueiam o avanço e tentam restabelecer pausa, sem afirmar sucesso
quando a leitura de confirmação também falha.

A API pública não prova ausência de batches em trânsito, obrigações de cleanup dos
ledgers nem conclusão autoritativa de rollout. Não usar contagem aproximada, espera
fixa ou lista vazia como prova. Confirmações interativas identificam sessão, conta,
SHA, snapshot e, na retomada, versões/imagem. Referenciam evidência operacional e
não são aceitas por um `--yes` não interativo. Nenhuma aprovação fica valendo para
outro deploy. Tokens não entram no registro local.

## Limites e consequências

O operador precisa manter uma janela exclusiva contra outros deploys/admissões
manuais. O lock local não protege a conta e leituras paginadas não são transações.
Esta é uma barreira operacional, não controle de acesso ou quiescência distribuída.
Wrangler/API/painel ainda podem ser usados fora dela de forma deliberada. A ausência
de evidência manual bloqueia o deploy; uma automação integral exigiria coordenação
de runtime e uma nova decisão, fora deste patch.

Leitura da versão usa a API beta documentada para obter a tag; alterações de schema
ou permissões falham fechadas. Health de Containers é opcional/amostrado. A guarda
não executa smoke pago, reenvia review, implanta migração nesta entrega nem altera
orçamentos. Testes simulados demonstram a ordem/invariantes e não sucesso remoto.

Fontes e procedimento: [deploy protegido](../operations/guarded-deployment.md).
