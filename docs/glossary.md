---
id: GLOSSARY
kind: reference
status: current
owners:
  - core-team
last-reviewed: 2026-08-29
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

**Cascade investigation**
: Busca por chamadores, usos, contratos e efeitos em arquivos nao alterados pelo
PR.

**Head SHA**
: SHA do commit mais recente da branch de origem do PR no momento em que a run
foi criada.

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
