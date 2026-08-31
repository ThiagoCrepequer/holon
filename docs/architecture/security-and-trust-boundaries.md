---
id: ARCH-SECURITY-001
kind: architecture
status: current
owners:
  - core-team
last-reviewed: 2026-08-30
related:
  - ../decisions/0014-version-executor-rpc-and-broker-github-credentials.md
  - ../decisions/0016-require-complete-patches-and-host-verifiable-evidence.md
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
demanda e restritos ao repository ID. O credential broker autoriza run,
container, instalação e repositório no ledger; token não entra em fila, logs,
SQLite, filesystem ou parâmetros persistidos do Sandbox.

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
- o outbound handler recebe `containerId` da plataforma e busca credencial JIT
  no entrypoint RPC nomeado do control plane;
- comandos são registrados sem incluir segredos;
- filesystem é descartado ao final da run;
- inatividade coloca o container para dormir após 30 segundos; a próxima tool
  reconstrói o checkout canônico se o contexto efêmero tiver desaparecido;
- fork bombs, processos em background e serviços expostos são proibidos;
- submódulos não são obtidos; filtros Git LFS são desativados no checkout.

O diff canônico bruto, limitado a 2 MB, cruza o request do executor antes da
classificação. Ele permanece temporário, não vira checkpoint persistido e não é
enviado integralmente ao modelo. Antes de persistir contexto, a política separa
JS/TS estrutural de outros patches Git não binários elegíveis, inclusive
remoções, renames e metadata-only. Patches binários e caminhos reconhecidos como
lockfiles, código gerado, vendor, minificados, sourcemaps, build ou
potencialmente sensíveis são ignorados.

As exclusões por nome, extensão e diretório são heurísticas defensivas, não um
secret scanner nem garantia de detectar todo artefato. A mesma política é
aplicada às tools: `read_file` rejeita paths ignorados, buscas textuais filtram
roots e resultados e ast-grep opera apenas sobre paths estruturais. A
classificação textual não concede uma nova ferramenta nem amplia egress.

Os únicos comandos construídos pelo host são `git`, `rg`, `ast-grep run`,
`realpath` e `sed`, com argv tipado, diretório fixo, timeout e limites de saída.
Não existe ferramenta shell genérica. A imagem fixa as versões do Sandbox,
ripgrep e ast-grep; a base também é fixada por digest e o smoke local executa as
ferramentas de análise contra fixtures controladas. O diff não é calculado
dentro do checkout: vem do endpoint canônico do Pull Request e é validado antes
de entrar no Sandbox.

ast-grep recebe sempre `--config /opt/holon/sgconfig.yml`; configuração do
repositório não pode alterar regras, linguagem ou execução.

Antes de `read_file`, o host resolve symlinks com `realpath` e rejeita qualquer
destino fora de `/workspace/repository`; paths lexicais seguros sozinhos não são
considerados isolamento suficiente. Depois dessa autorização, o host constrói
uma chamada `sed` com uma página fixa e inclusiva. O arquivo não é materializado
inteiro na memória do Worker: o container devolve no máximo 500 linhas e 100 kB
por chamada, e sinaliza truncamento quando o limite de saída é atingido.

## Prompt injection

Conteúdo do repositório é evidência, nunca instrução. O host, e não o modelo,
decide quais ferramentas existem, quais argumentos e paths são permitidos e
quais dados podem sair da trust boundary. Texto encontrado em README,
comentários ou código não pode ampliar permissões. Um patch textual elegível
continua sendo conteúdo não confiável; "elegível" não significa seguro.

Antes de prompt, resultado de ferramenta e saída publicável, o host redige
formatos conhecidos de credenciais. O prompt inicial é limitado a 100 kB, o
diff persistido a 120 kB, tool calls a doze, leituras a 500 linhas/100 kB e
coordenadas a 5.000. Redação
heurística reduz exposição acidental, mas não substitui a política de dados do
provedor nem garante detectar todo segredo possível.

O host envia somente patches completos ao modelo e valida cada evidência contra
path, intervalo e linhas new-file do diff canônico. Evidência exclusiva de tool
orienta investigação, mas não é publicável até ter proveniência verificável. Na
publicação, texto com aparência de marcador é neutralizado e reconciliação exige
autor GitHub App exato no endpoint correspondente.

Requests ao AI Gateway enviam `cf-aig-collect-log-payload: false`; prompts,
diffs, tool outputs e respostas não ficam persistidos nos logs. Até cinco
metadados seguros correlacionam run, PR, repositório, etapa e versão do schema.
Para OpenRouter, a chamada exige endpoints que aceitem todos os parâmetros e
nega providers que coletem dados.
