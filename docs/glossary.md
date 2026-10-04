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
