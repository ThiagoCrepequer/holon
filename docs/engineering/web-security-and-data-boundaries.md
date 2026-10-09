---
id: ENGINEERING-WEB-SECURITY-DATA-BOUNDARIES
kind: reference
status: proposed
owners:
  - core-team
last-reviewed: 2026-10-08
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
[ADR-0054](../decisions/0054-establish-user-dashboard-foundations.md). M2 integra
sessão/OAuth e membership local. A conclusão da #137 acrescenta budgets técnicos
duráveis dos consumidores HTTP atuais; convites, grants de repositório e
Markdown/email ainda não estão integrados. Os budgets desses fluxos acompanham
as issues donas. As garantias futuras abaixo continuam condições de aceite,
sem alegar validação de produção.

Os contratos dashboard usam o modo público jitless do Zod, configurado antes
da construção de seus schemas. Assim, validação no browser não sonda eval nem
exige ampliar a CSP. A política permanece sem unsafe-inline/unsafe-eval; a
prova browser acompanha violações inclusive depois de trocar idioma/tema.

## Base HTTP implementada em M1

`apps/dashboard/app/server/http-security.server.ts` valida origem de configuração
(HTTPS, exceto loopback local), redirect relativo sem normalização ambígua,
POST JSON com synchronizer token ligado a uma sessão confiável, Origin exata e
Fetch Metadata complementar. O body é limitado a 16 KiB também pelo stream;
JSON/UTF-8 inválidos são negados. Dados ainda exigem o schema do comando dono.
`readCommand` não autentica por string nem emite token. M2 resolve a sessão
nativa antes do comando e deriva CSRF por HMAC-SHA-256 de `csrf:sessionId` com
o secret servidor. O cliente recebe esse valor em `X-CSRF-Token` e cookie
`holon_csrf` Secure/SameSite=Lax; o servidor compara com o valor derivado, sem
confiar no cookie enviado. Nova sessão/secret produz outro token.

O handler oferece liveness e devolve códigos/UUID para erros. A allowlist M2
admite POST de login/logout, revogação própria/global, preferências e
criação personal/team; mutações sem método/path autorizado são negadas.
Login/callback/logout usam a superfície nativa restrita e origens exatas.
Login também nega Fetch Metadata contraditória; logout exige JSON estrito e
CSRF derivado da sessão antes de chamar a revogação nativa.
Comandos Holon de tenancy exigem sessão admitida, CSRF e schemas strict.
O body do login anônimo também é limitado a 16 KiB antes de criar state OAuth. Headers preservam Set-Cookie,
CSP por nonce sem unsafe-inline/eval, nosniff, no-referrer e private/no-store.
`public/_headers` permite cache imutável somente aos assets com hash. O renderer
usa logging com code/requestId e a rota wildcard produz 404 localizado, sem
serializar a exceção padrão do framework com o caminho solicitado.

Node e Workerd exercitam corpo sem length confiável, redirects hostis, métodos,
origens, tokens, múltiplos cookies e erros arbitrários. Browser usa o bundle real
para provar SSR/CSP/hidratação/404 e nega GET/POST nos comandos inexistentes.
A [evidência M2](../research/2026-10-07-dashboard-identity-tenancy-results.md)
acrescenta biblioteca nativa, D1 e composição HTTP de identidade/tenancy. Isso
não comprova segurança dos futuros endpoints de convites, Markdown/email
ou os demais consumidores ainda inexistentes. A #141 acrescenta provas nativas
de sessões/dispositivos; cada owner integra seus gates na mesma issue.
A [revisão final M1](../research/2026-10-07-dashboard-milestone-one-final-review.md)
rastreia a separação autorizada: #148/#149, #152, #157/#158, #159 e #161; #163
integra as jornadas antes da promoção.

## Budgets técnicos dos consumidores atuais

| Consumidor                              | Chave confiável                                              | Janela / máximo |
| --------------------------------------- | ------------------------------------------------------------ | --------------- |
| Login GitHub nativo                     | IP fornecido por Cloudflare                                  | 60 s / 10       |
| Logout nativo                           | IP fornecido por Cloudflare                                  | 60 s / 30       |
| Demais paths nativos admitidos          | IP fornecido por Cloudflare                                  | 10 s / 100      |
| Leitura de sessão ou workspaces         | IP fornecido por Cloudflare, por superfície                  | 60 s / 120      |
| Leitura de dispositivos/perfil          | IP fornecido por Cloudflare, por superfície                  | 60 s / 120      |
| Revogação própria/global ou preferência | Ator da sessão admitida, no budget compartilhado de mutações | 60 s / 30       |
| Mutação de tenancy                      | Ator da sessão admitida, compartilhado entre comandos        | 60 s / 30       |

O IP usa somente `cf-connecting-ip`, que o ingress Cloudflare controla; X-Forwarded-For
não é autoridade. Sem esse header, consumidores anônimos compartilham um bucket.
Namespaces, atores e ações são convertidos em chaves SHA-256, sem IP/identidade
em claro. O contador usa uma única operação SQL condicional com `RETURNING`;
recriar services/isolate não reinicia budget. Cada consumo expurga no máximo
10 chaves vencidas há pelo menos uma hora e duas janelas; o helper operacional
expurga no máximo 100 por chamada. Nenhum expurgo remove budget ativo.

O loader raiz SSR compartilha os mesmos buckets das leituras HTTP de sessão e
perfil. Consome o budget de sessão antes de resolver identidade e o de perfil
antes de ler preferências admitidas; path de página ou request de revalidação
não cria outro bucket nem permite contornar a proteção por meio do documento.

A mutação consome budget depois de validar sessão, origem, CSRF e schema. Falha
ou resposta ambígua do storage fecha a operação. Esses valores são proteção
técnica local, não quotas comerciais nem budgets dos futuros convites/conteúdo.
O caminho público de sessão recebe limite explícito porque `auth.api.getSession`
não passa pelo rate limiter HTTP do SDK. As regras nativas usam os paths sem
`/api/auth`, conforme a normalização da versão 1.7.7 fixada.

## Admissão atômica da sessão exata

Mutações D1 recebem `AdmittedUser` resolvido no servidor, incluindo session ID e
subject GitHub; strings ou campos enviados pelo browser não substituem esse
contexto. O primeiro statement da batch registra um marcador único com a
decisão sobre **essa sessão** e Account, usando o relógio SQLite na execução.
Os inserts de workspace, membership e receipt usam a mesma decisão; o último
statement remove o marcador. Rollback também remove o marcador. Uma sessão
válida de outro dispositivo não autoriza o comando da sessão revogada/expirada.

`unixepoch('subsec')` fornece milissegundos para comparar com `expiresAt`. O
valor de `now` é estável dentro de um `sqlite3_step`, não pressuposto para toda
uma batch: por isso a decisão é capturada uma vez no marcador transacional.
Fontes verificadas em 2026-10-07: [SQLite — funções de data](https://www.sqlite.org/lang_datefunc.html),
[D1 — batch transacional](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
e [Better Auth — rate limit](https://better-auth.com/docs/concepts/rate-limit).

## Taxonomia HTTP e recuperação dos consumidores atuais

| Condição                                                    | Resposta                           | Recuperação                                                                            |
| ----------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| Falha de autorização/CSRF/origem                            | `denied`                           | Corrigir intenção/autoridade; não executar efeito                                      |
| Sessão nativa sem identidade GitHub vinculada               | 401 `reconnect_required`           | Novo OAuth, sem admitir sessão órfã                                                    |
| Mesma operation ID, ator ou payload incompatível            | 409 `invalid_request`              | Não reutilizar ID para outra intenção                                                  |
| Storage/configuração indisponível antes de confirmar efeito | 503 `unavailable`                  | Repetir depois da recuperação, com intenção preservada                                 |
| Comando iniciado sem confirmação recuperável                | 503 `command_unknown`              | Consultar/repetir a mesma operation ID; nunca afirmar sucesso nem criar outra intenção |
| Budget técnico esgotado                                     | 429 `rate_limited` + `Retry-After` | Esperar a janela limitada; autorização e CSRF continuam obrigatórios                   |

Erros carregam código previsto e UUID operacional; não mensagem arbitrária de
persistência/provider. Cabeçalhos de segurança e todos os cookies de renovação
acompanham também negações. A colisão idempotente não é indisponibilidade; uma
falha na confirmação após commit não é prova de rollback. Tenancy reconcilia a
mesma intenção durável e verifica a autorização atual antes de devolvê-la.

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
host-only**, com `SameSite=Lax` configurado para o retorno OAuth. Não há necessidade
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

### Dispositivos, perfil e fronteira SSR em M2

A lista de dispositivos valida `sessionDeviceListDtoSchema` antes de responder.
Cada resposta contém no máximo 100 dispositivos, com cursor opaco de sessão própria;
o envelope informa a sessão atual independentemente de ela estar na página e
o próximo cursor. A UI solicita uma página por interação, sem agregar uma lista
ilimitada no browser. Respostas de logout e revogação também têm schemas strict
compartilhados entre produtor e cliente; um HTTP 200 com corpo inválido não
confirma o efeito.
Expõe apenas ID público, datas, sessão atual e categoria de navegador; token,
IP e user agent bruto não entram no DTO. IDs de revogação são validados e
fixados ao User da sessão admitida. Todos os cookies nativos são preservados
em respostas permitidas e negadas; limpar cookies usa a API oficial de sign-out.
Revogação concorrente entre admissão HTTP e execução SQL nega o efeito.

Preferências usam schemas strict de entrada e saída e respostas `{ preferences }`.
Locale/fuso não autorizam acesso nem alteram configuração da equipe. A escrita
SQL fixa User/Account/Session na própria condição do UPSERT; nenhuma sessão
válida de outro dispositivo substitui a que iniciou o comando. Corpo com User
ID ou propriedades extras é negado antes do efeito. Storage indisponível,
perfil corrompido e confirmação perdida não se apresentam como save concluído.

O loader raiz recebe capabilities privadas por request e devolve snapshot
público reduzido. Falha de persistência não vira perfil ausente.

Falhas na resolução do viewer são Responses sanitizadas para o React Router,
com status e cookies da admissão preservados mesmo quando o perfil falha ou seu
budget nega a leitura. No logout atual, cookies de renovação precedem os clears
nativos: uma renovação obtida na admissão não restaura o cookie após o logout.

O bundle real nega auth/DB/secrets no cliente. A UI fecha o snapshot privado após
negação confirmada e compara a geração da sessão antes de atender callbacks antigos;
requests de uma sessão anterior não retiram nem repovoam uma sessão nova.

### Governança e reautenticação por intenção

`/api/auth/reauth/init` usa a mesma fronteira de mutação admitida: Origin,
CSRF, JSON strict e budget antes do INSERT condicionado. A intenção fixa
User, subject GitHub, sessão original, equipe, ação e alvo. Somente a sessão
original ainda válida pode iniciar OAuth com essa intenção; anônimo, outro
User ou outro dispositivo não obtêm autoridade conhecendo seu ID.

As ações são promoção, rebaixamento, remoção e saída. Pending TTL é 10 minutos;
proof TTL é 5 minutos desde callback bem-sucedido. Subject real é verificado
antes de linking por email; o slot OAuth de servidor guarda contexto confiável.
`additionalData` arbitrário do cliente continua negado. Confirmação exige User
real e sessão nova do callback, diferentes da sessão original ainda válida.
Falha, replay ou confirmação negada não se apresentam como reauth concluída.

A batch revalida sessão exata, Account, membership/papel atual, equipe, alvo,
ação e proof TTL pelo relógio SQLite antes de consumir e aplicar o efeito.
Owner não ganha autoridade em outra equipe; promoção não cria participante;
personal workspace é negado. Triggers fazem rollback de saída, remoção ou
rebaixamento do último owner, preservando a prova não consumida. Uma resposta
perdida depois do commit, inclusive com leitura de reconciliação indisponível,
é resultado desconhecido sanitizado; não permite reconstruir participação
histórica por replay. Membership removida perde acesso na próxima request.

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
code, verifier ou exceção arbitrária. M2 integra o plugin à única superfície permitida de callback em `packages/auth`,
com a tabela de identidade e limpeza limitada na reserva. A capacidade de
manutenção explícita do package também limpa após ociosidade; não há scheduler
remoto provisionado. A prova não cria recursos/bindings produtivos.

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

A implementação M3 coerente com Q28/Q32 usa um **ID aleatório opaco de convite**, não
bearer token que concede membership. GET mostra login genérico sem revelar
destinatário/equipe/membros até confirmação do alvo. Aceite é POST protegido;
exige a identidade GitHub vinculada e confirmação atual do email destinatário
verificado no provider, além de convite vigente/workspace correto. Não exigir
email primário se outro endereço estiver verificado; não deduzir equivalência
por pontos, plus-addressing ou domínio. Email não funde usuários.

Evidência do provider pertence à request: account ID, geração da credencial e
lista atual de emails verificados. O batch usa essa identidade/geração e o
mesmo convite/estado esperado.
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
obtém contexto mínimo por RPC, e Q37 repete a mesma intenção vigente. M3
prova enumeração genérica, replay, troca de email, alvo errado e scanners em
HTTP/Workerd/browser; a entrega efetiva continua em M4.

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

## Gates M3 implementados em 2026-10-08

Sessão/membership/account são autoridade D1 atual, sem cache cookie para ACL.
Grants positivos/negativos vencem em até 60 s do início da consulta, com todas
as páginas externas antes da paginação interna e invalidação por gerações/eventos.
Captura tardia de grant não passa a guarda final após revogação. Falha, dados
externos inválidos, paginação incompleta e refresh incerto fecham o acesso.

POST de convite exige owner de equipe, email até 254 caracteres, body HTTP
limitado e budgets atômicos por ator/equipe e equipe; negação não deixa intenção
órfã. GET/HEAD de convite não consulta existência nem muda estado. O destinatário
é visível apenas na gestão pelo owner, não em links, aceitações ou erros. Os
[resultados M3](../research/2026-10-08-dashboard-milestone-three-results.md)
ligam cada invariante aos seus testes. SSR de conteúdo privado e Markdown
continuam gates M5/M6, sem inferir implementação a partir dessa porta.
