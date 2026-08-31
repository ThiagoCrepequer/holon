---
id: PRODUCT-REVIEW-QUALITY
kind: product
status: accepted
owners:
  - core-team
last-reviewed: 2026-08-30
---

# Contrato de qualidade da review

Este documento define o contrato inicial implementado. Métricas de produto e o
limiar numérico ainda devem ser recalibrados com um corpus maior.

## Um finding publicavel deve

- apontar um comportamento defeituoso, risco de seguranca ou quebra de contrato;
- explicar o caminho causal entre a mudanca e o impacto;
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

Se todos os arquivos forem binários, lockfiles, gerados, vendorizados,
minificados ou corresponderem às heurísticas de caminhos
potencialmente sensíveis, a run publica resumo determinístico sem consumo de
modelo. Essas heurísticas reduzem exposição e ruído, mas não constituem um
secret scanner nem substituem redaction.

Remoções, renames e metadata-only elegíveis ainda recebem review. Sem uma linha
adicionada no lado `RIGHT`, o modelo deve retornar zero findings e registrar no
resumo apenas riscos comprovados que não podem ser ancorados inline.

## Avaliacao futura

O conjunto de avaliacao deve conter:

- PRs com regressao conhecida;
- PRs corretos que testem falsos positivos;
- mudancas de assinatura com chamadores fora do diff;
- mudancas de persistencia e concorrencia;
- vulnerabilidades representativas;
- patches textuais corretos e defeituosos fora de JS/TS;
- PRs contendo somente arquivos excluídos e PRs mistos;
- diffs grandes, truncados e com force-push;
- reentrega do mesmo webhook.
