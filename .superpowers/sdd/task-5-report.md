# Task 5 — CRUD de eventos + tipos de ingresso

## Status

DONE_WITH_CONCERNS

## Entregue

- Formulário da equipe para criar e editar evento, preços de inteira/meia e capa opcional.
- Server Actions `createEvent`, `updateEvent` e `setSalesOpen`, com validação e slug único.
- Criação automática dos tipos `inteira`, `meia` e `cortesia` (cortesia ativa e preço zero).
- Tela de detalhe com capacidade, ocupados, restantes, controle de venda, link de check-in e placeholder da lista.
- Home pública com apenas eventos em venda e página pública sem exposição de cortesia.
- CTA de compra condicionado a venda aberta e capacidade disponível.

## Verificação

- `npm run build`: passou.
- `npm test`: 4 arquivos e 10 testes passaram.
- Diagnósticos dos arquivos alterados: sem erros.

## Ressalvas

- Não há Supabase ao vivo configurado. Por isso, não foi possível criar o evento fictício “Noite de Teste” nem confirmar visualmente abertura/fechamento na home.
- A página pública usa o cliente administrativo apenas no servidor para contar ingressos ocupados; nenhuma informação de comprador é retornada.
- O aviso de descontinuação da convenção `middleware.ts` já existia e não faz parte desta tarefa.
