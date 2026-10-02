---
id: ADR-0048
kind: decision
status: accepted
date: 2026-10-02
owners: [core-team]
related:
  - 0047-guard-coordinated-deployments.md
---

# Restaurar deploy automático dos Workers

## Contexto

Os dois Workers Builds existentes executam os scripts `deploy` dos apps sem
terminal interativo. O bloqueio introduzido pela ADR-0047 interrompeu esse fluxo
antes de chamar Wrangler. O responsável decidiu restaurar o build/deploy anterior
e adiar a proteção de deploys durante análises concorrentes.

## Decisão

Substituir a obrigatoriedade e o bloqueio de atalhos da ADR-0047. Restaurar
`wrangler deploy` em ambos os apps e `wrangler deploy --config wrangler.bootstrap.jsonc`
no bootstrap do executor. Preservar a guarda como ferramenta manual opcional
`pnpm run deploy:guarded`, sem integração com Workers Builds. Não criar gate de
runtime, workflow de deploy, credenciais ou migração de configuração nesta entrega.

O código e os testes da guarda são mantidos para não perder o trabalho recuperável;
somente o bloqueador sem uso é retirado. Os testes de compatibilidade executam os
comandos pnpm existentes em workspace isolado com Wrangler simulado e sem TTY,
incluindo propagação de falhas. Nenhum deploy real é necessário para esses testes.

## Consequências

O merge pode voltar a acionar os deploys automáticos já configurados. Não há
exclusão distribuída, drenagem automática ou garantia de atualização conjunta dos
Workers. Uma análise ativa pode ser interrompida por atualização; essa limitação
foi conscientemente adiada. A guarda manual só se aplica quando escolhida pelo
operador, em janela exclusiva. A documentação de operação distingue os dois caminhos.

A restauração de scripts não comprova implantação remota; o resultado dos próximos
Workers Builds deve ser observado após um merge autorizado.
