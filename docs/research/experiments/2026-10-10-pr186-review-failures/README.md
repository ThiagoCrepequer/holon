# Evidências da auditoria do PR #186

O [método integral de coleta](https://github.com/ThiagoCrepequer/holon/blob/f86a6289864fc5956119fc4252aac6ffd9522000/docs/research/experiments/2026-10-10-pr186-review-failures/README.md) e o JSON sanitizado estão no [arquivo de evidências](../../../planning/dashboard-seven-assets/README.md#arquivo-das-capturas-anteriores), com paths, tamanhos e SHA-256 no manifesto. O replay usa o leitor existente, sem extração no checkout.

O JSON original preserva IDs, horários, versões, sete runs, 167 filhos, 181 requisições, 37 consultas e a classificação de 82 registros. Não contém prompts, respostas integrais, diffs, credenciais ou exceções livres. Os bytes foram comparados com `f86a6289864fc5956119fc4252aac6ffd9522000`.

O [relatório](../../2026-10-10-pr186-review-failures.md) mantém a conclusão e acesso ao texto integral. A [continuação](../../2026-10-10-pr186-review-recovery-fixes.md) distingue correções locais e observações posteriores; nenhum resultado histórico foi reescrito.
