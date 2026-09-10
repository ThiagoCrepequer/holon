---
id: ADR-0037
kind: decision
status: accepted
owners: [core-team]
last-reviewed: 2026-09-09
---

# Compilar configuração imutável por execução

## Contexto

O produto aprovou o [plano de configuração](../planning/repository-configuration-and-editor-schema.md)
e sua implementação integral. A política atual cobre exclusões/veredito; a expansão
inclui idioma, apresentação, projetos, compatibilidade e instruções inline ou em
arquivos. As [evidências de 2026-09-09](../research/2026-09-09-repository-configuration-and-editor-schema.md)
fundamentam autoridade Git, conversão de schema e replay durável.

## Decisão

Aplicar o plano com um único contrato atual, conforme ADR-0036. Não adicionar
versões de transporte ou caminhos de compatibilidade. Esta ADR substitui a
identidade somente por head da ADR-0015 e amplia a política da ADR-0028, ambas
já substituídas em parte pela ADR-0036; suas demais garantias continuam válidas.

Defaults: idioma `en`, detalhe `concise`, até 40 novos comentários inline. Idiomas
suportados: `en`, `pt-BR`, `es`. Manter os limites de configuração descritos no
plano, inclusive 64 KiB YAML, 32 KiB por referência, 256 KiB de fontes,
512 KiB serializados e 32 KiB de guidance por shard. Instruções são strings
multilinha ou `{ path }`, sem expansão recursiva. Paths de projeto são relativos
ao root; referências globais/regras são relativas à raiz do repositório.

A identidade da run incorpora PR, head e base SHA. A ordem causal permanece
independente da identidade. Configuração e referências vêm do base SHA;
conteúdo no head não governa sua própria revisão. Provar ausência e tipo pela
árvore Git, com leitura limitada de blobs e erros tipados; indisponibilidade não
vira default. Não seguir symlinks, submodules, LFS ou URLs de configuração.

O compilador materializa defaults e proveniência. O ledger sela um snapshot por
run e retorna um manifesto pequeno; retries e eviction reusam esse snapshot.
Consumidores recebem projeções por responsabilidade. O escopo de segurança e o
contexto de identificação não dependem do idioma ou do limite de comentários.
Configuração divergente para snapshot selado falha explicitamente.

Guidance por arquivo é global, seguido do projeto mais específico e das regras
correspondentes na ordem declarada. Não há herança implícita entre projetos
aninhados. Referências de contexto permanecem dados, sem autoridade de instrução.
Políticas da plataforma, verificação de evidência e permissões não podem ser
relaxadas pelo texto do usuário. Limites de contexto são verificados antes da
inferência; instruções obrigatórias não são truncadas silenciosamente.

Compatibilidade declarada não sobrescreve versões detectadas. Comparação sem
semântica confiável permanece `unknown`; divergência não constitui por si um
defeito bloqueante. Idioma não muda evidência/IDs. Matching por evidência continua
conservador: grupos ambíguos permanecem pendentes sem duplicação ou resolução
automática. O cap inline não reduz análise, persistência ou veredito.

Gerar JSON Schema draft-07 do contrato estrutural de entrada Zod, sem afrouxamento
de tipos não representáveis. Publicar o artefato estático do build em
`/schemas/holon.schema.json` no control-plane; o host concreto é o do deploy.
O runtime não consulta o modeline ou schemas externos. Defaults do JSON Schema
são documentação; validação semântica continua no compilador.

## Consequências

Implementação, CLI, exemplos, schema, consumidores, templates e testes mudam
juntos. Todos os textos temporários são privados e recebem cleanup durável,
inclusive em falha antes de criar Sandbox. Preferências mínimas e o limiar de veredito persistidos permitem feedback e CI
posteriores sem reler configuração. Resultados verificados dos findings são
retidos separadamente da análise temporária para consulta autenticada no console,
incluindo sugestões e evidências que ficaram fora do cap inline. Não entram em
D1, logs ou checkpoints sanitizados. O prazo geral de retenção/deleção do ledger
continua pendente antes de uso com repositórios privados.

Mudanças de identidade/estado exigem rollout coordenado, drenagem e eventual
reset de desenvolvimento explicitamente autorizado; não executar deploy/reset
como parte da geração do schema. Prova local e avaliação offline não comprovam
operação live. Automação para eventos exclusivos da base e reexecução manual da
mesma dupla permanecem fora do YAML e não são prometidas por esta entrega.
