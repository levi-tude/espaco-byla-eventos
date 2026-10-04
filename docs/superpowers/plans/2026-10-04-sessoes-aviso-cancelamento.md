# Sessões — aviso de horário (fase 5) e cancelar sessão + estornos (fase 6)

Spec: `docs/superpowers/specs/2026-10-03-sessoes-design.md` (seções 6.4, 9.4, 10). Base: `origin/main` = `a82404b`.
Branch: `feat/sessoes-aviso-cancelamento`. **Nada aplicado no banco real, nada publicado.**

## Decisões do dono seguidas (2026-10-04)

- **A — troca de horário:** cartão no painel da sessão com "Avisar compradores"; 1 e-mail por pedido pago, horário antigo → novo, sem prometer reembolso; mesmo pedido nunca recebe duas vezes o aviso da mesma alteração.
- **B — cancelar sessão (opção D):** soft (nada apagado), motivo obrigatório, digitar CANCELAR, caixa "Avisar compradores agora" já marcada; fecha a venda, cancela pendentes, não estorna sozinho. Depois: "Estornar pedido" (um por um, já existe) ou "Estornar todos" com segunda confirmação (digitar o valor total), idempotente, falhas listadas com "Tentar de novo".
- **C — cota de e-mail:** fila no banco; para em 80 envios no dia (reserva 20 para ingressos e alertas); continua sozinha depois que a cota renova + botão "Continuar envio".
- **D — textos:** comprador sem nome de fornecedor; equipe em linguagem de operação; mobile-first.

## Escolha para a continuação automática (C)

A opção mais simples e segura: **o cron diário da Vercel que já existe** (`/api/cron/keep-alive`, protegido por `CRON_SECRET`) passa a também enviar a fila de avisos, e o horário dele muda de 12h UTC para **00h UTC (21h em Brasília)**, logo depois que a cota diária do serviço de e-mail renova. Não há agendamento novo, segredo novo nem nada para o dono ligar.
Extra opcional: o job de 15 min do lembrete (que continua **desligado**) também esvazia a fila antes dos lembretes, se o dono ligá-lo um dia.

## Tarefas

1. **Migration** `20261012100000_session_notices_cancel.sql` (aditiva):
   - tabelas `session_audit_log`, `session_notices`, `session_notice_deliveries`, `email_quota_pause`, `session_refund_batches`, `session_refund_batch_items` — RLS ligada, sem política (só `service_role`); auditoria sem `update/delete`;
   - funções (SECURITY DEFINER, `search_path = ''`, `revoke` de `public/anon/authenticated`, `grant` só a `service_role`): `session_ops_summary`, `queue_schedule_change_notice`, `cancel_event_session`, `queue_cancellation_refund_notice`, `claim_session_notice_deliveries`, `mark_session_notice_sent`, `release_session_notice_delivery`, `pause_session_notice_emails`, `retry_failed_session_notices`, `session_notice_progress`, `start_session_refund_batch`, `claim_session_refund_item`, `finish_session_refund_item`, `retry_session_refund_failures`.
2. **Teste da migration** `scripts/db-tests/session-notices-cancel.mjs` (Postgres embutido temporário): idempotência do aviso, cancelamento (pendentes cancelados, pagos intactos, confirmação/motivo no servidor, 2ª vez sem efeito), check-in recusa sessão cancelada, lote (um aberto por sessão, total conferido no banco, itens pulados, sem duplicar, retomada após queda, "Tentar de novo"), fila de e-mail (pausa de cota, sem duplicar), permissões/RLS.
3. **Domínio puro + testes:** `src/lib/domain/session-ops.ts` (valor digitado → centavos, CANCELAR, leitura do resumo, rótulos), `src/lib/notices/rules.ts` (80/dia, lotes, próxima renovação).
4. **E-mails + testes:** `src/lib/email/session-notice-template.ts` (mudança de horário, sessão cancelada) e variante "Sessão cancelada — valor devolvido" em `refund-template.ts`; envio com `Idempotency-Key`, `reply_to = PRIVACY_CONTACT_EMAIL` e leitura do cabeçalho de uso diário.
5. **Fila:** `src/lib/notices/process.ts` (reivindica, envia, marca, pausa na cota); estorno de pedido de sessão cancelada passa pela fila (`notifyBuyerRefunded`).
6. **Ações** `src/app/equipe/eventos/session-actions.ts` (todas com `requireStaffUser`, UUID validado, `runAction`): avisar compradores, continuar/tentar envio, cancelar sessão (+ cancelar PIX abertos no provedor), iniciar lote, estornar o próximo, tentar de novo as falhas.
7. **Telas da equipe (mobile-first):** cartão do aviso de horário, histórico de e-mails com "Continuar envio", "Cancelar sessão" (tela própria), faixa da sessão cancelada, "Estornar todos" com progresso e relatório.
8. **Crons:** `keep-alive` envia a fila (sem afetar a leitura do banco); `abandoned-reminders` esvazia a fila antes dos lembretes; `vercel.json` às 00h UTC.

## Ordem de publicação

1. Backup do banco.
2. Aplicar a migration `20261012100000_session_notices_cancel.sql` (aprovação do dono; MCP `supabase-eventos`, projeto Espaço Byla Eventos, fingerprint `events/tickets/orders/ticket_types/staff_profiles`). O código no ar (`a82404b`) não usa nada dela e continua igual.
3. Conferir `PRIVACY_CONTACT_EMAIL` na Vercel (respostas dos e-mails de sessão).
4. **Ensaio com as credenciais de teste do Mercado Pago** (vendedor `APP_USR-` de teste) num preview: sessão de teste com ~5 pedidos pagos → cancelar → estornar 1 um por um → "Estornar todos" → fechar a aba no meio → "Continuar estornos" → conferir 1 estorno por pagamento e 1 e-mail por pedido.
5. Publicar o código (merge em `main`). O primeiro "Estornar todos" real deve ser acompanhado (lote pequeno).

Nunca publicar o código antes da migration: o painel chama `session_ops_summary`.

## Fora deste trabalho (pendente de decisão)

- Reativar sessão cancelada (spec 9.4.2, recomendação) — não pedido nesta rodada.
- Alertas de lote (`lote_estorno_com_falhas`/`pausado`): cada falha já gera o alerta `estorno_falhou` existente.
- Motivo pré-preenchido no "Estornar pedido" individual de sessão cancelada.
