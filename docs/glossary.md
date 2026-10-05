---
id: GLOSSARY
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-10-04
---

# Glossario

## Termos do dominio

**Review run**
: Uma tentativa de revisar uma revisao especifica de um Pull Request,
identificada pelo repositorio, numero do PR e SHA da cabeca.

**Finding**
: Um problema acionavel encontrado pelo sistema. Inclui evidencia, severidade,
caminho, coordenadas no diff e, quando seguro, sugestao de correcao.

**Review summary**
: Comentario unico que resume o resultado da review, riscos e limitacoes da
analise. Nao substitui findings inline.

**Surface mapping**
: Leitura inicial do diff para identificar mudancas de contrato, persistencia,
seguranca e logica de negocio que merecem investigacao adicional.

**Structural review**
: Review de JavaScript, TypeScript, JSX ou TSX que pode combinar patch, leitura,
busca textual e busca de sintaxe com uma gramática suportada.

**Textual review**
: Review de um patch textual elegível que usa diff, leitura limitada e busca
textual, sem prometer compreensão de AST ou semântica específica da linguagem.

**Eligible textual patch**
: Patch Git não binário, inclusive remoção, rename ou metadata-only, com caminho
normalizado que não corresponde às heurísticas de exclusão. "Elegível"
descreve a política de processamento; o conteúdo continua não confiável e
sujeito a prompt injection.

**Ignored file**
: Arquivo excluído do contexto e das tools por classificação binária, ausência
de patch Git utilizável ou heurística de lockfile, build, minificação,
sourcemap, geração, vendor ou caminho potencialmente sensível. A classificação
é defensiva e não equivale a um secret scanner.

**Cascade investigation**
: Busca por chamadores, usos, contratos e efeitos em arquivos nao alterados pelo
PR.

**Head SHA**
: SHA do commit mais recente da branch de origem do PR no momento em que a run
foi criada.

**Causal admission**
: Política que decide qual run pode agir usando, nesta ordem, o relógio causal
do PR (`updatedAt`), o recebimento do webhook e o run ID como desempate
determinístico. Ordem de consumo da Queue não concede autoridade.

**Causal verification**
: Verificação de um candidato a finding por um turno que tenta refutar o
caminho da mudança ao impacto. Produz `confirmed`, `refuted` ou `inconclusive`;
o host decide o que pode ser publicado. Distingue-se de causal admission, que
trata a autoridade temporal de uma run.

**Credential broker**
: Entrypoint confiável do control plane que autoriza container, run e
repositório antes de emitir uma credencial GitHub efêmera e restrita a um único
repository ID. A credencial não é persistida nem entregue ao Sandbox.

**Durable cleanup**
: Obrigação persistida atomicamente ao terminalizar uma run que criou Sandbox.
Um alarm do ledger repete a destruição idempotente até confirmação e só então
remove o credential scope.

**Idempotency key**
: Identificador estavel que impede que a mesma entrega ou efeito externo seja
processado mais de uma vez.

**PR actor**
: Unidade logica de coordenacao correspondente a um PR. Durable Object e uma
implementacao candidata; o termo nao implica que ela ja foi escolhida.

**Control plane**
: Deployable confiavel que recebe eventos, coordena a review e chama adapters.
Nao executa comandos ou codigo obtido do repositorio analisado.

**Deployable**
: Unidade com configuracao e ciclo de implantacao proprios. Um deployable pode
conter varios handlers e responsabilidades logicas.

**Porta**
: Interface definida pela aplicacao para uma capacidade externa, como publicar
no GitHub ou chamar um modelo, sem escolher a implementacao concreta.

**Adapter**
: Implementacao de uma porta que traduz entre contratos internos e um SDK, API
ou servico externo.

**Repository memory**
: Memória funcional isolada por instalação, repositório e geração; reúne observações com proveniência e regras submetidas à aprovação humana.

**Memory snapshot**
: Seleção privada e imutável de regras aprovadas e observações para uma run; shards e retries usam o mesmo conteúdo.

**Memory rule**
: Orientação com escopo, evidências, digest, validade e estado; apenas aprovação atual de mantenedor concede uso em novas runs. Não altera políticas do host.

## Identidade no Holon

**Holon user**
: Pessoa com identidade própria para usar o Holon, individualmente e/ou
como membro de equipes. Não se confunde com uma instalação da GitHub App.

**Holon workspace**
: Espaço de trabalho do Holon que reúne recursos e participação de usuários,
para uso pessoal ou de equipe. Organização e workspace designam o mesmo
conceito no Holon. É distinto da identidade de login e da instalação da GitHub App.

**Membership**
: Participação de um Holon user em um Holon workspace, com papel e permissões
internas naquele espaço. Não concede acesso GitHub por si.

**Personal workspace**
: Workspace exclusivo de um usuário para uso individual, sem convite de
outros membros ou conversão silenciosa para equipe.

**Team workspace**
: Workspace compartilhado por uma equipe, com participação e papéis explícitos
por usuário. Uma pessoa pode participar de várias equipes.

**Holon organization**
: Outro nome para Holon workspace, sem representar um nível adicional de
agrupamento. Não se confunde com uma organização GitHub.

**Workspace owner**
: Membro com papel de governar participantes e conexões de um workspace.
Uma equipe pode ter vários owners; o papel não concede acesso GitHub adicional.

**Workspace invitation**
: Convite explícito dirigido a um destinatário para ingressar em um workspace
como membro. Sua aceitação comprova a identidade do destinatário, sem conceder
acesso a repositórios por si.

## Termos de documentacao

**Fato confirmado**
: Afirmacao sustentada por fonte primaria atual.

**Inferencia**
: Conclusao derivada de fatos, mas nao declarada diretamente pela fonte.

**Proposta**
: Opcao em avaliacao que ainda nao e normativa.

**Decisao**
: Escolha registrada em ADR com status `accepted`.

**Finding clarification**
: Investigação limitada de uma pergunta explícita na discussão de um finding publicado. Tem identidade e orçamento próprios, ligados à decisão original e ao SHA atual, sem iniciar outra review run. Pode confirmar, delimitar, refutar ou declarar insuficiência de evidência.
