---
id: RESEARCH-PR-EVIDENCE-PACKAGING
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-09
---

# Preservação das evidências e redução do diff do PR #182

O PR #182 contra `6dcb7e5`, na cabeça `e920794`, tinha 342 arquivos e
87.465 linhas adicionadas. Snapshots `.source` e resultados JSON/JSONL
representavam 85,73% dessas linhas; o código de produção representava 2,71%.
O diff textual Git tinha 3.483.717 bytes. A consulta ao endpoint GitHub usado
pelo adapter retornou HTTP 406 e informou o limite de 300 arquivos. O contrato
do executor também limita o diff canônico a 2.000.000 bytes.

Na medição offline, o planner selecionou 64 partes e declarou
`partial_by_policy`; estimava 166 partes para o conteúdo elegível completo.
Snapshots históricos com extensão `.source` participavam como texto genérico,
inclusive uma segunda cópia do lockfile de 9.587 linhas. Isso consumia capacidade
de investigação sem acrescentar código atual para revisar.

## Conteúdo preservado

Os 167 arquivos JSON e `.source` da campanha real foram transformados em um
[arquivo compactado com manifesto legível](experiments/2026-10-08-live-review/README.md#arquivo-de-evidências).
O pacote contém 157 sequências de bytes únicas e conserva os 167 caminhos
lógicos originais. Todas as entradas foram comparadas byte a byte com os blobs
Git de `e920794`, além da verificação de tamanho e SHA-256. O seed financeiro
permanece separado e idêntico. Os 2.581.873 bytes originais ocupam 750.335 bytes
no arquivo compactado; nenhuma resposta, falha, fonte, grader ou label foi editado.

O leitor valida arquivo, conteúdo e tamanhos, restringe caminhos e limita tanto
a descompressão quanto o total de bytes restaurados. O analisador reconcilia as
253 chamadas e exige igualdade com o resumo histórico. Sua saída é stdout;
`--read <caminho>` permite consultar qualquer entrada sem extração no checkout.
`pnpm test:evidence` e `pnpm test:evidence:coverage` integram os gates locais,
sem inferência ou acesso remoto. O módulo alcançou 100% de linhas, funções e
branches com testes de integridade, determinismo, corrupção e expansão excessiva.

O arquivo binário não participa do contexto textual da revisão. O manifesto,
o leitor, os relatórios e os testes continuam disponíveis para revisão normal.
O histórico Git anterior permanece preservado; a redução é no diff final do PR,
sem rebase ou reescrita dos commits publicados.

## Falha de browser investigada

A CI anterior falhou no fluxo português a 320 px: o clique em
“Gerenciar workspaces” não abriu o formulário. O trace registra o clique, sem
request para `/api/workspaces`; a hidratação é a hipótese causal sustentada pelo
intervalo de carregamento dos módulos. Uma regressão local bloqueou os módulos
JavaScript após uma navegação autenticada e reproduziu que o controle SSR estava
habilitado antes de seu handler existir.

`WorkspaceControls` agora mantém seus gatilhos desabilitados até instalar os
handlers. O teste libera os módulos e comprova que o primeiro clique abre o
formulário. Timeouts, retries, engines e assertions existentes foram mantidos.
Essa prova local sustenta a correção da corrida; o resultado da próxima CI
precisa ser observado separadamente.

## Limites da evidência

Os [metadados de validação](experiments/2026-10-09-review-core-code-follow-up/pr-evidence-packaging-verification.json)
registram tamanho do diff e admissão antes/depois. A medição usa o planner local
sobre o diff Git, sem inventário estrutural do executor nem inferência: comprova
admissão, não precisão ou recall. Os gates de schema/verdade causal do modelo e
qualidade dos perfis maiores continuam abertos. Nenhuma chamada paga nova foi
feita para essa reorganização; exposição conservadora permanece US$ 0,180025698
sob o teto acumulado de US$ 0,50. Não houve deploy ou migração remota.
