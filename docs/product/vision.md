---
id: PRODUCT-VISION
kind: product
status: current
owners:
  - core-team
last-reviewed: 2026-08-29
---

# Visao do produto

Holon deve revisar Pull Requests com foco em defeitos que exigem contexto alem
do diff. O produto investiga como uma alteracao afeta contratos, chamadores,
persistencia, seguranca e comportamento de outros arquivos antes de publicar
feedback no GitHub.

## Problema

Reviews automatizadas baseadas somente no patch tendem a produzir observacoes
superficiais e falsos positivos. Elas frequentemente nao detectam que uma
assinatura alterada continua sendo chamada em arquivos fora do diff, que uma
query quebrou uma invariavel ou que um novo fluxo ampliou uma trust boundary.

## Resultado desejado

Para cada PR elegivel, Holon deve:

1. mapear mudancas relevantes no diff;
2. investigar dependencias e usos no repositorio;
3. avaliar risco com evidencia recuperavel;
4. publicar apenas findings acionaveis em linhas validas do diff;
5. publicar um resumo com riscos, cobertura e limitacoes;
6. evitar comentarios duplicados quando o mesmo evento for reenviado.

## Principios

- Contexto antes de opiniao.
- Evidencia antes de severidade.
- Defeitos funcionais, de seguranca e arquitetura antes de estilo.
- Nenhum comentario quando a confianca for insuficiente.
- Menor privilegio e minimizacao de codigo enviado a provedores externos.
- Resultados reproduziveis e auditaveis por `review run`.
