---
id: ADR-0057
kind: decision
status: accepted
date: 2026-10-09
owners: [core-team]
related:
  - 0050-verify-finding-causality-before-publication.md
  - 0055-preserve-review-evidence-and-schedule-stable-lanes.md
---

# Selecionar receipts do host nos assessments causais

## Problema

A campanha real encontrou assessments com IDs incorretos e intervalos invertidos,
mesmo depois de fornecer registros copiáveis. Repetir path e coordenadas no
assessment cria combinações inválidas de metadados que o host já possui. Essas
falhas conservam segurança ao reter candidatos, mas reduzem recall operacional.

## Decisão

O contrato atual usa `evidenceReceiptIds: string[]`. A resposta seleciona IDs
completos emitidos pelo host; não redefine path ou intervalo. Atualizar schema,
prompt, host e consumidores juntos, sem aliases ou fallback para o formato antigo.
Esta decisão complementa as ADRs 0050/0055, preservando suas garantias.

Cada ID selecionado deve pertencer a uma leitura completa da execução. O host
resolve a janela inteira do receipt e valida seu schema, inclusive limites de
linhas. O adapter continua recalculando identidade/conteúdo do pacote no run/head
esperado antes de entregar receipts ao caso de uso. Essa validação criptográfica
não é substituída pela pertença ao conjunto de IDs. Premissa `repository` exige
pelo menos um ID; `patch` exige lista vazia. Assessment permanece posicional,
exaustivo e incapaz de criar ou reescrever findings.

O contexto da conversa causal contém fatos do snapshot e patches canônicos,
separados das instruções da investigação. Limitações de entrada e preferências
de idioma acompanham esse contexto. O verificador precisa considerar argumentos,
guards e alcance real; uma leitura válida comprova acesso ao conteúdo, não a
correção dessa inferência. O host não corrige IDs inventados nem remove a proteção
causal para melhorar o benchmark.

## Alternativas e consequências

- Manter referências com coordenadas duplicadas foi rejeitado por falhas reais.
- Números curtos ou aliases de receipts foram rejeitados: exigiriam outra tabela
  de identidade sem resolver a qualidade semântica.
- Aceitar a referência mais parecida ou completar metadados inventados foi
  rejeitado: uma resposta inválida deve continuar inconclusiva.

Selecionar a janela inteira remove a possibilidade de declarar um subintervalo
no assessment. O conteúdo compartilhado continua limitado a oito reads e 20 kB.
A simplificação pode reduzir erros de saída; não demonstra melhora de precisão,
severidade ou latência por si só. O falso positivo encontrado na campanha permanece
registrado, mesmo se uma repetição acertar o mesmo caso.

## Confirmação

Testes cobrem seleção válida, base patch/repository, IDs desconhecidos, limites,
metadados inválidos, janela invertida no host, truncamento, uso compartilhado e
integração Think com refutação após uma leitura. O
[benchmark real](../research/2026-10-08-review-core-live-benchmark.md) conserva todas
as tentativas e verifica estabilidade do protocolo separadamente da causalidade.
