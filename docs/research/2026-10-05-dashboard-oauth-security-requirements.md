---
id: RESEARCH-DASHBOARD-OAUTH-SECURITY-REQUIREMENTS
kind: research
status: current
owners:
  - core-team
last-reviewed: 2026-10-05
related:
  - 2026-10-05-dashboard-auth-proof.md
  - ../engineering/web-security-and-data-boundaries.md
  - ../planning/dashboard-implementation-plan.md
---

# OAuth: PKCE, CSRF e o requisito de replay do milestone 0

## Conclusão e alcance

A afirmação sobre a RFC 9700 está correta. O requisito de #129 deve nomear a
**garantia de segurança**, sem exigir atomicidade de state como único mecanismo.
Isso não libera o candidato atual: Better Auth 1.7.7 envia o mesmo authorization
code duas vezes em callbacks concorrentes, mesmo com PKCE. **NO-GO permanece**;
não há justificativa para dispensar a não reutilização do code pelo cliente.
Esta revisão responde à solicitação de avaliar a dispensa; não aprova auth
produtiva, altera ADR aceito ou instala uma solução alternativa.

## O que os padrões exigem

Fontes primárias verificadas em **2026-10-05**:

- [RFC 9700 §2.1/§2.1.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1):
  PKCE pode proteger contra CSRF se o suporte do servidor de autorização estiver
  assegurado. Challenge/verifier devem ser específicos da transação e vinculados
  ao cliente e browser; usar S256. A
  [§4.7.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.7.1) mantém a
  proteção da integridade de estado da aplicação. A
  [§4.8.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.8.2) exige rejeitar
  verifier quando o código foi emitido sem challenge, evitando downgrade.
- [RFC 6749 §4.1.2](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.1.2): o
  cliente não pode reutilizar o mesmo authorization code; o servidor deve negar
  repetição e deveria revogar os tokens previamente emitidos quando possível.
  PKCE não elimina essa obrigação independente. Revogação seria também um risco
  operacional, mas não foi observada no GitHub nesta prova.

Portanto, exigir sempre uma exclusão atômica de state antes da troca era mais
prescritivo que o padrão. Sua substituição correta preserva proteção CSRF,
integridade do contexto, não reutilização de code e testes negativos. PKCE do
callback não substitui CSRF de comandos Hono autenticados por cookie.

## Suporte documentado e cliente executado

A [documentação de GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
documenta S256 e exige o verifier correspondente ao challenge enviado. Isso
sustenta suporte documentado para GitHub.com; não é descoberta dinâmica nem
prova remota desta aplicação. A página consultada não explicita a rejeição de
verifier em código emitido **sem** challenge. Não presumir que o teste sintético
comprova essa defesa no GitHub ou estender a conclusão a outros providers/GHES.

No [provider GitHub 1.7.7](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/core/src/social-providers/github.ts),
o fluxo nativo utiliza os helpers de
[authorization URL](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/core/src/oauth2/create-authorization-url.ts) e
[token request](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/core/src/oauth2/validate-authorization-code.ts).
A bancada observou challenge S256 distinto por fluxo, verifier mantido no servidor
e correspondência criptográfica no request nativo. O
[parser de state](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/state.ts)
lê a verificação e depois a apaga; duas leituras concorrentes podem preceder a
exclusão. Isso explica duas requisições com o mesmo code, não uma falha do D1
em validar PKCE. Trocar pelo adapter D1 nativo conserva o resultado.

## Provas adicionadas e limites

[`test/oauth-pkce.test.ts`](../../tooling/dashboard-auth-proof/test/oauth-pkce.test.ts)
exercita o handler/provider/adapters publicados com Workerd e D1 locais. Só a
rede GitHub é sintética. O fake valida S256, client/redirect, downgrade e uso único;
seu hash WebCrypto é confrontado com um oráculo Node independente e o vetor
publicado na [RFC 7636, apêndice B](https://www.rfc-editor.org/rfc/rfc7636.html#appendix-B).

| Cenário                                                              | Observação local                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Dois fluxos nativos                                                  | Challenges distintos; verifier não aparece na authorization URL e corresponde ao challenge na troca |
| Código de outro fluxo com state e cookie válidos da vítima           | Provider nega PKCE; nenhum User/Account/Session                                                     |
| Código emitido sem challenge; provider rejeita downgrade             | Provider nega; nenhuma sessão                                                                       |
| Mesmo ataque; defesa de downgrade desabilitada no fake               | Login da identidade atacante no browser da vítima; premissa de segurança explicitada                |
| Dois callbacks simultâneos com mesmo state/cookie/code e PKCE válido | Duas token requests, uma troca aceita e uma sessão; gate de não reutilização falha                  |
| Verifier ausente/incorreto/formato inválido e vetor RFC              | Fake nega negativos e aceita o vetor publicado                                                      |

O ataque adversarial pressupõe que o atacante aprendeu o state da vítima e
induziu o callback no browser dela, que fornece seu cookie assinado. Não há
roubo de cookie ou bypass de assinatura nesse cenário. Desabilitar downgrade
no fake modela uma premissa externa ausente, **não demonstra falha do GitHub**.
O fake nega code repetido, mas não simula revogação posterior dos tokens.
Uma sessão local não prova que o token manteria validade no provider real.

A suite diagnóstica passou **59 casos**; o gate separado continua com **duas
provas verdes e duas falhas, exit 1**, uma por adapter. Os testes novos falharam
primeiro contra o fake permissivo: isso revelou insuficiência da simulação,
não um defeito de PKCE da biblioteca. Após fortalecer somente esse limite
externo, os negativos passaram. Não há patch do core, bypass produtivo, skip,
`it.fails` ou expectativa invertida para liberar o gate. Cobertura do harness
permanece 100% linhas/funções/statements e 96,42% branches, sem medir o core.

## Requisito revisado e próximo gate

**Requisito:** callbacks devem preservar vínculo com browser/transação e destino
permitido; code consumido é negado, e callbacks concorrentes não fazem o cliente
submeter o mesmo code mais de uma vez. Recuperação inicia novo OAuth. PKCE nativo
S256 e suas premissas externas devem acompanhar a evidência de CSRF.

A revisão elimina a imposição de um mecanismo específico de state, mas mantém
o teste observável de uma token request por code. O candidato falha porque faz
duas. É necessário obter uma composição oficialmente suportada que satisfaça
essa obrigação e repetir os testes. A avaliação do provider real deve registrar
S256, rejeição de mismatch/downgrade e replay antes de alegar sua comprovação
remota. Não foram usados secrets, GitHub App real, banco remoto ou deploy.
