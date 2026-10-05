---
id: RESEARCH-2026-10-04-DASHBOARD-AUTH
kind: research
status: current
date: 2026-10-04
verified-at: 2026-10-04
owners:
  - core-team
related:
  - 2026-10-04-dashboard-library-landscape.md
  - ../engineering/frontend-application-structure.md
---

# Autenticação do dashboard: direção e decisões pendentes

## Direção confirmada e limite da etapa

**Leitura atual:** [Q35/Q36 e resultado das investigações](#atualização-q35q36-e-composição-investigada--2026-10-04),
[composição Better Auth/Drizzle/D1](2026-10-04-dashboard-auth-persistence-investigation.md)
e [Cloudflare Email Sending](#cloudflare-email-sending-condições-e-discrepância--2026-10-04).
As seções anteriores preservam a descoberta por rodada; pendências resolvidas
nas atualizações seguintes não devem ser tratadas como abertas.

Q1–Q37 estão encerradas no registro; a [revisão de robustez](2026-10-04-dashboard-plan-robustness-review.md)
e o [plano executável por etapas](../planning/dashboard-implementation-plan.md)
são a leitura atual para engenharia. Papéis/convites/topologia/frescor já foram
acordados; apenas suporte físico, contratos e provas continuam pendentes.

Em 2026-10-04, o responsável concordou em usar **Better Auth + Drizzle + D1**
para a autenticação do dashboard dos usuários do Holon. Solicitou aprofundar e
debater seus detalhes **antes de implementar autenticação**.

A rodada 3 confirmou **GitHub como primeiro provider, uso individual e
organizações explícitas do Holon para equipes**. Login, instalação da GitHub App
e grants de repositório têm autoridades distintas. Naquela rodada, papéis e
governança ainda não tinham resposta; Q25–Q34 os confirmaram depois. Tabelas,
cookies e endpoints continuam sujeitos ao desenho/prova, não defaults do plugin.
Q22–Q24 confirmaram interseção privada, cadastro aberto e sessão móvel
de 7 dias/renovação após 24 h, múltiplos dispositivos e logout atual/todos.
Nesta etapa não criar packages auth/db, configuração Better Auth, schema gerado,
migrations, banco/bindings, secrets ou deploy. O levantamento não é um ADR
aceito nem prova operacional da composição.

A [ADR-0040](../decisions/0040-retire-admin-and-analytical-storage.md) retirou o
admin/read model anterior e permite D1 para necessidade funcional futura. Um
banco de identidade/sessão não restaura telemetria/read model nem substitui o
ledger por PR. A rodada 2 selecionou índice funcional D1 para lista e detalhe
autoritativo no ledger; banco compartilhado/separado com auth segue pendente.

## Evidência atual e composição a verificar

Better Auth documenta um adapter Drizzle com provider SQLite; Drizzle documenta
o driver D1 para Workers. Em 2026-10-04, a página Better Auth mostra o pacote
`@better-auth/drizzle-adapter`, enquanto a página Drizzle de D1 usa exemplos
`@rc`. Fixar e conferir versões compatíveis de core, adapter, ORM, kit e plugins
antes de copiar exemplos ou gerar schema. Não misturar exemplos de releases
diferentes nem recomendar `latest`/RC como versão do Holon sem validação.
[Better Auth/Drizzle](https://better-auth.com/docs/adapters/drizzle),
[Drizzle/D1](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1).

Essas fontes provam integrações documentadas, não o login ponta a ponta no
runtime do Holon. A prova posterior deverá exercitar criação/revogação de sessão,
persistência, constraints, falhas e concorrência no D1/Workerd da combinação
selecionada. Não presumir semântica de PostgreSQL ou transações genéricas em D1;
examinar necessidades e APIs reais antes de escolher operações/plugins.
[Limites oficiais do D1](https://developers.cloudflare.com/d1/platform/limits/).

## Perguntas para o debate

**Registro histórico anterior a Q25–Q34.** As perguntas de produto abaixo foram
resolvidas nas atualizações; não usá-las como pendências nem pedir novamente ao
responsável. Para o estado técnico atual, usar o plano e a revisão vinculados acima.

| Tema                  | Decisão necessária                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade/login      | GitHub confirmado; escolher modalidade OAuth App/GitHub App após política de acesso. Cadastro aberto confirmado; recuperação e mecanismos de revogação continuam pendentes |
| Identidades distintas | Login humano, identidade GitHub, instalação da GitHub App e autorização de repositório têm funções distintas; como relacionar e revogar cada vínculo?                      |
| Conta e organização   | Individual + organizações Holon confirmados; como criar/entrar/sair de organização? Quem convida/remove membros e transfere propriedade?                                   |
| Acesso a repositórios | Interseção privada confirmada; como validar grants atuais, instalação removida e mudança de acesso? Não inferir grants por membership ou cargo                             |
| Sessão                | 7 dias móveis/renovação após 24 h, múltiplas sessões e logout atual/todos confirmados; cache/janela de revogação e reauth pendentes                                        |
| Cookies e origem      | Domínios, ambiente local/preview/produção, cookies, CSRF, origens confiáveis e SSR/API sob sessão consistente                                                              |
| Vinculação de contas  | Como tratar email igual, conta GitHub desvinculada, takeover, conta removida e recuperação sem ampliar privilégios?                                                        |
| Plugins               | Quais necessidades justificam organization, RBAC, MFA ou outros plugins? Nada ativado só por estar disponível                                                              |
| Persistência          | Schema e constraints, titularidade das migrations, retenção/remoção, índices e se auth/dados de produto compartilham banco; quotas e concorrência esperadas                |
| Auditoria e abuso     | Quais eventos são necessários sem payloads/segredos? Como lidar com tentativas abusivas, callbacks repetidos e falhas do provider?                                         |
| UX                    | Login, convite, organização sem instalação, sessão expirada, acesso revogado e usuário sem permissão precisam de estados claros                                            |

## Rodada atual e autoridades separadas

A [entrevista de engenharia](../planning/dashboard-engineering-decision-review.md#workspace-avaliação-crítica-e-rodada-5)
registra Q19–Q24 acordadas: idioma/fuso/busca, interseção privada, admissão e
sessão. O [modelo de workspaces](../engineering/dashboard-identity-and-workspaces.md)
separa pessoa, login, contexto e membership. Essa seção registra o momento
anterior à quinta rodada; as respostas abaixo confirmaram Q25–Q30.
Somente leitura de reviews não impede a manutenção necessária de sessão;
auth/onboarding não estão implementados nem têm endpoints aprovados.

O client GitHub atual possui `repositoryPermission`, usado no fluxo de threads,
sem ACL humana/dashboard. Pode apoiar uma implementação futura; não prova
por si só membership Holon ou grant de qualquer usuário que fornece um login.
Alternativa é token de usuário GitHub App, limitado à interseção App/usuário.
[GitHub: token em nome do usuário](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user),
conferido em 2026-10-04. Não solicitar scope OAuth amplo `repo` apenas para login.

Q24 confirmou prazo móvel de 7 dias e renovação durante uso após 24 h,
sem limite absoluto adicional inicialmente. Não confundir expiração móvel, limite
absoluto ou validade do token GitHub. Cookie cache introduz janela de aceitação
após revogação em outros dispositivos; sua adoção aguarda política de revogação.
[Better Auth: sessão](https://better-auth.com/docs/concepts/session-management),
conferido em 2026-10-04. Prova posterior deve cobrir renovação/cookies no SSR,
logout, revogação e falhas sem confundir sessão válida com grant privado válido.

## Fronteiras propostas para a implementação posterior

`auth` concentra Better Auth e traduz identidade/sessão para tipos do Holon.
`db` concentra Drizzle/D1 e schema físico; não importa `auth`. A composição
servidor injeta persistência em auth e capacidades autorizadas na aplicação.
Artefatos de schema auth podem ser gerados a partir da configuração, mas sua
incorporação à persistência deve ser revisada, sem criar ciclo de imports.

Autenticação estabelece quem é o usuário; autorização de organização/repositório
é política de produto compartilhada pelos loaders e API. Hooks/client auth não
acessam ORM ou secrets; entries browser/server têm exports separados. A escolha
tecnológica não permite retornar um objeto Better Auth completo ao navegador.

A [referência de organização](../engineering/frontend-application-structure.md)
detalha os limites. Após o debate, registrar o modelo aprovado e preparar uma
prova focada antes de adotar migrations, bindings e configuração de produção.

## Atualização após Q25–Q30 — 2026-10-04

O responsável confirmou usuário estável e workspace pessoal/equipe no mesmo
modelo, com organização como sinônimo, memberships N:M e papéis por workspace.
Qualquer usuário admitido cria equipe e vira owner; owner/member bastam, convite
é explícito para identidade autenticada alvo. Workspace admite várias instalações,
cada instalação vinculada a um único workspace inicialmente. Nenhuma integração
ou contrato de gestão foi implementado por essas respostas.

Q30 resolveu a pendência de cache/revogação: sessão e membership locais na
próxima request, sem cookie cache de sessão; grant GitHub em cache por até 60 s,
invalidado antes por eventos recebidos. Sem confirmação de grant expirado,
leitura é negada e indisponibilidade tem estado próprio. Não existe promessa
de apagar conteúdo já entregue a browser parado, nem renovação de sessão
usada para atualizar datasets automaticamente.

O [modelo acordado](../engineering/dashboard-identity-and-workspaces.md) e a
[entrevista](../planning/dashboard-engineering-decision-review.md) são a leitura
atual. Restam identificação/entrega de convites, quantidade/lifecycle de owners,
prova de autoridade para vínculo GitHub e inclusão do onboarding na primeira
entrega. Adapter/schema/D1, cookies/origens/CSRF, reauth por ação e migrations
são desenho e prova técnica posteriores, sem pedir ao usuário que escolha
cada detalhe de implementação. Não ativar serviço de email, Teams, MFA ou SSO
corporativo apenas por disponibilidade do plugin.

### Evidência de conexão e convites para Q31–Q34

Verificada em **2026-10-04**. O GitHub distingue
[setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
de callback de autorização e alerta sobre falsificação de `installation_id`.
[Listar instalações acessíveis](https://docs.github.com/en/rest/apps/installations#list-app-installations-accessible-to-the-user-access-token)
aceita acesso de leitura a repo; isso não autoriza apropriar o vínculo exclusivo.
A recomendação de exigir titular pessoal/owner GitHub para vínculo integral é
política proposta, mais restrita que quem pode instalar a App no GitHub.

A [listagem paginada de memberships próprias](https://docs.github.com/en/rest/orgs/members#list-organization-memberships-for-the-authenticated-user)
documenta token de usuário GitHub App sem permissões adicionais; consultas
pontuais têm requisitos distintos. É candidata para prova futura de owner
ativo por IDs, não integração autenticada já validada nem motivo para solicitar
scope amplo. O client atual não faz essa verificação de gestão.

[Organization Better Auth](https://better-auth.com/docs/plugins/organization)
usa destinatário email, exige email correspondente na sessão de aceitação e
callback de envio. Verificação estrita de email do convite é recomendada para
o Holon; prover email verificado via login/adaptação e UX de divergência precisam
de prova. Alvo por GitHub ID com link exige contrato/adaptação próprios, sem
promessa de funcionar no plugin como está. Identificação/canal, múltiplos owners
e self-service continuam aguardando respostas, registrados em Q31–Q34.

## Atualização final: Q31–Q34 — 2026-10-04

Todas foram confirmadas. Para vincular a instalação inteira: owner Holon e
titular da conta pessoal GitHub ou owner ativo da organização GitHub. Para
convites: destinatário com email verificado e envio automático, com Cloudflare
indicado pelo responsável. A prova de destinatário não funde usuários por email.
Vários owners são permitidos por promoção explícita de membro; o último owner
ativo não pode sair/ser removido/rebaixado, inclusive sob concorrência.

A primeira entrega inclui onboarding self-service mínimo além das reviews de
leitura: login/pessoal, criar/selecionar equipe, membros/convites e conexão
GitHub. Essas respostas fecham a fronteira de produto da entrevista. Permanecem
provas de combinação de versões, D1/constraints/migrations, grant/reauth,
cookies/CSRF/origens e sender, delimitadas no
[plano técnico](../planning/dashboard-engineering-decision-review.md#plano-técnico-de-provas-antes-da-implementação).
Nenhum fluxo de auth, envio, schema, recurso remoto ou deploy foi implementado.

## Cloudflare Email Sending: condições e discrepância — 2026-10-04

**Serviço escolhido:** Email Sending do Cloudflare Email Service, documentado
em beta, com integração Workers. A API estruturada `env.EMAIL.send()` pelo
binding `send_email` é a candidata; usar adapter servidor por capacidade na
composição auth, sem SDK/browser ou package extra apenas para repassar chamadas.
[Overview](https://developers.cloudflare.com/email-service/),
[Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

Para convites a novos destinatários: Workers Paid e domínio usando Cloudflare
DNS com onboarding em Email Sending; remetente pertence ao domínio configurado.
O domínio/conta do Holon não foram inspecionados nem configurados nesta etapa.
Onboarding configura autenticação/bounces; não modificar DNS automaticamente
por seguir exemplos. [Configuração inicial](https://developers.cloudflare.com/email-service/get-started/send-emails/).

Na fonte de preços atual: 3.000 envios/mês incluídos por conta no Workers Paid;
excedente US$ 0,35/1.000 envios, além do plano Workers. A quota diária varia por
conta/reputação, sem número universal para prometer. Destinos verificados na
conta têm modalidade gratuita; isso é diferente da verificação do email do
usuário pelo Holon. [Preços](https://developers.cloudflare.com/email-service/platform/pricing/),
[limites](https://developers.cloudflare.com/email-service/platform/limits/).

**Discrepância de fontes:** a página de limites, atualizada em 2026-09-25, diz
que após onboard de domínio é possível enviar para qualquer destinatário.
[Configure send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/),
datada de 2026-06-09, ainda descreve envio sem restrições limitado aos destinos
verificados. A opção de convites é Email Sending; não exigir que cada convidado
seja cadastrado como destino Cloudflare por inferência da página divergente.
Provar envio pelo binding com remetente restrito a destinatário de teste não
cadastrado na lista verificada antes de considerar a composição demonstrada.

Enfileiramento/aceitação pela API não provam chegada à caixa de entrada. Definir
reenvio/falhas/quotas/supressão sem criar memberships por efeito do envio e sem
logs de endereço, conteúdo ou link/token no Holon. Não adicionar Queue,
SMTP, recebimento de emails, magic-link login ou outro serviço por disponibilidade.
Templates HTML/texto seguem marca e pt-BR/en; link usa origem configurada.

Desenvolvimento/CI não envia emails reais: sender fake ou simulação sanitizada,
pois a simulação documentada pode registrar conteúdo. `remote: true` envia
emails reais, exigindo autorização específica para smoke e destinatário de teste.
[Desenvolvimento local](https://developers.cloudflare.com/email-service/local-development/sending/).
Fontes verificadas em **2026-10-04**; conta, entrega, quotas e configuração real
não foram validadas operacionalmente.

### Atualização de topologia: proposta de Worker de email — 2026-10-04

O responsável perguntou sobre Worker especializado para futuros tipos de email.
A proposta inicial de adapter local em auth evoluiu para recomendação de
`apps/email-delivery` privado, com renderer/transporte e `send_email` concentrados
nele. Auth/aplicação mantém a política e estado; a porta de entrega é injetada,
sem ciclo auth→app. A tecnologia de envio foi confirmada em Q32; a topologia
adicional é proposta, não implementação autorizada pela pergunta.

[Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
permitem comunicação privada entre Workers. A chamada aguardada não é garantia
de processamento assíncrono nem retry durável. Queue pode ser evolução quando
houver necessidade de entrega desacoplada/picos/retry; sua
[garantia de pelo menos uma entrega](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
exige tratar repetições. A API de envio examinada não demonstrou idempotency key;
`messageId` de aceitação não prova exatamente um email sob timeout/retry.
Fontes verificadas em **2026-10-04**.

## Atualização Q35/Q36 e composição investigada — 2026-10-04

Q35 confirmou `apps/email-delivery` privado. Q36 escolheu fila e retries
duráveis desde a primeira entrega, superando a recomendação anterior de chamada
aguardada/reenvio explícito sem Queue. A [investigação de entrega](2026-10-04-dashboard-email-delivery-investigation.md)
propõe convite+outbox no mesmo commit D1, publisher recuperável, Queue de IDs e
claim/contexto/resultados por capability privada. O sender não recebe acesso
amplo ao D1 de identidade. Resultado durável precede ack individual; DLQ não
substitui estado persistido. Q37 confirmou retry limitado da mesma intenção
após resultado externo desconhecido, aceitando possível email duplicado.

A [investigação de auth/persistência](2026-10-04-dashboard-auth-persistence-investigation.md)
fixa uma combinação estável candidata e lê os fontes publicados. `db.transaction`
do adapter/driver não equivale ao batch D1; `runWithTransaction` sem implementação
transacional não garante rollback. O plugin Organization tem checks do último
owner, mas seus fluxos inspecionados exigiriam garantias adicionais. A direção
técnica recomendada agora é Better Auth para User/Account/Session e tenancy própria
do Holon, sem alterar o modelo único de workspace/organização acordado.

Mesmo essa composição precisa provar falha User/Account no OAuth, refresh
concorrente, cookies SSR, guards condicionais e batches. Desativar linking
implícito por email era a restrição então acordada. Ela foi substituída em
2026-10-05 pela [política nativa de email verificado aprovada](../engineering/dashboard-identity-and-workspaces.md#vinculação-por-email-verificado-ajuste-aprovado-em-2026-10-05),
cuja [prova local](2026-10-05-dashboard-auth-proof.md) recupera Account nos dois
adapters D1; state concorrente continua pendente. Tokens são servidor, com
criptografia nativa e transporte HTTP restrito. Fontes GitHub corrigem a afirmação
antiga de que OAuth Apps não teriam refresh; o fluxo humano GitHub App é recomendado
pelo escopo granular, não por essa distinção ultrapassada.

A [investigação de leitura](2026-10-04-dashboard-read-model-investigation.md)
propõe identidade/tenancy/convite/outbox em um D1 e projeção funcional em outro,
revisão por PR e detalhe agregado restrito. Experimento SQLite sintético confirma
planos de índices e busca literal limitada por `instr()`; não prova performance
D1, normalizador TypeScript ou autorização real. Os relatórios distinguem leitura
de fonte, inferência e prova pendente. Não houve implementação de autenticação,
instalação de dependências, schema/migration, recursos ou envio.

A [referência de engenharia](../engineering/frontend-application-structure.md#fronteira-proposta-de-entrega-de-emails)
registra responsabilidades e evolução. Não adicionar scheduler de notificações,
preferências, novos canais, filas adicionais ou SMTP apenas para antecipar
cenários. A Queue de convites e seu publisher/reconciliador são necessários
por Q36, não capacidades ainda aguardando escolha de produto.
