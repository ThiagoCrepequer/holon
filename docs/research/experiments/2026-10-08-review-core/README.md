# Probes da auditoria de 2026-10-08

[probes.mts](probes.mts) invoca funções reais do core com entradas sintéticas.
[results.jsonl](results.jsonl) registra os 14 diagnósticos no commit `1941a4f`,
com Node 24.19.0 e dependências do lockfile instalado por pnpm 11.24.0.
Sandbox e GitHub são doubles externos; não há execução de comandos do repositório,
POST remoto, provider de modelo ou recursos Cloudflare reais.

Na raiz:

```sh
node --import ./packages/evaluation/node_modules/tsx/dist/loader.mjs docs/research/experiments/2026-10-08-review-core/probes.mts
```

Os resultados observados são diagnósticos datados, não expectativas corretas a
codificar na suite. Depois de uma correção, a saída correspondente deve mudar.
As entradas, efeitos, prioridades e regressões esperadas estão na
[auditoria](../../2026-10-08-review-core-audit.md). Preservar o registro histórico;
novas medições devem identificar sua revisão de código.
