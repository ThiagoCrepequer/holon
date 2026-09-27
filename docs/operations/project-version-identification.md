---
id: OPS-PROJECT-VERSION-IDENTIFICATION
kind: reference
status: current
owners: [core-team]
last-reviewed: 2026-09-10
---

# Operar a identificação de versões

## Configuração

A identificação faz parte do workflow padrão, sem flag de habilitação. No control-plane: `PROJECT_IDENTIFICATION_MODE=observe`, `PROJECT_IDENTIFICATION_PROFILE=identification-v1`. O modelo usa `AI_MODEL_ID` e credenciais do Gateway existente. Alterar o perfil invalida a reutilização lógica; mudar a rota dinâmica sem mudar o perfil pode reutilizar a classificação anterior. O detector também versiona a chave.

`observe` identifica e registra para inspeção, mas não enriquece o prompt. `enrich` entrega a identificação à investigação. Runs anteriores mostram “not recorded”; não há backfill implícito.

Deploy autorizado: executor com nova capacidade, control-plane com as duas novas classes DO/migration acrescentada após `v1` sem flag de habilitação, admin com contrato atual obrigatório. Depois smoke sintético, observe e avaliação antes de enrich. Não remover migration/namespace para rollback. Deploy, recursos remotos e chamadas live não foram executados pela implementação local.

## Verificação

```bash
pnpm --filter @holon/project-identification test:coverage
pnpm --filter @holon/evaluation evaluate:identification offline
```

O corpus `packages/evaluation/corpus/project-identification` contém 44 fixtures sintéticas sob a licença do repositório, 33 de desenvolvimento e 11 holdout. Os oráculos são declarações esperadas, separados dos parsers. O runner mede precisão/recall por declaração e categoria, promoção falsa a exact, falhas e duração. A avaliação offline não comprova a classificação de um modelo real.

Com autorização e credenciais do operador, o comando abaixo faz no máximo uma chamada por projeto do corpus, sem GitHub, publicação ou cache remoto. Não executar em CI padrão:

```bash
pnpm --filter @holon/evaluation evaluate:identification live
```

O resultado inclui tokens e chamadas; não imprime manifests, prompts ou outputs do provedor. Gate: nenhuma promoção falsa a exact, precisão >=98%, recall >=90%, nenhuma falha de provider/verificação. Os testes de cache/workflow validam cold/warm e ausência de nova chamada em hit, separadamente da qualidade do modelo.

## Diagnóstico sem conteúdo

Verificar status/limitações no Run detail, step timing `identify-projects`, contagem de chamadas/tokens no snapshot e namespace correto. `source-unreadable`, `external-parent-unresolved` e `build-script-not-evaluated` não são erros da review. `identification-pending` indica lease de outra execução; `model-unavailable` preserva fatos determinísticos. `PROJECT_METADATA_AUTHORITY` é uma falha de autoridade e não deve ser convertida em sucesso.

A revogação via eventos assinados agenda purge durável; falhas de purge são retomadas por alarm. A reautorização usa namespace com geração nova. Não editar o cache para simular identificação: no futuro valores confirmados no onboarding serão outra entidade.

Limites e fronteiras: [arquitetura](../architecture/project-version-identification.md). Evidência externa consultada em 2026-09-05: [Maven POM](https://maven.apache.org/pom.html), [pnpm catalogs](https://pnpm.io/catalogs), [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/), [Workflows rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/), [Yarn parsers](https://github.com/yarnpkg/berry/tree/master/packages/yarnpkg-parsers).

## Declarações de configuração

`projects` associa roots configurados aos projetos detectados sem renomear seus
IDs. Compatibilidade esperada é exibida separadamente de evidência detectada;
idioma, descrição e cap inline não alteram o cache de identificação. Consulte
[configuração](repository-configuration.md) para precedência e limites de
comparação SemVer, PEP 440 e famílias Java.
