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

## Correção — revalidação de páginas públicas

### Problema

`updateEvent` e `setSalesOpen` revalidavam `/`, `/equipe` e `/equipe/eventos/[id]`, mas não invalidavam a página pública `/eventos/[slug]`. Edições e abertura/fechamento de venda podiam demorar a aparecer na home e na página do evento.

### Correção

- Extraído `slugify` e `resolveUniqueSlug` para `src/lib/domain/slug.ts`.
- Adicionado helper `revalidateEventSurfaces(id, slug)` em `actions.ts`, usado por `createEvent`, `updateEvent` e `setSalesOpen`.
- `updateEvent` e `setSalesOpen` buscam o slug do evento antes de revalidar.
- Testes unitários em `tests/domain/slug.test.ts` (normalização + unicidade).

### Verificação pós-correção

- `npm test`: 5 arquivos, 14 testes passaram.
- `npm run build`: passou.
