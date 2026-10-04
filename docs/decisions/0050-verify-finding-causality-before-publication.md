---
id: ADR-0050
kind: decision
status: accepted
date: 2026-10-04
owners: [core-team]
supersedes: []
related:
  - 0049-use-cloudflare-think-for-pr-review.md
  - 0019-derive-deterministic-review-verdict-by-policy.md
---

# Verificar a causalidade dos candidatos antes da publicação

## Contexto e problema

A evidência canônica comprova que um trecho existe no diff, mas não comprova
o impacto alegado. Um retorno `null`, por exemplo, pode ser seguro quando seu
chamador possui uma guarda. O usuário autorizou adicionar verificação causal
antes de publicar os findings, após o inventário de ferramentas de análise de
PR. Esta decisão complementa a ADR-0049 sem substituir o harness Think.

## Direcionadores

- Tentar refutar o candidato lendo guardas, chamadores e contratos pertinentes.
- Liberar somente problemas confirmados, sem elevar sua confiança original.
- Não converter ausência de contexto, falha ou orçamento esgotado em aprovação.
- Compartilhar autoridade, snapshot head/base, deadline e orçamento da run.
- Preservar tools de leitura, schemas estritos e publicação exclusiva pelo host.

## Opções consideradas

### Acrescentar instruções à investigação inicial

- Prós: sem turno extra nem repetição de contexto.
- Contras: não cria um gate obrigatório nem separa a verificação da conversa que
  produziu o diagnóstico.

### Verificar na mesma conversa Think

- Prós: reutiliza leituras e histórico.
- Contras: mantém a argumentação inicial no contexto e mistura responsabilidades
  e schemas na mesma identidade durável.

### Usar uma conversa Think isolada e aplicar o resultado no host

- Prós: papel explícito de refutação, resultado restrito a candidatos existentes
  e decisão determinística de publicação.
- Contras: repete contexto, acrescenta latência e consome o saldo disponível.
  Isolamento de conversa não garante independência estatística do mesmo modelo.

## Decisão

O adapter investiga o shard, valida a resposta e rejeita candidatos sem
evidência no diff canônico. Havendo candidatos válidos, inicia outro
`ReviewAgent` no mesmo binding, com identidade por run/shard/fase e conversa
isolada. A fase `causal_verification` usa `ReviewShardWorkflow.step.prompt`,
as mesmas três tools de leitura e o mesmo snapshot. Não há execução de testes,
comandos ou escrita no repositório.

O verificador deve buscar ativamente contraprovas e retornar uma avaliação
por posição do candidato: `confirmed`, `refuted` ou `inconclusive`, com
confiança e justificativa. Para confirmar, deve explicar um caminho alcançável
da mudança ao impacto e por que as proteções existentes não o impedem. Para
refutar, deve citar uma contraprova positiva. Busca limitada sem resultados não
comprova ausência; premissas sobre código fora do patch exigem sua inspeção.

O schema não permite produzir findings novos ou alterar diagnóstico,
localização, severidade e evidências. O host exige cobertura exaustiva e índices
únicos: avaliação ausente, repetida, desconhecida ou inválida retém todos os
candidatos. Só `confirmed` com confiança de pelo menos 0,8 permanece; a
confiança final é o menor valor entre investigação e verificação. `refuted`
com confiança suficiente é descartado. `inconclusive` ou confiança insuficiente
bloqueia a publicação do candidato e marca a saída como parcial. O resumo é refeito a partir da
verificação; o resumo inicial não deve ressuscitar uma acusação refutada.

Falha, timeout, schema inválido ou falta de saldo na verificação retém todos
os candidatos e acrescenta `causal_verification_incomplete`. Cancelamento do
pai continua cancelamento, sem retornar resultado parcial publicável. A
política de veredito existente impede `APPROVE` quando a revisão é degradada.
Limitações anteriores permanecem, inclusive quando todos os candidatos são
refutados. Sem candidatos, não há inferência extra.

Investigação e verificação compartilham o teto de 64 inferências, 4.000.000
bytes de entrada, 120.000 tokens de saída e 96 consultas por run. Não recebem
saldo nem deadline novos. A verificação admite até oito passos e seu
`step.prompt` tem timeout de cinco minutos, subordinado ao deadline fixo da
análise. A fase integra a identidade determinística do Workflow, pedidos de
reserva, diagnósticos de rejeição de orçamento e metadata do provider.
Revalidação de head/base, publicação idempotente e cleanup
durável permanecem no fluxo existente. Resoluções de findings anteriores
continuam sob seu gate próprio; esta melhoria trata candidatos novos.

## Consequências

### Positivas

- Candidatos refutados ou não confirmados não chegam à publicação inline.
- O host controla identidade, confiança e parcialidade, sem delegá-las ao modelo.
- A implementação reutiliza o harness, executor e ledger existentes.

### Negativas

- Mais chamadas, contexto repetido e latência quando há candidatos.
- Verificação pode esgotar o orçamento compartilhado e tornar shards parciais.
- Confiança declarada e justificativas continuam sendo inferências do modelo;
  o protocolo não constitui prova formal nem demonstra melhora de precisão.

## Critérios de confirmação

- Testes puros cobrem confirmação, refutação, incerteza, índices inválidos,
  confiança, schemas e ausência de aprovação quando a verificação é parcial.
- Testes Workerd com provider simulado exercitam as duas conversas, leitura
  de chamador, saída estruturada e reservas no mesmo ledger.
- Cancelamento, deadline e limites não concedem nova autoridade ou saldo.
- Smoke e avaliação com provider real continuam necessários para medir
  precisão, recall, custo e latência antes de afirmar ganho de qualidade.

## Gatilhos para revisitar

- Falsos positivos confirmados ou regressões reais refutadas em corpus real.
- Latência, saldo indisponível ou queda de recall inviabilizam o fluxo.
- Necessidade comprovada de outro modelo ou estratégia de recuperação.

Fonte oficial verificada em 2026-10-04:
[Think Workflows](https://developers.cloudflare.com/agents/harnesses/think/workflows/).
O comportamento local é validado com as versões fixadas de Think e Agents SDK
nos manifests/lockfile, sem inferir compatibilidade com o provider remoto.
