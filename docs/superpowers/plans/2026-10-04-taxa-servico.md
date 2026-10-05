# Plano — Taxa de serviço

Spec: `docs/superpowers/specs/2026-10-04-taxa-servico-design.md` (aprovada pelo dono em 2026-10-04).
Branch: `feat/taxa-servico` (base `origin/main` `c54b7e8`). Nada é aplicado no banco real, publicado ou enviado sem o "pode" do dono.

## Tarefas

| # | Tarefa | Arquivos | Testes |
| --- | --- | --- | --- |
| 1 | Spec aprovada + este plano | `docs/superpowers/specs/…taxa-servico-design.md`, este arquivo | — |
| 2 | Cálculo puro e textos | `src/lib/domain/service-fee.ts` | `tests/domain/service-fee.test.ts` (tabela 4.2, mínimo, desligada, paridade com o SQL) |
| 3 | Situação do repasse e leitura dos resumos | `src/lib/domain/fee-payout.ts` | `tests/domain/fee-payout.test.ts` (datas em São Paulo, saldo negativo, parse defensivo) |
| 4 | Migration A (aditiva) | `supabase/migrations/20261013100000_service_fee.sql` | `scripts/db-tests/service-fee.mjs` (Postgres temporário) |
| 5 | Tipos do banco | `src/types/database.ts` | `tsc` |
| 6 | Acesso Admin no servidor | `src/lib/auth/finance-admin.ts`, `src/lib/payments/service-fee-policy.ts` | `tests/equipe/fee-actions.test.ts` |
| 7 | Comprador: preços com taxa, checkout, pedido, e-mails | home, `/eventos/[slug]`, checkout (form + action), `/pedidos/[publicToken]`, `src/lib/email/*` | testes de action do checkout, templates de e-mail |
| 8 | Equipe: quadro "Financeiro do evento", página "Taxa de serviço", planilha, contestação, "Total vendido" só Admin | `src/app/equipe/**`, `src/components/equipe/*`, `src/lib/finance/fee-csv.ts` | `tests/finance/fee-csv.test.ts`, `tests/equipe/fee-actions.test.ts`, rota da planilha |
| 9 | Verificação | `npx tsc --noEmit`, `npx vitest run`, `npm run lint`, `npm run build`, teste da migration | — |

## Contrato do banco (Migration A)

Todas as funções: `set search_path = ''`, `revoke all … from public, anon, authenticated`, `grant execute … to service_role`. As que agem pela equipe recebem `p_staff_user_id` e reconferem o papel dentro do banco.

| Função | Retorno |
| --- | --- |
| `service_fee_for_price(price, rate_bps, min)` | `integer` (fórmula; 0 para preço ≤ 0) |
| `service_fee_policy()` | `table(enabled, rate_bps, min_cents)` |
| `is_admin()` | `boolean` (conta logada com `role = 'admin'`; para RLS futura; executável por `authenticated`, como `is_staff()`) |
| `staff_finance_role(p_staff_user_id)` | `'admin'`, `'admin_dev'` (admin + `is_developer`), `'secretaria'` ou `null` |
| `event_fee_due_date(p_event_id)` | `date` (dia seguinte, em São Paulo, ao fim da última sessão ativa) |
| `event_finance_summary(p_event_id, p_staff_user_id)` | `jsonb` (campos em `parseEventFinanceSummary`) — `TAXA_ADMIN` se não for admin |
| `service_fee_overview(p_staff_user_id, p_from, p_to)` | `jsonb` (campos em `parseServiceFeeOverview`); período pela data da última sessão |
| `record_service_fee_payout(p_event_id, p_staff_user_id, p_expected_amount_cents, p_pix_date, p_note)` | `jsonb {payout_id, amount_cents}` |
| `record_service_fee_adjustment(p_event_id, p_staff_user_id, p_amount_cents, p_reason)` | `jsonb {payout_id}` |
| `register_order_chargeback(p_order_id, p_staff_user_id, p_kind, p_reason, p_source default 'manual')` | `jsonb {id, kind}` |
| `create_checkout_order(…, p_expected_fee_rate_bps, p_expected_fee_min_cents)` | `table(order_id, total_cents, expires_at, service_fee_cents)` |

Recusas: `TAXA_ADMIN`, `TAXA_DEV`, `TAXA_PRAZO`, `TAXA_MUDOU:<centavos>`, `TAXA_NADA`, `TAXA_DATA`, `TAXA_NOTA`, `TAXA_MOTIVO`, `TAXA_VALOR`, `TAXA_PEDIDO`, `TAXA_CONTESTACAO_JA`, `TAXA_CONTESTACAO_SEM`, `TAXA_EVENTO`.

## Migrations

- **A — `20261013100000_service_fee.sql` (aditiva, ANTES do deploy).** `staff_profiles.role` (padrão `secretaria`) e `is_developer` (padrão `false`); `service_fee_settings` **desligada**; colunas de taxa em `orders`/`order_items` com preenchimento dos pedidos antigos (subtotal = total, taxa 0), gatilho que preenche o subtotal para funções antigas (cortesia) e constraints de soma; `order_chargebacks`, `service_fee_payouts`, `service_fee_payout_items` (RLS ligada, sem políticas, imutáveis por gatilho); funções acima; `create_checkout_order` v5 com os mesmos parâmetros nomeados + 2 opcionais. Com a chave desligada e o código atual (`c54b7e8`) no ar, preços, totais, estornos e permissões não mudam.
- **Sem migration restritiva depois do deploy.** A spec mantém as leituras antigas da secretaria (`orders`, `order_items` pela chave pública + login); o que é novo (agregados, repasses, contestações) já nasce fechado. Fechar leituras antigas fica para uma decisão futura (risco 4 da spec).

## Ordem de publicação (cada passo com o "pode" do dono)

1. Conferir o projeto (MCP `supabase-eventos`, projeto Espaço Byla Eventos, ref `rlzyjlrcasqbjztgbgit`, fingerprint `events`/`tickets`/`orders`/`ticket_types`/`staff_profiles`).
2. Aplicar a **Migration A**. Conferência só leitura: `select enabled from public.service_fee_settings` → `false`; `select count(*) from public.orders where tickets_subtotal_cents <> total_cents` → `0`.
3. **Dono marca os papéis** no painel do banco (SQL Editor do projeto Eventos):
   - Admin: `update public.staff_profiles set role = 'admin' where user_id = '<id da conta>';`
   - Desenvolvedor (pode ser Admin para **ver**; nunca marca pago): `update public.staff_profiles set is_developer = true where user_id = '<id da conta do desenvolvedor>';`
   - Conferir: `select display_name, role, is_developer from public.staff_profiles;`
4. Push da branch + deploy na Vercel. Conferência: com a taxa desligada, preços e totais iguais aos de antes; Admin vê "Financeiro do evento" e "Taxa de serviço"; secretaria não vê (e a página dá "não encontrada").
5. (Recomendado) publicar "Termos de compra" com a seção da taxa.
6. **Ligar a taxa** (painel do banco, com "pode" do dono): `update public.service_fee_settings set enabled = true where id = 1;` Compra de teste pequena feita pelo dono + estorno dela; conferir valor no banco de pagamento, e-mail e quadro.
7. Para desligar: `update public.service_fee_settings set enabled = false where id = 1;` (pedidos já feitos mantêm a taxa gravada).

## Antes de alguém virar Admin

Todas as contas começam `secretaria`. Nada essencial depende de papel: venda de cortesia, check-in, estorno, decidir pedidos, sessões, avisos continuam com `is_staff()`. Só somem o cartão "Total vendido", o quadro "Financeiro do evento", o menu e a página "Taxa de serviço" até o dono marcar um Admin.
