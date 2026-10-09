# Evidências de cobertura e Gateway em 2026-10-09

O [relatório](../../2026-10-09-review-context-coverage.md) descreve causas,
correções e limites. O arquivo `evidence.json.gz` conserva os quatro diretórios
originais: preparação que falhou sem inferência, duas rodadas reprovadas e a
rodada final 2/2. `evidence-manifest.json` relaciona caminhos, bytes e hashes.
Fontes capturadas são snapshots das rodadas, não o repositório inteiro.

São 170 entradas, 55 conteúdos únicos: 2.347.066 bytes originais em 307.306 bytes
compactados. O pacote foi extraído em memória e comparado byte a byte com todas
as entradas originais antes de ser registrado.

Leia e valide sem rede nem consumir modelo:

```bash
node docs/research/experiments/2026-10-09-review-context-coverage/analyze.mjs
node docs/research/experiments/2026-10-09-review-context-coverage/analyze.mjs --read live-2026-10-09T19-44-15.642Z/results.json
```

O analisador verifica integridade, fontes capturadas, oracles, denominadores,
caps, reservas e o seed financeiro anterior. Exige igualdade com o resumo
arquivado e conserva casos reprovados. O novo `campaign-spend.json` é o seed
completo de 272 reservas, separado do arquivo para retomada pelo CLI. O seed
de 2026-10-08 permanece intacto; sua análise continua reproduzindo o histórico.

O replay usa Git local nos SHAs registrados e somente módulos alterados:

```bash
node docs/research/experiments/2026-10-09-review-context-coverage/analyze.mjs --read replay-pr184.mts > /private/tmp/holon-pr184-replay.mts
pnpm --filter @holon/control-plane exec node --import tsx /private/tmp/holon-pr184-replay.mts "$PWD"
```

Requer os objetos Git, dependências e fontes corrigidos no checkout. O script
usa o argumento para localizar os fontes e explicita a varredura parcial; não
chama modelo nem reproduz o inventário completo de produção.

Para nova rodada paga, siga [operações](../../../operations/evaluations.md)
e execute `benchmark:live --quality-check --structural-context --coverage-regression`.
Não apague o ledger. Os snapshots já existentes não mudam quando a formatação
do checkout ou o caminho do seed financeiro são atualizados após o ensaio.
Fixtures, critérios do grader e limites de produção não foram relaxados.

Só há respostas finais sintéticas e fontes do projeto no pacote; não há tokens,
headers, prompts de requests ou payloads privados. O replay arquiva métricas e
identidades de commit, sem conteúdo dos módulos do PR. A família ajustada é
desenvolvimento e não fecha o gate geral de qualidade.
