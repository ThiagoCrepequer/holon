---
id: PRODUCT-REVIEW-QUALITY
kind: product
status: accepted
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Contrato de qualidade da review

Este documento define o contrato inicial implementado. Métricas de produto e o
limiar numérico ainda devem ser recalibrados com um corpus maior.

## Um finding publicavel deve

- apontar um comportamento defeituoso, risco de seguranca ou quebra de contrato;
- explicar o caminho causal entre a mudanca e o impacto;
- identificar o consumidor ou a operação afetada e o comportamento que falha;
- citar evidencia recuperada do diff ou do repositorio;
- usar uma linha que pertença ao diff atual;
- distinguir fato observado de inferencia;
- oferecer uma acao concreta quando uma correcao segura for conhecida;
- ter confianca suficiente para justificar interromper o fluxo do autor.

## Um finding nao deve

- repetir linter ou formatter sem impacto funcional;
- assumir comportamento de codigo que nao foi lido;
- declarar que testes passaram se eles nao foram executados;
- sugerir uma API inexistente;
- expor segredos ou reproduzir dados sensiveis;
- alegar compreensão estrutural de um arquivo classificado como `textual`;
- publicar a mesma conclusao em varias linhas;
- classificar como erro uma preferencia de estilo.
- transformar uma solicitação para verificar compatibilidade em defeito sem
  demonstrar uma quebra. Mover uma declaração preservando seu reexport de tipo
  não prova ruptura; aceitar string vazia num campo obrigatório não o torna
  opcional. É preciso examinar exports, produtores, normalização e consumidores.

## Severidade

| Nivel      | Definicao                                                                           |
| ---------- | ----------------------------------------------------------------------------------- |
| `critical` | Exploracao de seguranca, perda grave de dados ou indisponibilidade ampla e provavel |
| `high`     | Regressao funcional importante ou quebra de contrato com caminho concreto           |
| `medium`   | Defeito real de escopo limitado ou risco relevante dependente de condicao           |
| `low`      | Melhoria acionavel com impacto pequeno; normalmente vai apenas ao resumo            |

## Politica de silencio

Ausencia de findings e um resultado valido. Quando a evidencia nao sustentar um
comentario inline, a incerteza deve aparecer no resumo ou ser descartada, nunca
ser convertida em acusacao especulativa.

No MVP, confiança abaixo de 0,8 é descartada; severidade `low` fica somente no
resumo; `medium`, `high` e `critical` podem virar inline comment. Todo finding
precisa de evidência e sua linha final deve pertencer às linhas adicionadas no
lado `RIGHT` do diff atual.

Uma execução publica no máximo os três findings de maior confiança. Se limites
de arquivos, bytes ou coordenadas forem atingidos, o resumo precisa declarar
que a review foi parcial. JS/TS recebe investigação estrutural; demais patches
textuais elegíveis recebem review textual e exigem silêncio mais conservador
quando o patch e as tools textuais não provarem o caminho causal.

O feedback publicado usa o mesmo formato de cabeçalho e cobertura para
aprovação, alterações solicitadas e comentário informativo. A aprovação com
zero achados só comunica revisão completa. Falha, limite ou investigação
degradada comunica revisão incompleta e quantidade de partes analisadas, sem
converter ausência de achados verificados em aprovação. Alterações sem arquivos
elegíveis têm estado próprio. Atualizações por feedback humano e aprovações
posteriores sem novos achados mantêm a mesma identificação visual.

Se o modelo devolver `summary` vazio, o host marca o shard como degradado e
continua a validar cada candidato a finding contra a evidência canônica. O
resumo narrativo ausente não descarta sozinho esses candidatos, mas também não
autoriza aprovação. Achados publicados ainda precisam satisfazer todos os
critérios de evidência e ancoragem acima.

Se todos os arquivos forem binários, lockfiles, gerados, vendorizados,
minificados ou corresponderem às heurísticas de caminhos
potencialmente sensíveis, a run publica resumo determinístico sem consumo de
modelo. Essas heurísticas reduzem exposição e ruído, mas não constituem um
secret scanner nem substituem redaction.

Remoções, renames e metadata-only elegíveis ainda recebem review. Sem uma linha
adicionada no lado `RIGHT`, o modelo deve retornar zero findings e registrar no
resumo apenas riscos comprovados que não podem ser ancorados inline.

## Avaliação

O pacote `@holon/evaluation` inicia a baseline offline com schema estrito,
proveniência somente sintética ou pública, partições `development`/`holdout`,
matching one-to-one de findings, precisão, recall, severidade, confiança,
parcialidade e termos obrigatórios/proibidos. A configuração registra versões
de corpus, política, prompt e subject. Os modos obrigatórios em PR não chamam
modelo, GitHub ou Cloudflare; o subject é injetado e toda saída é revalidada. O
adapter live manual chama somente a rota autenticada já adotada no AI Gateway.
Findings com evidência ausente do patch canônico são rejeitados antes do
grading e contabilizados separadamente.

O corpus V1 inicial recriou dois smokes como fixtures sintéticas: regressão do
limiar de confiança e controle negativo de documentação. A V2 preserva o
controle negativo e torna a regressão autocontida, mantendo no patch a constante
de política que o novo literal contradiz. A V3 adiciona limite de três findings,
instrução adversarial acompanhada de regressão real e contexto explicitamente
parcial. Essas amostras provam o runner, não
representam uma métrica de qualidade do produto nem autorizam gates numéricos.

A V4 acrescenta dois controles negativos sintéticos baseados nos falsos
positivos do PR #121: um campo obrigatório que passa a aceitar string vazia com
normalização no produtor e uma interface movida com reexport de tipo preservado.
O grader marca comentários que aleguem quebra nesses casos como achados
inesperados, mesmo com excertos corretos do patch. Essa avaliação offline não
prova que o Agent real deixará de produzi-los; isso exige execução live com o
runtime atual.

Em Pull Requests, o workflow de avaliação executa os testes do subject mockado e
as recordings sintéticas V4, sem secrets nem chamadas a provedores durante a
avaliação. O subject live é acionado somente por `workflow_dispatch` sobre
`main`, usa o GitHub Environment
`live-evaluation` e não clona repositório nem publica review. Seu relatório
persiste IDs, versões, métricas, falhas enumeradas e telemetria de uso; não
persiste prompt, patch, evidência ou resposta integral.

O conjunto de avaliação deve crescer com:

- PRs com regressao conhecida;
- PRs corretos que testem falsos positivos;
- mudancas de assinatura com chamadores fora do diff;
- mudancas de persistencia e concorrencia;
- vulnerabilidades representativas;
- patches textuais corretos e defeituosos fora de JS/TS;
- PRs contendo somente arquivos excluídos e PRs mistos;
- diffs grandes, truncados e com force-push;
- reentrega do mesmo webhook.
