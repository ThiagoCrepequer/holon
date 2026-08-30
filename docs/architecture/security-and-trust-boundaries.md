---
id: ARCH-SECURITY-001
kind: architecture
status: current
owners:
  - core-team
last-reviewed: 2026-08-29
---

# Segurança e trust boundaries

Código, diffs, nomes de arquivos, comentários e instruções existentes no
repositório são entrada não confiável. Isso inclui texto que tente instruir o
modelo a ignorar políticas ou exfiltrar dados.

## Fronteiras

| Fronteira             | Risco principal                                   | Controle obrigatório                                                                    |
| --------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Internet -> Worker    | Webhook forjado, replay, payload excessivo        | HMAC do corpo bruto, comparação constante, allowlist de eventos e limite de tamanho     |
| Queue -> Coordinator  | Redelivery e evento obsoleto                      | Idempotência e validação de schema/version                                              |
| GitHub -> Analyzer    | Código malicioso, arquivo gigante, path traversal | Workspace isolado, limites e normalização de caminhos                                   |
| Analyzer -> comandos  | Execução arbitrária e exfiltração                 | Read-only por padrão, allowlist, timeout, CPU/memória/rede limitados                    |
| Evidência -> modelo   | Prompt injection e dados sensíveis                | Separar instruções de dados, minimizar contexto, redigir segredos e limitar ferramentas |
| Modelo -> ferramentas | Tool call destrutiva ou fora de escopo            | Schemas estritos, autorização no host e ferramentas mínimas                             |
| Modelo -> GitHub      | Finding inventado ou coordenada inválida          | Validação determinística e releitura do head SHA                                        |
| Holon -> provedores   | Retenção e exposição de código privado            | Contrato de dados, configuração de logs e política por organização                      |

## GitHub App

Princípio: solicitar somente permissões necessárias aos endpoints usados.

Conjunto mínimo exigido pelos endpoints implementados:

- Repository metadata: read.
- Pull requests: write, que cobre leitura, inline comments, reviews e releitura
  do head SHA.
- Contents: read, se o analisador usar Git ou Contents API.
- Webhook `pull_request` para eventos selecionados.

Não solicitar escrita em Contents no MVP. Tokens de instalação são emitidos sob
demanda, têm vida curta e não entram em fila, logs ou armazenamento persistente.

## Segredos

- Chave privada do GitHub App, webhook secret e credenciais de modelo ficam em
  Workers Secrets ou Secrets Store.
- Variáveis comuns não são segredos.
- KV não armazena credenciais.
- Logs nunca registram headers `Authorization`, chave privada, token de
  instalação ou corpo bruto contendo material sensível.

## Política de execução

O executor implementado não executa scripts do repositório:

- instalação de dependências e lifecycle scripts ficam desativados por padrão;
- rede pública inicia bloqueada; Git usa o host virtual interno
  `github.holon.internal`, e somente o caminho exato do repositório é reescrito
  para HTTPS em `github.com` e recebe credencial no outbound handler;
- redirects autenticados são manuais e qualquer acesso ao GitHub é substituído
  por um handler de bloqueio explícito assim que o fetch termina;
- comandos são registrados sem incluir segredos;
- filesystem é descartado ao final da run;
- fork bombs, processos em background e serviços expostos são proibidos;
- submódulos não são obtidos; filtros Git LFS são desativados no checkout.

Os únicos comandos construídos pelo host são `git`, `rg`, `ast-grep run` e
`realpath`, com argv tipado, diretório fixo, timeout e limites de saída. Não
existe ferramenta shell genérica. A imagem fixa as versões do Sandbox, ripgrep
e ast-grep; a base também é fixada por digest e o smoke local executa ambas as
ferramentas contra uma fixture TypeScript. `git diff` desativa ext-diff e
textconv.

Antes de `read_file`, o host resolve symlinks com `realpath` e rejeita qualquer
destino fora de `/workspace/repository`; paths lexicais seguros sozinhos não são
considerados isolamento suficiente.

## Prompt injection

Conteúdo do repositório é evidência, nunca instrução. O host, e não o modelo,
decide quais ferramentas existem, quais argumentos são permitidos e quais dados
podem sair da trust boundary. Texto encontrado em README, comentários ou código
não pode ampliar permissões.

Antes de prompt, resultado de ferramenta e saída publicável, o host redige
formatos conhecidos de credenciais. O prompt inicial é limitado a 500 kB, tool
calls a doze, leituras a 500 linhas/100 kB e coordenadas a 20.000. Redação
heurística reduz exposição acidental, mas não substitui a política de dados do
provedor nem garante detectar todo segredo possível.
