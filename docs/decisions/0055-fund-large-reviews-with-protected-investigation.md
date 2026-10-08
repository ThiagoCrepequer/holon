---
id: ADR-0055
kind: decision
status: accepted
date: 2026-10-08
owners: [core-team]
related:
  - 0039-partition-large-reviews-and-bound-concurrency.md
  - 0049-use-cloudflare-think-for-pr-review.md
  - 0050-verify-finding-causality-before-publication.md
  - 0053-align-review-admission-with-generation-budget.md
---

# Financiar reviews grandes com investigação protegida

## Problema

A admissão de nove partes da ADR-0053 torna PRs grandes parciais por construção.
No relato do PR #177, só nove de 19 partes foram admitidas; quatro dessas nove
falharam com `model_output_missing`. São problemas independentes: orçamento não
corrige ausência da ferramenta final. O PR #178 corrigiu a contradição das
instruções e acrescentou telemetria do protocolo, mas manteve a admissão restrita.

## Decisão

Esta decisão substitui a admissão, distribuição e saída da ADR-0053. Preserva
Think, verificação causal, checkout/revalidação exatos, falhas duráveis e
concorrência três. Não modifica o documento histórico aceito.

| Perfil       | Partes | Inferências | Entrada cumulativa | Saída reservada | Tools de repositório |
| ------------ | ------ | ----------- | ------------------ | --------------- | -------------------- |
| `normal`     | 1–9    | 64          | 4.000.000 bytes    | 120.000 tokens  | 96                   |
| `large`      | 10–24  | 192         | 12.000.000 bytes   | 360.000 tokens  | 288                  |
| `very_large` | 25–64  | 512         | 32.000.000 bytes   | 960.000 tokens  | 768                  |

1. Todas as partes do plano estrutural limitado a 64 são admitidas. A seleção
   também considera o tamanho dos prompts iniciais: soma dos bytes UTF-8 vezes
   sete inferências vezes dois para histórico crescente. Uma estimativa acima
   do teto de entrada promove o perfil; acima de 32 MB conserva o maior teto,
   sem promessa de que o histórico real caberá. O ledger cobra cada request
   efetivo, incluindo schemas, histórico e máximo de saída, antes do provider.
2. O planejamento congela perfil, estimativa e pesos no ledger. Repetir o mesmo
   plano é idempotente; mudar perfil/pesos/quantidade na mesma run falha. A
   migração aditiva 23 mantém toda dívida anterior. Um plano anterior sem esse
   snapshot exige uma nova run; não recebe reset nem um contrato paralelo.
   Chamadas diretas ao ledger podem selar um plano uniforme por quantidade,
   seguindo o mesmo schema e invariantes; o coordenador sela o plano completo
   antes de inferências ou tools.
3. Cada parte protege quatro chamadas de investigação, três tools e uma parcela
   igual de 70% dos bytes/tokens globais. O saldo recebe pesos de um a quatro:
   base um, mais um por pistas de contrato, superfície de segurança e paths
   de auth/tenancy/ledger/migração/workflow/orçamento/contratos/persistência/
   publicação. São prioridades heurísticas, não findings nem garantias de risco.
   Arredondamentos conservadores podem deixar saldo sem alocação.
4. A verificação causal continua apenas para candidatos válidos; recuperação
   narrativa apenas para summary vazio. Cada parte tem um teto com sua proteção
   mais a parcela ponderada do saldo. Sobra de uma parte concluída pode ser
   emprestada, sob o teto global e a proteção dos pares ainda abertos. O marcador
   de conclusão é gravado depois do checkpoint persistido do resultado, é
   idempotente e bloqueia novas reservas daquela parte. Settlement libera apenas
   saída comprovada; chamadas, entrada e uso incerto permanecem cobrados.
5. Requests de investigação com tools usam até 1.000 tokens; a finalização
   forçada do Think dispõe de 5.000. Na conversa causal, são 1.000 e 2.500.
   Recuperação mantém 1.024. Finalização antecipada não forçada dispõe do limite
   menor. Não sobrescrevemos `toolChoice` do Think. Esses tetos são parâmetros
   iniciais; saída longa ainda pode ficar incompleta e nunca vira aprovação limpa.
6. Arquivos e testes espelhados continuam juntos quando couberem. Pistas de referências
   produzidas pelo analisador estrutural unem produtores e consumidores
   alterados, inclusive com nomes e projetos diferentes. Componentes grandes
   respeitam os limites existentes de patch/linhas/arquivos/janelas.
7. Relações entre símbolos alterados e consumidores alterados que a partição
   separou recebem até oito partes adicionais de contrato, dentro do total 64.
   Cada parte recebe duas janelas canônicas de até 80 linhas, selecionadas pelas
   coordenadas do símbolo/chamada. Não fabrica fonte ou coordenadas. Relações
   sem janela correspondente ou sem capacidade geram `contract_checks` e
   parcialidade explícita. A análise cobre apenas referências disponíveis no
   inventário limitado; não prova cobertura de todas as dependências.
8. Resultados de contrato passam pelos mesmos gates de evidência, causalidade e
   agregação. Falha de qualquer parte necessária a um arquivo impede declarar
   esse arquivo integralmente observado na reconciliação. A saída distingue
   cobertura completa, omissão de política e falha; zero achados não aprova
   relações ou trechos pendentes.

## Consequências e evidência

Os tetos maiores aumentam exposição máxima por PR. São limites de recursos,
não valores de faturamento nem gasto esperado: fases opcionais e settlement
reduzem o consumo. O deadline cresce por ondas, sem ampliar concorrência ou
capacidades do Sandbox. Quotas, retries e eviction continuam transacionais.

Testes locais exercitam 19, 24, 50 e 64 partes, ciclo incerto completo,
isolamento, persistência, pesos, empréstimo de sobra e janelas canônicas. Eles
não qualificam o modelo real. O [runbook de avaliação](../operations/evaluations.md)
define a comparação com PRs grandes, controles negativos, achados conhecidos,
custo e tempo antes de concluir sobre qualidade. Sem smoke autorizado, não há
prova de que `model_output_missing` desapareceu na rota real. Nenhum recurso,
secret ou modelo remoto é alterado por esta decisão.
