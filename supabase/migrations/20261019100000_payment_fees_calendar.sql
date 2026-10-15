-- Fase 3 (A): tarifa real de cada pagamento e calendário de dias úteis.
-- Tudo só por função security definer; nenhuma tabela é lida direto pelo app.

-- 0) Ações novas do histórico (todas as da fase 3 de uma vez)
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in (
  'convite_gerado', 'convite_revogado', 'convite_usado', 'link_senha_gerado', 'senha_redefinida_link',
  'conta_criada', 'conta_suspensa', 'conta_reativada', 'conta_encerrada', 'aparelhos_esquecidos',
  'evento_criado', 'evento_enviado', 'evento_envio_desfeito', 'evento_aprovado', 'evento_recusado',
  'evento_alterado_pos_aprovacao', 'evento_excluido', 'vendas_abertas', 'vendas_pausadas',
  'pedido_estorno_criado', 'pedido_exclusao_criado', 'pedido_mudanca_criado',
  'pedido_atendido', 'pedido_recusado', 'pedido_cancelado',
  'tarifa_lancada', 'repasse_registrado', 'repasse_compensado', 'repasse_ajuste',
  'devolucao_recebida', 'devolucao_pendente',
  'pix_troca_pedida', 'pix_troca_cancelada', 'pix_troca_confirmada', 'pix_troca_recusada'
));

-- 1) Tarifa por pagamento -------------------------------------------------------
-- Linha com fee_cents nulo = tentativas automáticas que ainda não acharam a tarifa.
create table public.order_payment_fees (
  order_id uuid primary key references public.orders (id),
  gross_cents integer check (gross_cents is null or gross_cents > 0),
  fee_cents integer check (fee_cents is null or fee_cents >= 0),
  net_cents integer,
  source text not null default 'api' check (source in ('api', 'manual')),
  fee_breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(fee_breakdown) = 'array'),
  money_release_date date,
  attempts integer not null default 0 check (attempts between 0 and 50),
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_]{1,40}$'),
  refund_checked_at timestamptz,
  note text check (note is null or (char_length(note) between 1 and 140 and note !~ '[\r\n]')),
  set_by uuid,          -- sem FK: não travar exclusão de conta (pendência M-2 da fase 2)
  set_by_name text,
  fetched_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint order_payment_fees_known_check check (
    (fee_cents is null) = (gross_cents is null) and (fee_cents is null) = (net_cents is null)
  ),
  constraint order_payment_fees_sum_check check (fee_cents is null or gross_cents = fee_cents + net_cents),
  constraint order_payment_fees_manual_check check (
    source = 'api' or (fee_cents is not null and set_by is not null and set_by_name is not null)
  )
);
alter table public.order_payment_fees enable row level security;
revoke all on table public.order_payment_fees from public, anon, authenticated, service_role;
create trigger order_payment_fees_no_delete
  before delete on public.order_payment_fees
  for each row execute function public.reject_finance_record_change();
create trigger order_payment_fees_no_truncate
  before truncate on public.order_payment_fees
  for each statement execute function public.reject_finance_record_change();

-- Pedidos que pagam tarifa: chegaram a ser pagos, valor > 0, pelo banco de pagamento.
create function public.order_has_bank_fee(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.status in ('pago', 'estornado', 'aguardando_decisao')
      and o.total_cents > 0
      and o.payment_provider = 'mercadopago'
  );
$$;

create function public.record_payment_fee(
  p_order_id uuid, p_gross_cents integer, p_fee_cents integer,
  p_breakdown jsonb, p_release_date date, p_after_refund boolean
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_total integer;
  v_current public.order_payment_fees%rowtype;
begin
  if not public.order_has_bank_fee(p_order_id) then
    return 'ignorado';
  end if;
  select o.total_cents into v_total from public.orders o where o.id = p_order_id for update;
  if p_gross_cents is distinct from v_total then
    raise exception 'TARIFA_VALOR: bruto diferente do total do pedido.';
  end if;
  if p_fee_cents is null or p_fee_cents < 0 or p_fee_cents > p_gross_cents then
    raise exception 'TARIFA_VALOR: tarifa fora do intervalo.';
  end if;
  if p_breakdown is null or jsonb_typeof(p_breakdown) <> 'array' or jsonb_array_length(p_breakdown) > 10 then
    raise exception 'TARIFA_VALOR: detalhamento inválido.';
  end if;
  select * into v_current from public.order_payment_fees f where f.order_id = p_order_id;
  if v_current.source = 'manual' then
    return 'manual';
  end if;
  insert into public.order_payment_fees as f (
    order_id, gross_cents, fee_cents, net_cents, source, fee_breakdown, money_release_date,
    attempts, last_error, refund_checked_at, fetched_at, updated_at
  ) values (
    p_order_id, p_gross_cents, p_fee_cents, p_gross_cents - p_fee_cents, 'api', p_breakdown, p_release_date,
    0, null, case when p_after_refund then now() end, now(), now()
  )
  on conflict (order_id) do update set
    gross_cents = excluded.gross_cents,
    fee_cents = excluded.fee_cents,
    net_cents = excluded.net_cents,
    fee_breakdown = excluded.fee_breakdown,
    money_release_date = coalesce(excluded.money_release_date, f.money_release_date),
    attempts = 0,
    last_error = null,
    refund_checked_at = coalesce(excluded.refund_checked_at, f.refund_checked_at),
    fetched_at = now(),
    updated_at = now();
  return 'salvo';
end;
$$;

create function public.record_payment_fee_failure(p_order_id uuid, p_code text)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text := case when p_code ~ '^[a-z0-9_]{1,40}$' then p_code else 'erro' end;
  v_attempts integer;
begin
  if not public.order_has_bank_fee(p_order_id) then
    return 0;
  end if;
  insert into public.order_payment_fees as f (order_id, attempts, last_error, updated_at)
  values (p_order_id, 1, v_code, now())
  on conflict (order_id) do update set
    attempts = least(f.attempts + 1, 50),
    last_error = v_code,
    updated_at = now()
  where f.source = 'api'
  returning f.attempts into v_attempts;
  return coalesce(v_attempts, 0);
end;
$$;

-- Fila do cron: sem tarifa (até 5 tentativas) ou estornado sem recaptura (até 5 tentativas).
create function public.orders_missing_fee(p_limit integer)
returns table (order_id uuid, created_at timestamptz, provider_order_id text, after_refund boolean, attempts integer)
language sql stable security definer set search_path = '' as $$
  select o.id, o.created_at, o.provider_order_id,
         (o.status = 'estornado'),
         coalesce(f.attempts, 0)
  from public.orders o
  left join public.order_payment_fees f on f.order_id = o.id
  where o.status in ('pago', 'estornado', 'aguardando_decisao')
    and o.total_cents > 0
    and o.payment_provider = 'mercadopago'
    and coalesce(f.source, 'api') = 'api'
    and coalesce(f.attempts, 0) < 5
    and (f.order_id is null or f.fee_cents is null
         or (o.status = 'estornado' and f.refund_checked_at is null))
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

create function public.record_payment_fee_manual(
  p_admin uuid, p_order_id uuid, p_fee_cents integer, p_note text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_previous integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.assert_finance_admin(p_admin, true);
  if not public.order_has_bank_fee(p_order_id) then
    raise exception 'TARIFA_PEDIDO: Pedido sem tarifa a lançar.';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if p_fee_cents is null or p_fee_cents < 0 or p_fee_cents > v_order.total_cents then
    raise exception 'TARIFA_VALOR: Tarifa fora do intervalo.';
  end if;
  if v_note is null or char_length(v_note) > 140 or v_note ~ '[\r\n]' then
    raise exception 'TARIFA_NOTA: Informe de onde veio o valor (até 140 caracteres).';
  end if;
  select f.fee_cents into v_previous from public.order_payment_fees f where f.order_id = p_order_id;
  insert into public.order_payment_fees as f (
    order_id, gross_cents, fee_cents, net_cents, source, note, set_by, set_by_name,
    attempts, last_error, refund_checked_at, updated_at
  ) values (
    p_order_id, v_order.total_cents, p_fee_cents, v_order.total_cents - p_fee_cents, 'manual', v_note,
    p_admin, public.staff_display_name(p_admin), 0, null, now(), now()
  )
  on conflict (order_id) do update set
    gross_cents = excluded.gross_cents, fee_cents = excluded.fee_cents, net_cents = excluded.net_cents,
    source = 'manual', note = excluded.note, set_by = excluded.set_by, set_by_name = excluded.set_by_name,
    attempts = 0, last_error = null, refund_checked_at = now(), updated_at = now();
  perform public.log_audit(p_admin, 'tarifa_lancada', v_order.event_id, p_order_id,
    (select e.organizer_id from public.events e where e.id = v_order.event_id),
    jsonb_build_object('fee_cents', p_fee_cents, 'previous_fee_cents', v_previous));
  return jsonb_build_object('event_id', v_order.event_id, 'fee_cents', p_fee_cents, 'previous_fee_cents', v_previous);
end;
$$;

create function public.event_fee_pending_orders(p_admin uuid, p_event_id uuid)
returns table (order_id uuid, created_at timestamptz, total_cents integer, status text, attempts integer, last_error text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.assert_finance_admin(p_admin, false);
  return query
  select o.id, o.created_at, o.total_cents, o.status::text, coalesce(f.attempts, 0), f.last_error
  from public.orders o
  left join public.order_payment_fees f on f.order_id = o.id
  where o.event_id = p_event_id
    and public.order_has_bank_fee(o.id)
    and (f.fee_cents is null)
  order by o.created_at;
end;
$$;

-- 2) Calendário -------------------------------------------------------------------
create table public.business_holidays (
  day date primary key,
  name text not null check (char_length(name) between 3 and 80),
  kind text not null check (kind in ('nacional', 'estadual', 'municipal', 'bancario', 'extra')),
  source text not null check (char_length(source) between 3 and 120)
);
alter table public.business_holidays enable row level security;
revoke all on table public.business_holidays from public, anon, authenticated, service_role;

-- Gerado por holidaySeedSql(2026, 2030) de src/lib/finance/business-days.ts (16 por ano).
insert into public.business_holidays (day, name, kind, source) values
  ('2026-01-01', 'Confraternização Universal', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2026-02-16', 'Segunda-feira de Carnaval', 'bancario', 'Resolução CMN 4.880/2020, art. 6º, I'),
  ('2026-02-17', 'Terça-feira de Carnaval', 'bancario', 'Resolução CMN 4.880/2020, art. 6º, I'),
  ('2026-04-03', 'Sexta-feira da Paixão', 'municipal', 'Lei Municipal 1.997/1967; Lei 9.093/1995, art. 2º'),
  ('2026-04-21', 'Tiradentes', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2026-05-01', 'Dia do Trabalho', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2026-06-04', 'Corpus Christi', 'municipal', 'Lei Municipal 1.997/1967; Resolução CMN 4.880/2020, art. 6º, II'),
  ('2026-06-24', 'São João', 'municipal', 'Lei Municipal 1.997/1967'),
  ('2026-07-02', 'Independência da Bahia (Dois de Julho)', 'estadual', 'Constituição do Estado da Bahia, art. 6º, § 3º'),
  ('2026-09-07', 'Independência do Brasil', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2026-10-12', 'Nossa Senhora Aparecida', 'nacional', 'Lei 6.802/1980'),
  ('2026-11-02', 'Finados', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2026-11-15', 'Proclamação da República', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2026-11-20', 'Zumbi e Consciência Negra', 'nacional', 'Lei 14.759/2023'),
  ('2026-12-08', 'Nossa Senhora da Conceição da Praia', 'municipal', 'Lei Municipal 1.997/1967'),
  ('2026-12-25', 'Natal', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2027-01-01', 'Confraternização Universal', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2027-02-08', 'Segunda-feira de Carnaval', 'bancario', 'Resolução CMN 4.880/2020, art. 6º, I'),
  ('2027-02-09', 'Terça-feira de Carnaval', 'bancario', 'Resolução CMN 4.880/2020, art. 6º, I'),
  ('2027-03-26', 'Sexta-feira da Paixão', 'municipal', 'Lei Municipal 1.997/1967; Lei 9.093/1995, art. 2º'),
  ('2027-04-21', 'Tiradentes', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2027-05-01', 'Dia do Trabalho', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2027-05-27', 'Corpus Christi', 'municipal', 'Lei Municipal 1.997/1967; Resolução CMN 4.880/2020, art. 6º, II'),
  ('2027-06-24', 'São João', 'municipal', 'Lei Municipal 1.997/1967'),
  ('2027-07-02', 'Independência da Bahia (Dois de Julho)', 'estadual', 'Constituição do Estado da Bahia, art. 6º, § 3º'),
  ('2027-09-07', 'Independência do Brasil', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2027-10-12', 'Nossa Senhora Aparecida', 'nacional', 'Lei 6.802/1980'),
  ('2027-11-02', 'Finados', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2027-11-15', 'Proclamação da República', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2027-11-20', 'Zumbi e Consciência Negra', 'nacional', 'Lei 14.759/2023'),
  ('2027-12-08', 'Nossa Senhora da Conceição da Praia', 'municipal', 'Lei Municipal 1.997/1967'),
  ('2027-12-25', 'Natal', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2028-01-01', 'Confraternização Universal', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2028-02-28', 'Segunda-feira de Carnaval', 'bancario', 'Resolução CMN 4.880/2020, art. 6º, I'),
  ('2028-02-29', 'Terça-feira de Carnaval', 'bancario', 'Resolução CMN 4.880/2020, art. 6º, I'),
  ('2028-04-14', 'Sexta-feira da Paixão', 'municipal', 'Lei Municipal 1.997/1967; Lei 9.093/1995, art. 2º'),
  ('2028-04-21', 'Tiradentes', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2028-05-01', 'Dia do Trabalho', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2028-06-15', 'Corpus Christi', 'municipal', 'Lei Municipal 1.997/1967; Resolução CMN 4.880/2020, art. 6º, II'),
  ('2028-06-24', 'São João', 'municipal', 'Lei Municipal 1.997/1967'),
  ('2028-07-02', 'Independência da Bahia (Dois de Julho)', 'estadual', 'Constituição do Estado da Bahia, art. 6º, § 3º'),
  ('2028-09-07', 'Independência do Brasil', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2028-10-12', 'Nossa Senhora Aparecida', 'nacional', 'Lei 6.802/1980'),
  ('2028-11-02', 'Finados', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2028-11-15', 'Proclamação da República', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2028-11-20', 'Zumbi e Consciência Negra', 'nacional', 'Lei 14.759/2023'),
  ('2028-12-08', 'Nossa Senhora da Conceição da Praia', 'municipal', 'Lei Municipal 1.997/1967'),
  ('2028-12-25', 'Natal', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2029-01-01', 'Confraternização Universal', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2029-02-12', 'Segunda-feira de Carnaval', 'bancario', 'Resolução CMN 4.880/2020, art. 6º, I'),
  ('2029-02-13', 'Terça-feira de Carnaval', 'bancario', 'Resolução CMN 4.880/2020, art. 6º, I'),
  ('2029-03-30', 'Sexta-feira da Paixão', 'municipal', 'Lei Municipal 1.997/1967; Lei 9.093/1995, art. 2º'),
  ('2029-04-21', 'Tiradentes', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2029-05-01', 'Dia do Trabalho', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2029-05-31', 'Corpus Christi', 'municipal', 'Lei Municipal 1.997/1967; Resolução CMN 4.880/2020, art. 6º, II'),
  ('2029-06-24', 'São João', 'municipal', 'Lei Municipal 1.997/1967'),
  ('2029-07-02', 'Independência da Bahia (Dois de Julho)', 'estadual', 'Constituição do Estado da Bahia, art. 6º, § 3º'),
  ('2029-09-07', 'Independência do Brasil', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2029-10-12', 'Nossa Senhora Aparecida', 'nacional', 'Lei 6.802/1980'),
  ('2029-11-02', 'Finados', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2029-11-15', 'Proclamação da República', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2029-11-20', 'Zumbi e Consciência Negra', 'nacional', 'Lei 14.759/2023'),
  ('2029-12-08', 'Nossa Senhora da Conceição da Praia', 'municipal', 'Lei Municipal 1.997/1967'),
  ('2029-12-25', 'Natal', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2030-01-01', 'Confraternização Universal', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2030-03-04', 'Segunda-feira de Carnaval', 'bancario', 'Resolução CMN 4.880/2020, art. 6º, I'),
  ('2030-03-05', 'Terça-feira de Carnaval', 'bancario', 'Resolução CMN 4.880/2020, art. 6º, I'),
  ('2030-04-19', 'Sexta-feira da Paixão', 'municipal', 'Lei Municipal 1.997/1967; Lei 9.093/1995, art. 2º'),
  ('2030-04-21', 'Tiradentes', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2030-05-01', 'Dia do Trabalho', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2030-06-20', 'Corpus Christi', 'municipal', 'Lei Municipal 1.997/1967; Resolução CMN 4.880/2020, art. 6º, II'),
  ('2030-06-24', 'São João', 'municipal', 'Lei Municipal 1.997/1967'),
  ('2030-07-02', 'Independência da Bahia (Dois de Julho)', 'estadual', 'Constituição do Estado da Bahia, art. 6º, § 3º'),
  ('2030-09-07', 'Independência do Brasil', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2030-10-12', 'Nossa Senhora Aparecida', 'nacional', 'Lei 6.802/1980'),
  ('2030-11-02', 'Finados', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2030-11-15', 'Proclamação da República', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)'),
  ('2030-11-20', 'Zumbi e Consciência Negra', 'nacional', 'Lei 14.759/2023'),
  ('2030-12-08', 'Nossa Senhora da Conceição da Praia', 'municipal', 'Lei Municipal 1.997/1967'),
  ('2030-12-25', 'Natal', 'nacional', 'Lei 662/1949 (redação da Lei 10.607/2002)');

create trigger business_holidays_immutable
  before update or delete on public.business_holidays
  for each row execute function public.reject_finance_record_change();
create trigger business_holidays_no_truncate
  before truncate on public.business_holidays
  for each statement execute function public.reject_finance_record_change();

-- Um ano está cadastrado quando o 1º de janeiro dele está na tabela.
create function public.business_calendar_last_year()
returns integer language sql stable security definer set search_path = '' as $$
  select max(extract(year from h.day))::integer
  from public.business_holidays h
  where extract(month from h.day) = 1 and extract(day from h.day) = 1;
$$;

-- O próprio dia inicial conta, se for útil. Ano sem calendário = null (prazo a confirmar).
create function public.nth_business_day(p_start date, p_n integer)
returns date language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date := p_start;
  v_count integer := 0;
  v_last_year integer := public.business_calendar_last_year();
begin
  if p_start is null or p_n is null or p_n < 1 or p_n > 30 or v_last_year is null then
    return null;
  end if;
  for i in 0..120 loop
    if extract(year from v_day)::integer > v_last_year
       or not exists (select 1 from public.business_holidays h
                      where h.day = make_date(extract(year from v_day)::integer, 1, 1)) then
      return null;
    end if;
    if extract(isodow from v_day) between 1 and 5
       and not exists (select 1 from public.business_holidays h where h.day = v_day) then
      v_count := v_count + 1;
      if v_count = p_n then
        return v_day;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return null;
end;
$$;

create function public.event_payout_due_date(p_event_id uuid)
returns date language sql stable security definer set search_path = '' as $$
  select public.nth_business_day(public.event_fee_due_date(p_event_id), 5);
$$;

-- 3) Permissões --------------------------------------------------------------------
revoke execute on function public.order_has_bank_fee(uuid) from public, anon, authenticated;
revoke execute on function public.record_payment_fee(uuid, integer, integer, jsonb, date, boolean) from public, anon, authenticated;
revoke execute on function public.record_payment_fee_failure(uuid, text) from public, anon, authenticated;
revoke execute on function public.orders_missing_fee(integer) from public, anon, authenticated;
revoke execute on function public.record_payment_fee_manual(uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.event_fee_pending_orders(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.business_calendar_last_year() from public, anon, authenticated;
revoke execute on function public.nth_business_day(date, integer) from public, anon, authenticated;
revoke execute on function public.event_payout_due_date(uuid) from public, anon, authenticated;
grant execute on function public.order_has_bank_fee(uuid) to service_role;
grant execute on function public.record_payment_fee(uuid, integer, integer, jsonb, date, boolean) to service_role;
grant execute on function public.record_payment_fee_failure(uuid, text) to service_role;
grant execute on function public.orders_missing_fee(integer) to service_role;
grant execute on function public.record_payment_fee_manual(uuid, uuid, integer, text) to service_role;
grant execute on function public.event_fee_pending_orders(uuid, uuid) to service_role;
grant execute on function public.business_calendar_last_year() to service_role;
grant execute on function public.nth_business_day(date, integer) to service_role;
grant execute on function public.event_payout_due_date(uuid) to service_role;
