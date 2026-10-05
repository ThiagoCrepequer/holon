---
id: OPERATIONS-DASHBOARD-ENVIRONMENTS-RECOVERY
kind: reference
status: proposed
owners:
  - core-team
last-reviewed: 2026-10-04
related:
  - ../planning/dashboard-implementation-plan.md
  - ../research/2026-10-04-dashboard-email-delivery-investigation.md
  - ../research/2026-10-04-dashboard-read-model-investigation.md
---

# Ambientes e recuperação do dashboard

## Pergunta e limite

Como publicar e recuperar o MVP sem misturar identidade, efeitos de email,
projeções e recursos de preview/produção?

Este é um roteiro **proposto**, sem nomes de recursos, domínios, credenciais ou
operações remotas definidos. Completar IDs e comandos contra os manifests reais
na implementação; seguir [deploy](deployment.md) e ADRs vigentes. Uma revisão
documental não autoriza migration, DNS, restore, envio ou publicação.

## Composição por ambiente

| Ambiente           | Dados e limites                                                             | Efeitos permitidos                                                          |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Teste local/CI     | Identidade/PRs sintéticos, D1/DO isolados, sem tokens reais                 | Fakes/Workerd/browser; sender controlado, sem GitHub/email reais            |
| Preview homologado | Recursos não produtivos próprios, callbacks/origens exatos, acesso restrito | Somente smokes explicitamente autorizados; destinatários de teste restritos |
| Produção           | Bindings, banco, Queue/DLQ, domínio e key material identificados            | Operação publicada e autorizada; sem herdar credenciais/dados de preview    |

Não ligar preview a D1 de produção, produção à fila de testes ou testes a binding
`remote: true` por conveniência. Cron, consumer e origem de links também são por
ambiente. O email Worker privado não expõe envio por HTTP; configuração deve
desabilitar rotas públicas e URLs auxiliares efetivas. `workers_dev: false` não
desliga sozinho URLs de preview/versionamento: declarar configuração aplicável
e comprovar a superfície real. [Workers URLs](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/),
[configuração Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/).

GitHub App/OAuth callback de homologação tem registro separado ou URIs explícitas
suportadas, sem wildcard confiando em qualquer branch. Rotação de credenciais
usa mecanismo suportado da integração aprovada e dono operacional; registrar
efeito sobre sessões/tokens antes de trocar key material. Não copiar secrets
para fixtures, logs, bundle, documentos ou artefatos de CI.

## Migrações, artefatos e rollout

1. Registrar SHA/lockfile, versões do runtime e bibliotecas, compatibility date,
   migrations, IDs de recursos e grafo de bindings do artefato revisado.
2. Construir/testar/dry-run sem aplicar migrations ou criar recursos. Separar
   explicitamente instalação, geração e aplicação local/remota de schema.
3. Aplicar somente migrations revisadas, com backup/ponto de recuperação e
   verificação de constraints/índices. Não editar migrations já aplicadas.
4. Coordenar publicação dos contratos atuais entre dashboard, core e sender,
   distinguindo import de código de service binding runtime. Não criar ciclo
   de imports entre apps ou fallback de contrato antigo para ocultar rollout.
5. Validar mesmo artefato/SHA, callbacks, origem/cookie/CSRF, autorização privada,
   alarm/projeção, publisher/consumer e sender antes de abrir tráfego geral.
6. Ampliar rollout somente com sinais e smokes definidos. Rollback de código
   não reverte schema ou efeito externo; confirmar compatibilidade do artefato
   anterior com schema corrente ou usar recuperação coordenada.

Este roteiro não exige ferramenta nova por iniciativa do agente. Enquadrar
dashboard/email no fluxo de CI/deploy real em decisão própria; ADR-0048 não
prova que novos Workers já estão cobertos. Não ressuscitar admin/read model antigo.

## Estado observável e condições de intervenção

| Autoridade      | Sinais mínimos sem conteúdo privado                                                                                              | Intervenção                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Auth/GitHub     | Falha de callback, refresh perdido/contendido, reconexão requerida, negações/erros classificados                                 | Corrigir integração; não conceder acesso nem fundir User por email                 |
| Email D1        | Idade de intenção, publicado sem conclusão, lease vencido, próximas ações, tentativas totais, resultado desconhecido/falha final | Reconciliador cobre não terminais; revisar causa de falha terminal antes de replay |
| Queue/DLQ       | Backlog, idade/retention, retries e encaminhamento                                                                               | Relacionar com D1; mensagem não é registro final de negócio                        |
| Ledger/projeção | Revisão pendente/confirmada, idade da obrigação, alarm/rearmamento e lag                                                         | Recuperar tarefa e snapshot autoritativo; preservar cleanup e outras obrigações    |

Eventos usam IDs opacos, códigos previstos, revisões, contagens, duração e
resultado. Não incluir email, título/autor, conteúdo de PR, token/link, corpo de
provider ou erro arbitrário. Também revisar invocation URLs/query strings e
logging nativo; logger sanitizado no app não sanitiza automaticamente a plataforma.
Email preview de produção deve estar desligado/conferido conforme pesquisa.

Alertas e prazo de intervenção não podem ficar sem dono. Antes de publicar,
fixar responsável, latência/deadline de entrega, limite de lag, retenção e prazo
de atendimento, derivados da carga/política aprovada. Backoff/jitter e orçamento
do job precisam caber no prazo útil do convite e na retenção configurada. Não
usar disponibilidade da DLQ como garantia de recuperação ilimitada.

## Recuperação sem repetir efeitos cegamente

Primeiro registrar ambiente/IDs, incidente e ponto de recuperação; manter
evidência mínima e obter autorização da operação. Consultar estado atual antes
de qualquer replay. Reenvio preserva ID, alvo, estado, deadline e orçamento;
aceito/cancelado/expirado não produz outro ingresso. Q37 cobre duplicação limitada
de mensagem sob resultado desconhecido, não retry indiscriminado de refresh OAuth.

Restore de banco pode reviver sessão revogada, convite consumido, lease ou job
antigo. Portanto a restauração de identidade não deve imediatamente reabrir
tráfego/sender: revalidar/inutilizar sessões e grants afetados, reconciliar convites
e efeitos conhecidos, classificar efeitos incertos e definir orçamento atual antes
de retomar. Se a história durável necessária se perdeu, preservar modo seguro e
exigir reconexão/reconciliação, sem inventar sucesso ou reiniciar contadores.

DO e D1 não têm restore atômico comum. Se ledger retornar a uma revisão inferior
à projeção, o UPSERT monotônico a rejeitará. Isolar o escopo afetado, recuperar a
autoridade e reconstruir/reconciliar sua projeção explicitamente sob um plano
operacional autorizado; preservar snapshot de rollback. A barreira suspende
produtores **e escritas da projeção**, não apenas tráfego do dashboard. Entregas
anteriores ao restore ainda em trânsito não podem reaplicar revisão alta depois
da reconstrução ou da retomada.

O candidato de barreira usa geração de recuperação persistida por escopo,
conferida na gravação e capturada junto do snapshot **antes** de I/O. Recuperação
coordenada, com ingress/consumers suspensos, instala uma geração nova em autoridade
e destino, reconstrói e só então reabre o escopo. Destino rejeita geração antiga;
retry reobtém snapshot autoritativo, sem remarcar payload antigo com geração nova.
Geração causal não é versão/compatibilidade de schema. Provar o mecanismo real
antes da publicação, inclusive entrega tardia pós-retomada e falha em cada passo.
Não resetar revisão silenciosamente, aceitar payload antigo como novo ou criar compatibilidade de
schemaVersion. Recuperar a projeção atual é distinto de importar histórico de PRs.

Testar restore/reconciliação com dados sintéticos antes da publicação. Exercitar
jobs já aceitos, convite cancelado, sessão revogada, ledger com revisão inferior
e obrigação sem wake-up. Incluir snapshot antigo retido em trânsito chegando
após reconstrução/retomada, que deve ser rejeitado pela barreira. Reconstrução
do derivado pode consultar autoridades por ID nesse procedimento; a lista
normal continua sem fan-out por linha.

Cloudflare documenta [Time Travel D1](https://developers.cloudflare.com/d1/reference/time-travel/)
e [PITR SQLite DO](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api).
Confirmar retenção/plano/IDs/pontos disponíveis no ambiente operado; a capacidade
documentada não significa que uma restauração tenha sido ensaiada ou autorizada.
Fontes verificadas em **2026-10-04**; nenhuma operação foi executada nesta revisão.
