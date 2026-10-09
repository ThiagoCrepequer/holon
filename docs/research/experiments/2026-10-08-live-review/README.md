# Campanha real limitada do core de revisão

O [relatório](../../2026-10-08-review-core-live-benchmark.md) interpreta resultados
e gates. `plan.json` de cada rodada fixa casos, caps, rota, imagem e hashes
antes das chamadas. `results.json` conserva falhas, respostas finais sintéticas,
usage, tools e timings. Os snapshots não contêm tokens, headers nem prompts de
requests. A captura é restrita a fixtures sintéticas; não autoriza coleta de PRs
privados. Trace e coleta de payloads no Gateway ficam desligados.

Execute a análise sem rede, credencial ou inferência:

```bash
node docs/research/experiments/2026-10-08-live-review/analyze.mjs
```

O analisador reconcilia requests com `campaign-spend.json`, preserva falhas no
denominador, verifica caps/oracles/hashes disponíveis e imprime o resumo completo
em stdout. Ele também exige igualdade com o `summary.json` histórico arquivado;
não regrava nem recalcula silenciosamente os resultados versionados.
`initial-partial` já participa de `ablation` e não é contado de novo.
`price-probe.json` contém dois testes de transporte de 16 tokens; contam dinheiro,
mas não qualidade. Os probes positivos também não viram baseline de aceitação.

## Arquivo de evidências

Em 2026-10-09, os 167 arquivos JSON e `.source` foram preservados byte a byte em
[evidence.json.gz](evidence.json.gz), com 157 conteúdos únicos. O
[manifesto legível](evidence-manifest.json) mantém todos os caminhos lógicos
originais, tamanho e SHA-256 de cada entrada e do arquivo compactado. Os
2.581.873 bytes originais ocupam 750.335 bytes compactados. Nenhum resultado,
falha, grader ou fonte foi alterado. `campaign-spend.json` permanece separado,
pois o CLI o usa como seed financeiro sem depender do arquivo de evidências.

Consulte qualquer entrada sem rede e sem extraí-la no checkout:

```bash
node docs/research/experiments/2026-10-08-live-review/analyze.mjs --read code-regression/results.json
node docs/research/experiments/2026-10-08-live-review/analyze.mjs --read summary.json
```

O leitor valida o hash do arquivo, de cada conteúdo e os tamanhos declarados;
recusa conteúdo adulterado, caminhos relativos inseguros e expansão acima de
16 MB. `pnpm test:evidence` verifica esses controles e reconcilia a campanha sem
inferência. Para novas campanhas, capture primeiro em `artifacts/`; revise o
escopo sintético, produza o pacote com `packEvidence` de
`tooling/evidence/archive.mjs`, compare todas as entradas originais com
`unpackEvidence` e só então substitua os arquivos soltos. Preserve o histórico
e acrescente uma campanha distinta quando fontes, fixtures ou graders mudarem.

Dentro do arquivo, `source-files.json` nas rodadas posteriores aponta para
`source-snapshots/<sha256>.source`. As rodadas iniciais usam `sources/`;
fontes que não estavam disponíveis são listadas em `summary.json`, sem serem
reconstruídas como se fossem originais. Não são snapshots completos do Git: os
hashes comprovam somente as fontes explicitamente capturadas, com dependências
identificadas pelo lockfile e imagem. A reprodução integral dos ensaios antigos
tem esse limite. Não formatar snapshots `.source`, pois isso altera seu hash.

A campanha contabiliza 253 requests, US$ 0,062482311 informados e exposição
conservadora de US$ 0,180025698 sob teto acumulado de US$ 0,50. Onze requests não
informaram custo. O spending local não deve ser apagado; o snapshot versionado
serve como seed conservador se ele faltar. Valores conhecidos não são fatura
completa dos attempts internos do provider.

Amostras de 4/4 ocorreram em desenvolvimento e no primeiro holdout; a repetição
falhou e uma confirmação nova expôs falso positivo. Dados já usados para ajustar
prompt passam a desenvolvimento. Nunca tratar repetições ajustadas como holdout
novo nem escolher só a melhor rodada para fechar gates.

`code-regression` acrescenta em 2026-10-09 o par novo de export com alias:
2/2, cinco chamadas, compilação estrita de base/head e rubrica lexical de
diagnóstico/severidade. O [relatório da continuação](../../2026-10-09-review-core-code-follow-up.md)
registra controles negativos antigos com erros de tipos. Os resultados históricos
e seus graders são preservados; não combiná-los com a rodada nova como amostra
homogênea nem inferir precisão publicada da rubrica lexical.

`code-regression-repeat` conserva a única repetição após a correção de limites
de identificadores: outros 2/2 e cinco chamadas. As duas rodadas são a mesma
família e não constituem holdout independente; juntas custaram US$ 0,002419890
informados. O gate global permanece aberto.
