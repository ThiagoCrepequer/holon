---
id: ADR-0052
kind: decision
status: accepted
date: 2026-10-04
owners:
  - core-team
related:
  - 0021-capture-human-feedback-and-calibration-signals.md
  - 0024-persist-canonical-review-decision-for-feedback.md
  - 0049-use-cloudflare-think-for-pr-review.md
  - 0050-verify-finding-causality-before-publication.md
---

# Responder perguntas sobre findings na discussão do PR

## Problema

Um diagnóstico publicado pode precisar de um cenário concreto, esclarecimento
sobre um caminho de execução ou contestação baseada em uma validação. Os comandos
de feedback não investigam código, e a verificação causal anterior à publicação
não conhece as perguntas posteriores do autor.

## Decisão

1. Uma resposta ao comentário inline de um finding pode iniciar uma investigação
   por `@holon <pergunta>`, `@<app-slug>[bot] <pergunta>` ou `/holon ask <pergunta>`.
   `/holon explain <pergunta>` também é aceito. A menção/comando deve iniciar o
   texto; citações, blocos de código, comentários comuns e bots não iniciam IA.
2. O control plane reutiliza o webhook HMAC e a Queue existentes. Antes da
   admissão consulta o comentário, seu comentário raiz e o PR autenticados.
   Confere autoria do bot, IDs, repositório/PR, conteúdo atual da pergunta,
   PR aberto e autorização atual: autor do PR ou permissão `write/maintain/admin`.
3. O ledger do PR admite apenas findings canônicos da última review concluída no
   mesmo head/base. A identidade é o ID do comentário da pergunta; redelivery
   não renova orçamento nem cria outra investigação. Não há admissão de review
   nova, supersession de run, novo Check Run ou reabertura de Sandbox.
4. `FindingClarificationAgent` e `FindingClarificationWorkflow` usam Think
   0.20.0 e Agents 0.26.0, com um DO isolado por pergunta e Workflow de identidade
   determinística. Os bindings próprios são necessários porque perguntas chegam
   depois de a autoridade e o Sandbox da review original serem encerrados.
   Até duas trocas publicadas da mesma discussão e head/base dão contexto à
   pergunta seguinte; suas afirmações não substituem nova leitura de evidência.
5. A investigação usa somente `read_file`, no SHA fixado, por Git commits,
   trees e blobs autenticados. Reutiliza o leitor de snapshot que rejeita
   symlinks, submodules, LFS, binários e respostas incompletas. Recompila a
   configuração no base SHA e exige digests iguais aos da run; aplica exclusões
   e a política de caminhos vigente. Não expõe busca global, URLs arbitrárias,
   shell, escrita, instalação ou credenciais ao modelo.
6. Limites: pergunta de 4.000 caracteres; uma investigação ativa por PR/head;
   até 20 perguntas por head e cinco por finding/head; oito leituras, 200 linhas
   por leitura, arquivo e evidência acumulada de até 64 KiB; oito gerações,
   300.000 bytes de entrada e 16.000 tokens de saída reservados. Cada leitura
   pode emitir no máximo 32 requests Git, com trees de até 256 KiB e timeout
   limitado ao prazo restante. O prompt Think tem quatro minutos dentro de
   prazo fixo de cinco minutos. Falhas incertas mantêm reservas integrais.
   Uma pergunta concorrente recebe aviso inconclusivo sem usar modelo. Depois
   das quotas acumuladas, perguntas adicionais não iniciam investigação.
7. A saída distingue `confirmed`, `narrowed`, `refuted` e `inconclusive`.
   O host valida schema, caminhos, linhas e trechos contra leituras efetivas.
   Conclusões sem evidência ou confiança inferior a 0,8 são inconclusivas;
   refutação exige pelo menos 0,9. Leitura limitada não prova ausência de guard.
8. Refutação validada retira o finding (`dismissed`) em transação com a resposta
   auditável. Não fabrica feedback humano. Preserva comentário, diagnóstico,
   severidade, identidade e discussão originais. Delimitação de cenário fica
   registrada na resposta; não altera automaticamente severidade. O Check Run
   existente é recalculado com a decisão e cobertura canônicas, sem fabricar
   aprovação de review parcial/degradada nem publicar uma nova review APPROVE.
9. O host revalida pergunta, PR, head/base e autoridade antes da correção e da
   publicação. Novo commit, dispensa humana ou diagnóstico alterado tornam a
   pergunta obsoleta. A resposta vai ao comentário raiz e inclui links de
   evidência no SHA e marcador determinístico para reconciliar POST ambíguo.
10. As leituras privadas são removidas ao registrar resposta, obsolescência ou
    expiração por alarm do ledger. Agent não registra mensagens/tools como trace;
    question text, resposta mínima e metadados permanecem no ledger funcional
    para reconciliação. Não entram em logs. Retenção geral do ledger continua
    sujeita à política anterior, pendente antes do piloto privado.
    O Agent remove seu estado temporário um dia após encerrar a publicação.
    Se os retries do Workflow falharem, timers duráveis retomam a publicação
    por até um dia após o prazo da investigação; depois ela fica obsoleta.

## Limites de evidência

Testes Workerd usam modelo e GitHub simulados. Não medem precisão do modelo real
nem comprovam GitHub App, permissões, provider ou publicação em produção. A
integração remota exige deploy autorizado dos novos bindings e um smoke separado.

## Fontes verificadas em 2026-10-04

- [GitHub: review comments e replies](https://docs.github.com/en/rest/pulls/comments)
- [GitHub: Git database](https://docs.github.com/en/rest/git)
- [Cloudflare: eventos e parâmetros de Workflows](https://developers.cloudflare.com/workflows/build/events-and-parameters/)
- Código e tipos instalados de Think 0.20.0 e Agents 0.26.0, confirmados pelo lockfile.
