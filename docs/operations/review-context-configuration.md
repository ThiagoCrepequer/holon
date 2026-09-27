---
id: OPS-REVIEW-CONTEXT
kind: reference
status: current
last-reviewed: 2026-09-27
---

# Configurar o contexto complementar da review

Use **um** arquivo `.github/holon.yml` ou `.holon.yml`. Holon lê a configuração
no SHA base do PR; alterações propostas pelo próprio PR não ampliam sua autoridade.
O parser rejeita chaves desconhecidas, aliases, tags e aninhamento excessivo.
O arquivo continua limitado a 64 KiB.

```yaml
review:
  instructions:
    - "Verificar isolamento entre tenants nas consultas e atualizações."
  projects:
    - root: apps/api
      instructions:
        - "Preservar a transação ao atualizar saldo e histórico."
      compatibility:
        node: "22"
    - root: apps/web
      compatibility:
        react: "19"
verdict:
  strictness: default
```

Instruções e compatibilidade só são aplicadas aos projetos cujas raízes contêm
arquivos do shard. Cada lista tem no máximo oito instruções de mil caracteres;
são permitidos vinte projetos e vinte alvos de compatibilidade por projeto.
Compatibilidade é intenção declarada, não substitui a versão observada em
manifestos/lockfiles. As restrições de segurança, evidência e formato continuam
controladas pelo host.

## Documentação de versões

`review.documentation` aceita até quatro objetos com estes campos obrigatórios:

| Campo        | Conteúdo                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| `root`       | Raiz do projeto, `.` ou caminho relativo normalizado                            |
| `technology` | Nome exato da tecnologia na identificação do projeto                            |
| `version`    | Valor exato observado como `locked` ou `declared-exact`                         |
| `url`        | URL HTTPS de host oficial permitido, sem credenciais, porta, query ou fragmento |
| `sha256`     | SHA-256 hexadecimal dos bytes exatos da resposta                                |

Hosts iniciais: `nodejs.org`, `www.typescriptlang.org`, `react.dev`, `nextjs.org`,
`docs.python.org`, `docs.oracle.com`, `quarkus.io`, `docs.spring.io`,
`developer.mozilla.org` e `developers.cloudflare.com`. O operador deve escolher
uma página correspondente à versão informada e calcular o hash do conteúdo.
O hash comprova integridade; a associação semântica entre página e versão continua
sendo responsabilidade da configuração aprovada no branch base.

Redirects são rejeitados. Cada leitura tem deadline de dez segundos e limite de
64 mil bytes durante streaming. O contexto leva um excerto de até oito mil
caracteres por fonte, com URL, versão e hash. A seleção total de contexto
complementar é limitada a 24 mil bytes, omitindo entradas inteiras quando preciso.
Não há busca automática por `latest`, execução de código de documentação, RAG ou
alteração do egress do executor. Fonte indisponível, hash divergente e versão
não confirmada produzem limitações explícitas para a análise.

## Resultado e CI

O check começa `in_progress` e a decisão normal é uma review `APPROVE` ou
`REQUEST_CHANGES`; análises incompletas usam `COMMENT`. Erros terminais podem
produzir um aviso informativo separado. A recuperação de GitHub é persistida no
ledger e usa backoff; durante indisponibilidade externa não há garantia de
atualização instantânea da interface do PR.

Achados verificáveis são ancorados nas linhas RIGHT do patch. Falhas de evidência
não são rebaixadas silenciosamente para uma aprovação. O resumo inclui evidências
de testes e cobertura importadas dos artifacts disponíveis do GitHub Actions.
O Sandbox não instala dependências nem executa comandos de teste do projeto.
Resultados de workflows diferentes são identificados separadamente; uma nova
tentativa substitui apenas sua própria execução.

A migração do armazenamento de CI e a ausência de leitor legado estão descritas
na [ADR-0037](../decisions/0037-harden-parallel-review-and-publication.md). Nenhuma
operação de reset é automática.
