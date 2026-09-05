---
id: ARCH-PROJECT-VERSION-IDENTIFICATION
kind: architecture
status: current
owners: [core-team]
last-reviewed: 2026-09-05
---

# Identificação de versões

Autoridade: [ADR-0030](../decisions/0030-identify-project-versions-from-snapshot-evidence.md).

## Fluxo e contratos

Após preparar o checkout exato, o executor grava autoridade de run, instalação, repositório, head/base e digest da política. O RPC `discoverProjectMetadataV1` valida essa autoridade antes de `git ls-tree`/`git cat-file`. Apenas arquivos de metadados permitidos são lidos; a exceção para lockfiles não remove exclusões de secrets, diretórios gerados ou política do repositório. Symlinks e ponteiros LFS não são seguidos.

`identifySnapshot` é a API reutilizável: recebe arquivos e digests de política/perfil, e opcionalmente caminhos alterados. Sem `changedPaths`, identifica todos os projetos suportados, até o limite. IDs são `ecossistema:raiz`; um diretório pode conter Node e Maven. Mudanças em fontes ancestrais/local parents/tsconfig compartilhado invalidam consumidores. O fingerprint inclui paths, conteúdos, inventário relevante, limitações, detector, perfil e política; o SHA fica na proveniência, permitindo reutilização entre commits com as mesmas entradas.

O control-plane separa checkpoints de descoberta, inferência por projeto e gravação no ledger. `interpretProjects` recebe ports de modelo/cache; `verifyInterpretation` exige IDs existentes e nomes coincidentes. O modelo não fornece versões livres. Limitações e abstenções sobrevivem ao cache e à visualização.

Se um manifest/lock mudou, a coleta tenta também a base imutável. A ausência dessa base é explícita. A review recebe somente projetos associados aos arquivos do shard, como dados não confiáveis; a política do repositório continua sendo autoridade.

## Suporte estático

| Ecossistema | Fontes e semântica                                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node/TS     | package.json, engines/Volta/devEngines/packageManager, runtime files, tsconfig local extends, npm locks 2/3, pnpm 6/9 por importer, catálogos pnpm, Yarn Classic/Berry por seletor direto          |
| Maven       | POM, propriedades locais e parents com coordenadas compatíveis, parent/BOM/dependency management, compiler plugin/properties e toolchain declarado; profiles condicionais, sem resolver POM remoto |
| Gradle      | Literais de dependências, JavaLanguageVersion, catálogo TOML e lock por configuração; sempre condicionado à não execução do script                                                                 |
| Python      | pyproject/Poetry/requirements, requires-python e runtime files, uv/Poetry lock compartilhado filtrado pelas dependências diretas; markers e seleção de ambiente condicionais                       |

Formatos malformados, limites e resoluções externas viram limitações. Dependências dinâmicas, versões não declaradas, includes arbitrários e configuração executável não são adivinhados. JavaScript não fornece uma versão de Node implícita; TypeScript target não fornece runtime; Spring Boot/BOM não prova uma versão específica de cada dependência transitiva.

## Limites e cache

Inventário: 2.000 candidatos/1 MiB de listagem; 20 projetos; 64 KiB por configuração, 2 MiB por lock e 16 MiB total. Resultado de projetos limitado a 200.000 bytes por snapshot, com truncamento explícito para manter checkpoints limitados. Até 500 fatos e 100 tecnologias por projeto. O prompt de identificação usa projeção compacta de fatos e limite conservador de 11.000 bytes para caber no teto de 12.000 tokens, incluindo instruções; saída 4.000 tokens, sem retries automáticos do SDK. Um projeto pode tentar duas vezes; a run tem orçamento durável de oito chamadas, janela de 120 segundos e timeout de 30 segundos por chamada.

Leases de 90 segundos, cooldown de cinco minutos, fencing monotônico mesmo após eviction, cache até 1.000 entradas/16 MiB. Registro por instalação agenda purge em lotes de 25 caches. Remoção/suspensão exige evento GitHub assinado. Readição/unsuspend usa nova geração; o cache antigo permanece revogado. A identificação integra o workflow padrão sem flag de habilitação; alarms de purge são independentes das execuções de review.

## Admin e operação

Run detail mostra raízes, tecnologias, valores, tipo de declaração e seletor/arquivo de origem, além dos estados parcial/indisponível/sem registro. Dados são escapados como texto React. O RPC V2 é o único contrato de detalhe; o admin não aceita respostas V1 nem tenta métodos antigos.

[Operação e avaliação](../operations/project-version-identification.md) descrevem ativação, invalidação e validação. Não há serviço de documentação, novo endpoint público de escrita ou valores de onboarding nesta etapa.
