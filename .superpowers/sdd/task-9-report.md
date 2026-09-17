# Task 9 — Check-in (API + scanner mobile)

## Status

DONE_WITH_CONCERNS em 2026-09-17 na branch `feat/mvp`.

## Implementação

- `POST /api/check-in` exige usuário autenticado com perfil de equipe.
- O ingresso é avaliado por `evaluateCheckIn`; recusas usam mensagens em
  português de `checkInMessage(reason)`.
- A gravação é atômica: altera apenas o ingresso do evento ainda com status
  `pago`; uma disputa simultânea retorna “Já utilizado”.
- A página `/equipe/eventos/[id]/check-in` usa a câmera traseira via
  `html5-qrcode`, tem retorno visual grande e entrada manual como alternativa.
- O link já existente no detalhe do evento aponta para a nova página.

## Verificação

- `npm test`: 7 arquivos e 21 testes aprovados.
- `npm run lint`: aprovado.
- `npm run build`: aprovado, incluindo API e página dinâmica de check-in.
- `git diff --check`: aprovado.
- Concern: câmera real não foi validada em um celular nesta execução.
- Avisos preexistentes: configuração futura do Vite e migração de `middleware`
  para `proxy`.

Task 10 não foi iniciada.
