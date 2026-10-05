---
name: dashboard-engineering
description: Planejar, implementar ou revisar o dashboard dos usuários do Holon usando suas decisões, interfaces e gates de segurança, recuperação e testes. Use para essa evolução; não para o admin retirado ou tarefas isoladas do core.
---

# Engenharia do dashboard Holon

Comece em [plano de implementação](../../../docs/planning/dashboard-implementation-plan.md).
Confirme status e código/manifests: o plano registra uma evolução, não prova
que dashboard, auth ou D1 existem. Os ADRs aceitos e o pedido do usuário prevalecem.

## Leia apenas a interface afetada

- Produto/identidade: [Q1–Q37](../../../docs/planning/dashboard-engineering-decision-review.md)
  e [workspaces](../../../docs/engineering/dashboard-identity-and-workspaces.md).
  Não pedir novamente decisões já respondidas.
- Rotas/features/packages/SSR/Query: [organização frontend](../../../docs/engineering/frontend-application-structure.md).
  Verificar quem lê o dataset em cada intenção; proximidade de arquivos não
  permite import de internals entre rotas. Package precisa esconder conhecimento,
  não apenas reexportar SDK.
- Sessão/HTTP/convite/conteúdo: [segurança web](../../../docs/engineering/web-security-and-data-boundaries.md).
  Superfície nativa auth não é automaticamente superfície pública Holon.
- Persistência/efeitos: relatórios de [auth](../../../docs/research/2026-10-04-dashboard-auth-persistence-investigation.md),
  [leitura](../../../docs/research/2026-10-04-dashboard-read-model-investigation.md)
  ou [email](../../../docs/research/2026-10-04-dashboard-email-delivery-investigation.md),
  somente o pertinente. Separar condição suportada, hipótese e prova executada.
- UI: [marca](../../../docs/brand/README.md), tokens e receita relevante de motion.
- Operação: [ambientes/recuperação](../../../docs/operations/dashboard-environments-and-recovery.md).
  Não inferir autorização remota da tarefa de código/documentação.

## Verifique a garantia, não só o caminho feliz

Identifique entrada, autoridade, transição durável, efeito e recuperação. Se
o desenho depende de uma capacidade ainda não comprovada, conclua a prova
adequada ao escopo antes de afirmar prontidão. Não contornar suporte ausente
por patch de biblioteca, bypass de identidade ou guarda em cada caller.

Para estado distribuído, conferir próximo wake-up até terminalidade, guarda
zero rows sem efeito posterior, resultado externo desconhecido e concorrência
de revisão/lease. Lease não cancela efeito remoto; Q37 não se aplica a OAuth.
Para browser, conferir uma leitura por intenção, zero na hidratação, revogação
sem dado privado de fallback e erro antigo sem efeito sobre escopo novo.

Ligue cada garantia alterada à interface observável e à prova da
[política de testes](../../../docs/engineering/testing-and-evidence.md).
Teste permitido/negado, interrupção e corrida relevantes; preserve thresholds
e gate do core. Runtime local, dry-run e smoke real têm resultados distintos.

Conclua com achados corrigidos, arquivos, comandos/resultados e condições que
continuam sem prova. Atualize a fonte dona da regra e seus índices, sem copiar
todo o plano para cada referência ou promover proposta a ADR aceito por silêncio.
