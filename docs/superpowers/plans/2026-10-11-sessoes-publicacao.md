# Sessões — fases 1 e 2: ordem segura de publicação

Spec: `docs/superpowers/specs/2026-10-03-sessoes-design.md` (aprovada em 2026-10-03).
Branch: `feat/sessoes`. Nada aqui foi aplicado no banco real nem publicado.

## O que muda para o público

- **Venda fecha sozinha 5 min depois do início do evento** (hoje fica aberta até a equipe fechar). Regra no banco (`session_is_selling`); a tela mostra "vendas fechadas".
- Depois desse horário, PIX novo é recusado ("pague com cartão até HHhMM", dentro da reserva); pagamento que chegar atrasado vai para "Pago após o fim das vendas — decidir", nunca vira pago sozinho e nunca estorna sozinho.
- Ingresso (página, PDF e e-mail) mostra sessão, data e horário no formato "Sábado, 10 de outubro de 2026 · 19h00", número do pedido e "Ingresso X de Y". Pedido estornado/cancelado lista os ingressos sem QR.
- Portaria confere a sessão ("Sessão errada — …", "Sessão cancelada — não liberar entrada"). Com uma sessão só, nada muda na operação.

## Migrations (todas aditivas)

| Arquivo | O que faz |
| --- | --- |
| `20261011100000_event_sessions.sql` | Cria `event_sessions` e `session_ticket_types` (RLS ligada), cria **1 sessão por evento** copiando horário, lotação, cotas e preços, liga pedidos e ingressos à sessão, confere as contagens (aborta tudo com `MIGRACAO_SESSOES:` se algo não bater) e troca as funções de venda, pagamento, cortesia, edição e lembrete para contar por sessão. Assinaturas antigas continuam funcionando. |
| `20261011110000_check_in_sessions.sql` | Nova `check_in_ticket(evento, sessão, código, equipe)`. A antiga (sem sessão) continua para o código atual e recusa ingresso de evento com mais de uma sessão ou de sessão cancelada. |

Nenhuma migration restritiva agora. A limpeza (remover gatilhos de compatibilidade e funções antigas) fica para a fase 7 da spec, **depois** que o código novo estiver no ar.

## Ordem

1. **Antes**: backup do banco (dump pelo painel/CLI) e anotar as contagens abaixo.
2. **Aplicar as 2 migrations** (com aprovação do dono, MCP `supabase-eventos`, projeto Espaço Byla Eventos, conferindo `events`, `tickets`, `orders`, `ticket_types`, `staff_profiles`).
   - O código que está no ar continua funcionando: o checkout antigo chama `create_checkout_order` sem sessão (usa a única), a portaria antiga chama `check_in_ticket` sem sessão, gatilhos mantêm a sessão única igual ao evento quando a equipe edita.
   - Já a partir daqui a venda fecha 5 min depois do início.
3. **Conferir as contagens depois** (devem ser iguais às de antes).
4. **Publicar o código** (merge em `main` → Vercel).
5. Testar em produção: compra de teste, ingresso/PDF, e-mail, portaria com o QR.

**Nunca** publicar o código antes das migrations: ele lê `orders.session_id` e `event_sessions`, que só existem depois delas.

## Contagens (antes e depois)

```sql
select
  (select count(*) from public.events) as eventos,
  (select count(*) from public.orders) as pedidos,
  (select count(*) from public.tickets) as ingressos,
  (select count(*) from public.tickets where status in ('pago', 'check_in')) as ingressos_validos,
  (select count(*) from public.orders where status = 'pendente' and expires_at > now()) as reservas_ativas;
```

Só depois:

```sql
select
  (select count(*) from public.event_sessions) as sessoes,          -- = eventos
  (select count(*) from public.orders where session_id is null) as pedidos_sem_sessao,   -- 0
  (select count(*) from public.tickets where session_id is null) as ingressos_sem_sessao, -- 0
  (select count(*) from public.events e
     where (select count(*) from public.event_sessions s where s.event_id = e.id) <> 1) as eventos_fora_do_padrao; -- 0
```

## Testes feitos

- `node scripts/db-tests/sessions.mjs` (Postgres temporário com todas as migrations): contagens da migração, compatibilidade com o código antigo, preços/cotas/limites por sessão, concorrência pelo último lugar, fechamento automático com PIX e cartão, portaria, sessão cancelada, permissões e RLS.
- `node scripts/db-tests/abandoned-reminders.mjs`.
- `npx vitest run`, `npx eslint .`, `npx next build`, `npx tsc --noEmit`.

## Desvios da spec (registrados)

- `event_sessions.event_id` com `on delete cascade` (o rollback de "criar evento" apaga o evento recém-criado); pedidos continuam impedindo apagar sessão com venda.
- O checkout trava o evento em modo compartilhado antes da sessão (ordem evento → sessão em todas as funções), para não haver deadlock com a edição do evento. Sessões diferentes continuam sem esperar uma pela outra.
- Mensagem de venda encerrada no checkout continua "As vendas deste evento estão fechadas." (sessão única, sem mudança visível).
- Tabelas de aviso de horário e lote de estornos (fases 5 e 6) não foram criadas.

## Fica para depois

- Fase 3: editor de sessões da equipe (remover os gatilhos de compatibilidade, escolher sessão na cortesia, painel por sessão, contador "Entraram N de M" por sessão).
- Fase 4: comprador escolhe a sessão, chips na home; checkout e home ainda leem os preços de `ticket_types` (espelhados na sessão única).
- Fases 5–7: aviso de horário, cancelar sessão/estornar todos, limpeza.
- Visual final da portaria, página do pedido e ingresso: ajustar com o layout mobile-first.
