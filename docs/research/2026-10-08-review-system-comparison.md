---
id: RESEARCH-REVIEW-SYSTEM-COMPARISON-2026-10-08
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-08
---

# Referências externas para melhorar o processo de revisão

As oportunidades mais plausíveis para o Holon são seleção de contexto por relação
causal, reuso de recuperação determinística, verificação com proveniência e
avaliação separada de candidato/filtro/publicação. Aumentar agentes ou contexto
indiscriminadamente não tem vantagem demonstrada.

Esta pesquisa compara mecanismos observáveis em fontes primárias consultadas em
**2026-10-08**. Não houve benchmark dos serviços nem acesso ao código privado dos
fornecedores. Afirmações comerciais são descrições do fornecedor; não são medidas
independentes de precisão, recall, custo ou latência. Transferências para o Holon
são inferências e propostas, ligadas à
[auditoria local](2026-10-08-review-core-audit.md) e ao
[plano de experimentos](../planning/review-core-improvement-proposal.md).

## PR-Agent: preparação de diff limitada por orçamento

O código público de `pr_processing.py` usa `AttemptTokenBudget`, reservas de
output, limites soft/hard, expansão de contexto e compressão quando o diff excede
o orçamento. `PreparedPRDiff` permite reuso no mesmo request/modelo e conserva
informação sobre arquivos restantes. O empacotamento verifica o tamanho renderizado
dos grupos; patches grandes podem ser omitidos ou cortados conforme política.
São mecanismos inspecionáveis, sem demonstrar a qualidade dos comentários.
Fonte: [implementação pública atual](https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/algo/pr_processing.py).

**Leitura crítica para o Holon:** o benefício transferível é tornar admissão,
reserva e omissão explícitas. O Holon já tem orçamento durável mais forte para
concorrência; copiar apenas compressão seria regressão se apagar hunks/evidência.
Reuso da preparação por snapshot pode economizar CPU, mas deve manter a mesma
representação canônica validada pelo host. Contagem específica do modelo pode
ajudar planejamento, sem substituir o limite de bytes ou o settlement atual.

**Experimento:** comparar projeção atual com projeção que reserva schema,
histórico, verificação e output, preservando coordenadas. Medir rejeição por budget,
completude e recall por categoria. Rejeitar a variante se o ganho decorrer de
omitir silenciosamente contratos ou consumidores relevantes.

O URL consultado em `qodo-ai/pr-agent` redirecionou para `The-PR-Agent/pr-agent`.
A antiga página de estratégia de compressão de Qodo Merge redirecionou para uma
página geral de Code Review. Por isso, este documento atribui o mecanismo ao
código público examinado e não afirma que seja a arquitetura do produto comercial
Qodo atual. Branch `main` é mutável; registrar revisão imutável ao reaplicar a análise.

## CodeRabbit: contexto selecionado e revisão incremental

A documentação oferece revisão incremental das mudanças novas e comando distinto
para revisão completa. Isso comprova a interface exposta, não seu algoritmo de
invalidação. Fonte: [comandos de review](https://docs.coderabbit.ai/reference/review-commands).

A arquitetura declarada combina snapshot em Sandbox, análise estática, exploração
agentiva, agentes especializados e memória. Fonte:
[descrição de arquitetura](https://docs.coderabbit.ai/overview/architecture).
Um artigo técnico do fornecedor descreve agrupamento de blocos por relações,
seleção/dedupe/compressão de contexto e verificação posterior. Seu código e os
limites de cobertura não estão publicados nessa fonte.
Fonte: [context engine e agrupamento de mudanças](https://www.coderabbit.ai/blog/coderabbit-review-reads-a-pr-how-author-would-explain-it).

**Leitura crítica para o Holon:** um grafo útil precisa conter relações comprovadas;
o nome “semantic graph” não garante entendimento. O Holon já possui inventário
estrutural, exports e referências. Priorizar produtor → contrato → consumidor →
teste sobre proximidade de diretório pode reduzir descobertas repetidas, mas há
imports dinâmicos, resolução incompleta e linguagens textuais. Relação ausente no
índice não pode provar ausência de consumidor. Linters/SAST extras ampliariam
execução e superfície do executor; não são necessários para o primeiro experimento.

Revisão incremental pode poupar trabalho em pushes, mas o efeito de mudar um
contrato atravessa arquivos intactos. Reusar resultado somente pelo hash do arquivo
é insuficiente. Memória de feedback também pode perpetuar F08 se resolução de
thread virar falso positivo sem adjudicação.

**Experimentos:** agrupar relações já disponíveis sem novo serviço; recuperar
trechos de consumidores sob limite; comparar famílias de mudanças entre commits,
com invalidação conservadora. Medir chamadas evitadas e defeitos fora dos arquivos
alterados. Rejeitar agrupamentos que reduzam cobertura sem explicação.

## GitHub Copilot: recuperação de projeto como etapa explícita

A documentação descreve coleta agentiva de contexto do projeto em runners GitHub
Actions. Quando essa capacidade não está disponível ou falha, a revisão pode
continuar com capacidades limitadas. Isso evidencia que disponibilidade de
recuperação e geração de comentário são estados distintos; a fonte não expõe o
algoritmo interno nem fornece comparação controlada com o Holon.
Fonte: [capacidades agentivas do Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review).

**Leitura crítica para o Holon:** tornar disponibilidade e cobertura de contexto
observáveis é mais útil que a promessa de “full project context”. O Holon deve
manter seu veredito conservador para execução incompleta; produzir algum output
não equivale a autorizar `APPROVE`. Seu Sandbox sem shell arbitrário/dependências
é uma fronteira deliberada, e não precisa virar um runner irrestrito.

**Experimento:** preparar, antes da inferência, um mapa pequeno dos contratos,
exports e consumidores mais relacionados ao shard. Conservar fallback textual
declarado. Medir recall e tool rounds necessários, contabilizando custo de
preparação; não contabilizar só chamadas feitas pelo modelo.

## Anthropic: investigação paralela e validação separada

O anúncio de Code Review descreve agentes em paralelo, verificação dos bugs,
ranking por severidade e esforço ajustado ao PR. Reporta duração média de cerca de
20 minutos e menos de 1% de findings marcados incorretos em uso interno. São dados
do fornecedor: marcação voluntária não mede falsos positivos totais nem defeitos
omitidos. A fonte não permite reproduzir esses resultados.
Fonte: [anúncio técnico do serviço](https://claude.com/resources/articles/code-review).

**Leitura crítica para o Holon:** separar geração de refutação já é decisão vigente
na ADR-0050. Mais agentes podem aumentar diversidade e também custo, overlap e
erros correlacionados. Não há motivo para replicar uma equipe por shard sem
evidência. O caso útil é esforço adicional dirigido a uma obrigação causal difícil,
dentro dos budgets e com teste por categoria.

Existe também um plugin público `code-review`, distinto do serviço comercial.
Seu comando instrui quatro revisores paralelos, depois validação por candidato;
restringe alguns revisores ao diff e exclui bugs dependentes de inputs/estado.
Também pressupõe tools funcionais. Essas são escolhas do prompt público, não prova
da implementação privada. Fonte:
[comando do plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md).

**Leitura crítica:** excluir todo defeito dependente de estado eliminaria justamente
retries, concorrência e autorização, centrais ao Holon. Pressupor tool funcional
contradiz o modelo de falhas do projeto. O filtro útil é exigir condição concreta
e prova causal, sem recusar uma categoria inteira de defeitos. Essas instruções
externas foram analisadas como material, não executadas nesta investigação.

**Experimento:** comparar verificação atual com verificação que recebe provas
canônicas compactas e busca um contraexemplo explícito. Avaliar diversidade de
modelo/especialização somente se houver regressões correlacionadas demonstradas
e benefício acima do custo de inferência adicional.

## Context engineering: recuperação híbrida

A orientação técnica da Anthropic descreve recuperação sob demanda com referências
leves, contexto revelado progressivamente e combinação de preparação antecipada
com exploração. Reconhece o trade-off: exploração em runtime pode ser mais lenta
que recuperação pré-computada. Fonte:
[effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

**Inferência para o Holon:** o meio-termo promissor é preparar fatos baratos e
determinísticos, deixando a tool para premissas ainda abertas. Um pacote inicial
de exports, schemas e consumidores prováveis pode evitar busca → leitura em dois
turnos. Enviar o repositório inteiro aumenta atenção, bytes e superfície de
instruções hostis. Resumo gerado por modelo não substitui evidência literal;
um excerpt de origem verificável deve continuar recuperável.

O host pode coalescer reads idênticos entre investigação e verificação. É preciso
medir separadamente tool calls lógicas, execuções físicas, bytes retornados,
cache hits e chamadas de geração. Diminuir um contador enquanto aumenta todos
os outros não caracteriza eficiência.

## Comparação de mecanismos e condições de transferência

As linhas abaixo sintetizam a leitura crítica das fontes anteriores; são
hipóteses para o Holon, não capacidades comprovadas dos fornecedores além do
que cada fonte declara.

| Mecanismo de referência              | O Holon já possui                                | Oportunidade                                         | Risco que deve bloquear adoção                                       |
| ------------------------------------ | ------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Preparação por budget e compressão   | Caps de contexto, quotas duráveis, shard planner | Reservar etapas futuras e reportar toda omissão      | Evidência/coordenadas perdidas; cobertura apresentada como completa. |
| Seleção por relações                 | Inventário JS/TS, exports, referências e sinais  | Shards e contexto orientados a contratos             | Grafo parcial tratado como prova de ausência.                        |
| Contexto de projeto antes da geração | Identificação/config/inventário                  | Prefetch determinístico de alto valor                | Preparação custar mais que o benefício ou violar escopo.             |
| Verificação separada                 | Conversa causal isolada                          | Proveniência das leituras e refutação direcionada    | Verificador só repetir a justificativa inicial.                      |
| Paralelismo/esforço adaptativo       | Waves de três, admission e quotas                | Reduzir espera e destinar esforço à dificuldade real | Quebrar replay/cleanup ou deixar pares sem orçamento.                |
| Revisão incremental                  | Findings/memória entre runs                      | Reusar provas sob invalidação conservadora           | Defeito novo em consumidor intacto passar despercebido.              |
| Memória/feedback                     | Lifecycle e memória com autoridade               | Cases adjudicados e contexto aprovado relevante      | Rótulo humano virar ground truth automático.                         |

## O que manter e o que investigar primeiro

O Holon já tem vantagens verificáveis de organização: host determina publicação,
snapshot exato, budgets transacionais, permissões restritas, contratos runtime,
verificação causal isolada e cleanup durável. Nenhuma referência externa justifica
relaxar essas fronteiras.

A primeira prioridade é corrigir integridade/completude e o instrumento de
avaliação. Em seguida, testar reuso determinístico e contexto relevante compacto.
Grafo de mudança, scheduling adaptativo, diversidade de revisores e reuso entre
commits vêm depois, por aumento de complexidade e requisitos de decisão.
O [plano](../planning/review-core-improvement-proposal.md) define ordem, métricas,
regressões e critérios de rejeição para cada alternativa.
