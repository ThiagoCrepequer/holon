---
id: RESEARCH-PR186-REVIEW-FAILURES
kind: research
status: current
owners: [core-team]
last-reviewed: 2026-10-10
---

# PR #186: falhas de execução, cobertura e qualidade do modelo

A [auditoria integral, causas por execução e classificação dos registros](https://github.com/ThiagoCrepequer/holon/blob/f86a6289864fc5956119fc4252aac6ffd9522000/docs/research/2026-10-10-pr186-review-failures.md) foi preservada byte a byte no [arquivo de evidências](../planning/dashboard-seven-assets/README.md#arquivo-das-capturas-anteriores), junto do JSON sanitizado e método completo de coleta.

**Seis execuções publicaram revisão incompleta (`neutral`) e uma falhou (`failure`); nenhuma teve cobertura completa.** Não foram sete crashes do modelo.

- Código/host: inventário parcial, checks omitidos, diferença entre schema do prompt e transporte e coleta de evidências abortando lanes depois da resposta do modelo.
- Modelo: duas saídas inválidas, evidências divergentes do patch e falso positivo confirmado apesar do reexport preservado; trocar modelo não elimina os defeitos do host.
- Integração/provedor: timeout catalogado do Sandbox e erro de tools do NextBit em HTTP 200. O ramo do deadline, a causa dos requests de projeção e a separação entre capacidade do modelo e implementação do provedor permanecem indeterminados.

A janela foi `2026-10-09T21:50:00Z`–`2026-10-10T16:15:00Z`: 21 commits, sete pais, 167 filhos, 181 requisições no Gateway e 82 registros (51 erros/31 avisos, não 82 incidentes). Houve 37 consultas de erros sem amostragem da query, `abr_level=1`; retenção/ingestão e três detalhes inacessíveis limitam completude. Não foram exportados prompts, diffs, credenciais ou exceções livres.

As [correções e provas locais](2026-10-10-pr186-review-recovery-fixes.md) não reclassificam o histórico nem qualificam estatisticamente o modelo. Elas registram também os limites de diff revelados pelos pushes posteriores.
