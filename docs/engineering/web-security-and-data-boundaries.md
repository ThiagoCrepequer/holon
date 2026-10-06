---
id: ENGINEERING-WEB-SECURITY-DATA-BOUNDARIES
kind: reference
status: proposed
owners:
  - core-team
last-reviewed: 2026-10-06
related:
  - frontend-application-structure.md
  - dashboard-identity-and-workspaces.md
  - testing-and-evidence.md
  - ../research/2026-10-04-dashboard-auth-persistence-investigation.md
---

# Segurança web e fronteiras de dados do dashboard

## Alcance

Quais invariantes devem proteger HTTP, sessão, comandos, conteúdo externo e
dados privados na primeira implementação do dashboard?

Este guia complementa Q1–Q37 e as [fronteiras atuais](../architecture/security-and-trust-boundaries.md).
As fundações HTTP locais estão implementadas pela
[ADR-0053](../decisions/0053-establish-user-dashboard-foundations.md); sessão,
permissões, convites, Markdown/email e rate limits dos respectivos fluxos ainda
não estão integrados. As garantias futuras abaixo continuam condições de aceite,
sem alegar validação de produção.

## Base HTTP implementada em M1

`apps/dashboard/app/server/http-security.server.ts` valida origem de configuração
(HTTPS, exceto loopback local), redirect relativo sem normalização ambígua,
POST JSON com synchronizer token ligado a uma sessão confiável, Origin exata e
Fetch Metadata complementar. O body é limitado a 16 KiB também pelo stream;
JSON/UTF-8 inválidos são negados. Dados ainda exigem o schema do comando dono.
`readCommand` não autentica por string nem emite token: M2 possui sessão,
emissão/rotação CSRF e ligação com o cookie verificado.

O handler atual só aceita GET/HEAD, oferece liveness e devolve códigos/UUID para
erros; não há comandos reais para contornar CSRF. Headers preservam Set-Cookie,
CSP por nonce sem unsafe-inline/eval, nosniff, no-referrer e private/no-store.
`public/_headers` permite cache imutável somente aos assets com hash. O renderer
usa logging com code/requestId e a rota wildcard produz 404 localizado, sem
serializar a exceção padrão do framework com o caminho solicitado.

Node e Workerd exercitam corpo sem length confiável, redirects hostis, métodos,
origens, tokens, múltiplos cookies e erros arbitrários. Browser usa o bundle real
para provar SSR/CSP/hidratação/404 e nega GET/POST nos comandos inexistentes.
Isso não comprova segurança dos futuros endpoints de convites, Markdown/email,
rate limiting, sessões ou tenancy. Cada owner integra seus gates na mesma issue.

## Autoridade e isolamento

Toda leitura privada verifica sessão atual, membership do workspace explícito,
conexão/instalação ativa e grant humano ao repo. Comandos verificam também papel
e intenção. Autorizar antes de consulta, contagem e DTO; filtrar depois de `LIMIT`
vaza existência e produz paginação incorreta. Slug, URL, query key e origem
mesma não substituem autorização. A API e o SSR chamam a mesma política.

Leituras locais usam a fonte primária de identidade no próximo request. Grants
GitHub observam Q30, até 60 s, com cache por identidade GitHub/instalação/repo,
proveniência e expiração; uma observação negativa ou invalidação não é substituída
por sucesso antigo. Confirmação indisponível após expiração fecha a apresentação
privada, com erro recuperável. Não transformar falha do provider em permissão,
lista vazia ou logout global desnecessário.

Comandos usam autoridade **na mutação condicional**, não só em preflight. O batch
deve condicionar todos os efeitos ao mesmo ator, workspace, estado e operação.
Zero rows numa guarda não causa rollback D1 por si: statements dependentes não
podem criar convite, membership ou outbox se a guarda falhou. Resultado já
confirmado pode ser devolvido idempotentemente sem repetir efeitos. Estado
esperado/operation ID não permite ignorar autorização atual.

RPC privado expõe capacidades específicas de leitura/entrega, sem DO/SQL
genérico ou `env` completo. O caller autorizado e o conteúdo validado são
necessários; um ID do browser não prova repo/workspace. O executor/Sandbox não
recebe sessão humana, OAuth token, email ou acesso ao D1 de identidade.

## Sessão e superfície pública de auth

Cookie de sessão é uma credencial opaca do navegador, **HttpOnly, Secure e
host-only**, com `SameSite=Lax` candidato para o retorno OAuth. Não há necessidade
demonstrada de cookie compartilhado entre subdomínios. Provar callback real,
expiração/renovação, logout atual/todos e concorrência entre requests. `baseURL`,
origens confiáveis e redirect URIs são exatos por ambiente; produção não confia
em wildcard de preview ou localhost.

OAuth access/refresh tokens e token secreto de sessão não entram em JavaScript,
JSON de cliente, HTML desidratado, logs ou RPC de leitura. A sessão HttpOnly
necessariamente chega ao browser via cookie; isso é distinto de expô-la no JSON.
Criptografia nativa dos tokens OAuth deve ser habilitada na versão aprovada;
não criar criptografia própria nem considerar cookies todos criptografados.

A [fonte Better Auth pesquisada](../research/2026-10-04-dashboard-auth-persistence-investigation.md)
inclui token de sessão no output nativo de sessão/listagem e endpoints de tokens
OAuth. Portanto não montar o handler inteiro publicamente nem usar o client SDK
para ler essas respostas. Expor somente **método + caminho** indispensáveis ao
fluxo escolhido; negar caminhos novos/desconhecidos. Métodos internos da biblioteca
ficam no adapter servidor. Sessão/dispositivos/gestão têm DTOs Holon reduzidos,
com identificador público separado do segredo de sessão. Testar JSON, redirects,
headers e paths alternativos; renovar preservando todos os `Set-Cookie`.

Não alterar o payload nativo por regex ou monkey patch. O adapter traduz a
capacidade para um contrato explícito e restrito. Logging nativo também precisa
de integração sanitizada: codes/IDs operacionais, sem exceção arbitrária, cookies,
headers de autorização ou resposta de provider. CI usa credenciais sintéticas.

## Reserva durável de authorization code

A composição local aprovada de M0 usa um
[plugin público Better Auth](../research/2026-10-05-dashboard-code-redemption-plugin.md)
na validação do code GitHub nativo, depois de state/cookie/prazo e antes da troca
por token. Uma chave D1 por GitHub.com, client ID e digest do code dá um vencedor
entre instâncias/requests, inclusive com novo state. Persistir apenas digest e
expiração; falha/resultado ambíguo nega egress. Nunca liberar reserva por timeout,
resposta perdida ou falha de Account/Session: recuperar por novo OAuth.

Não substituir PKCE, integridade de state, rate-limit ou superfície pública
restrita por essa reserva. O cliente não repete credencial válida; retenção
cobre sua validade externa qualificada, com limpeza indexada limitada e
manutenção após ociosidade. Expiração de marcador não é lease de retry.
Restaurar um banco sem reservas vivas exige bloquear callbacks/inutilizar os
fluxos pendentes durante a validade externa antes de retomar. Não registrar
code, verifier ou exceção arbitrária. A prova não cria tabela/binding/scheduler
produtivos: integrar e retestar na entrega `packages/auth`/API.

## CSRF, origens, redirects e reautenticação

- GET/HEAD não aceitam convite, saem de workspace, revogam sessão ou alteram
  conexões. Link recebido e scanner de email não produzem efeitos.
- Comandos cookie-authenticated têm proteção CSRF explícita e testada: token
  vinculado à sessão e origem exata, com validação de método/content type e
  política de Fetch Metadata como defesa adicional. `SameSite` e CORS sozinhos
  não são a garantia. Proteções nativas Better Auth não cobrem handlers Hono próprios.
- Não habilitar CORS credenciado amplo. SSR/API na mesma origem não precisam de
  acesso cross-origin. Callback OAuth tem seu próprio protocolo state/PKCE;
  não aceitar exceção genérica de CSRF em `/api/*`.
- Login inicial anônimo vincula o fluxo ao browser/state/PKCE, prazo e destino
  permitido, antes de existir User/workspace. Reauth e conexão também vinculam
  o User/account/workspace e a operação existentes. State/code consumidos são
  rejeitados; recuperação de cadastro interrompido inicia novo fluxo OAuth.
  Não confiar em `installation_id`, return URL, Host ou forwarded
  headers informados pelo cliente. Revalidar Q31 e unicidade no comando final.
- Redirect pós-login admite destino relativo validado/origem configurada.
  Rejeitar URLs externas, scheme-relative e normalizações ambíguas; não devolver
  token em query string. Erros não revelam email/membros/repositórios privados.
- Gestão sensível, como promover owner ou vincular instalação, exige comprovação
  recente do mesmo User/intent na integração definida. Renovação móvel e refresh
  GitHub não são reauth. Não prometer senha/MFA por parâmetro não suportado.
  Ações e janela de reauth devem estar explícitas e testadas antes de expô-las.

A [avaliação OAuth de 2026-10-05](../research/2026-10-05-dashboard-oauth-security-requirements.md)
separa CSRF de não reutilização de code: PKCE válido permite não exigir consumo
atômico de state como mecanismo único, preservando vínculo e integridade do
contexto. Callbacks concorrentes não podem fazer o cliente submeter o mesmo
code duas vezes. Essa condição ainda falha no candidato 1.7.7; não considerar
uma única sessão no fake como dispensa. As premissas externas e a ausência de
prova remota estão no relatório.

## Convites sem credencial de ingresso na URL

A proposta coerente com Q28/Q32 é um **ID aleatório opaco de convite**, não
bearer token que concede membership. GET mostra login genérico sem revelar
destinatário/equipe/membros até confirmação do alvo. Aceite é POST protegido;
exige a identidade GitHub vinculada e confirmação atual do email destinatário
verificado no provider, além de convite vigente/workspace correto. Não exigir
email primário se outro endereço estiver verificado; não deduzir equivalência
por pontos, plus-addressing ou domínio. Email não funde usuários.

Evidência do provider pertence à request: account ID, email verificado e
`checkedAt`. O batch usa essa identidade e o mesmo convite/estado esperado.
Isso evita usar `User.emailVerified` antigo como prova atual. A consulta externa
não pode ser atômica com mudança posterior no GitHub; não prometer linearização
entre provider e D1. Falha de confirmação deixa aceite negado e recuperável.

Primeiro aceite fixa `acceptedByUserId`; repetição pelo mesmo User retorna o
resultado confirmado, outro User é negado. Cancelamento/expiração bloqueiam novo
aceite; convite não promove owner nem cria grant GitHub. O ID continua sem
autoridade mesmo após vazar: sessão, alvo e estado são obrigatórios.
Resultado histórico de aceite não é autorização atual: reapresentar o convite
não recria membership posteriormente removida nem reativa acesso.

Esse desenho evita armazenar um token bruto recuperável para retries de email
ou inventar assinatura/criptografia de links. Queue leva referência, sender
obtém contexto mínimo por RPC, e Q37 repete a mesma intenção vigente. Ainda
exige testes de enumeração, replay, troca de email, alvo errado e scanners.

## Conteúdo externo, HTML e headers

Título/autor GitHub, paths, código, findings e texto do modelo são não confiáveis
também no dashboard. Renderizar texto escapado; Markdown sem HTML bruto, com
allowlist de protocolos/URLs. Não executar scripts, imagens remotas de tracking,
iframes ou instruções de conteúdo. Links GitHub são montados/validados a partir
da origem permitida e identidade, não de URL arbitrária do payload.

Estado desidratado usa serialização segura do framework, sem script construído
com `JSON.stringify`. Testar `</script>`, SVG/event handlers, URLs `javascript:`
e textos hostis em SSR/hidratação, Markdown, toast e templates de email. Highlight
é delimitado por tamanho/linguagem e não usa código de PR como configuração.

Headers candidatos para produção: CSP com nonce por resposta para scripts SSR,
`object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, destinos de
form/connect restritos; `X-Content-Type-Options: nosniff`, `Referrer-Policy:
no-referrer` em fluxos sensíveis e HTTPS. Assets com hash podem ser cacheados;
HTML/JSON privados e respostas de auth usam `Cache-Control: private, no-store`.
Não usar Cache API, CDN, service worker ou storage persistente do browser para
esses datasets no MVP. Não habilitar `unsafe-inline`/`unsafe-eval` para contornar
integração de UI; provar nonce e eventuais estilos dinâmicos na pilha escolhida.

## Abuso, limites e evidência

Cadastro aberto não autoriza envios/queries ilimitados. Limitar tamanho do body,
filtros/cursor/página, concorrência, prazo, tentativas e custo de comandos por
ator/workspace, especialmente convites. Parâmetros ficam numa política do dono,
validada com carga/quotas antes de publicação. Limite de borda não substitui
autorização nem orçamento durável de efeitos. Não adicionar CAPTCHA/serviço novo
sem necessidade demonstrada ou introduzir quota comercial por conveniência.

Cada invariante acompanha testes permitido/negado, corrida/replay e falha
relevante. Cobertura numérica e scanner não substituem provas de segredo no
JSON, CSRF, XSS/hidratação e isolamento entre requests. O
[plano de implementação](../planning/dashboard-implementation-plan.md) define
gates e a [política de testes](testing-and-evidence.md) define as fronteiras.

Fontes primárias verificadas em **2026-10-04**: [OWASP sessão](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
[CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
e [headers React Router](https://reactrouter.com/how-to/headers).
As escolhas específicas de superfície, convites e cache são propostas Holon
derivadas das políticas acordadas, não recomendações copiadas como implementação.
