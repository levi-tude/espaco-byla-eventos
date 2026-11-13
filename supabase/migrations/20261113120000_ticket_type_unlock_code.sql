-- Código compartilhado para tipos customizados (ex.: bolsista).
-- unlock_code_hash preenchido = tipo oculto no checkout até o código válido.
-- save_event_ticket_types: para tipos custom, unlock_code_op = keep|set|clear.

begin;

alter table public.ticket_types
  add column if not exists unlock_code_hash text
  check (
    unlock_code_hash is null
    or unlock_code_hash ~ '^[0-9a-f]{64}$'
  );

comment on column public.ticket_types.unlock_code_hash is
  'SHA-256 hex do código compartilhado. Null = tipo público no checkout.';

create or replace function public.save_event_ticket_types(
  p_event_id uuid,
  p_types jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_raw text;
  v_id uuid;
  v_preset text;
  v_name text;
  v_kind text;
  v_price integer;
  v_people integer;
  v_max integer;
  v_unlock_op text;
  v_unlock_hash text;
  v_existing public.ticket_types%rowtype;
  v_taken bigint;
  v_ids uuid[] := '{}';
  v_keep_ids uuid[] := '{}';
  v_custom_keep_ids uuid[] := '{}';
  v_presets text[] := '{}';
  v_names text[] := '{}';
  v_display_names text[] := '{}';
  v_kinds text[] := '{}';
  v_prices integer[] := '{}';
  v_peoples integer[] := '{}';
  v_maxes integer[] := '{}';
  v_unlock_ops text[] := '{}';
  v_unlock_hashes text[] := '{}';
  i integer;
begin
  perform 1 from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'TIPOS_EVENTO: Evento não encontrado.';
  end if;
  if p_types is null or jsonb_typeof(p_types) <> 'array'
    or jsonb_array_length(p_types) not between 1 and 20 then
    raise exception 'TIPOS_QUANTIDADE: Cadastre de 1 a 20 tipos de ingresso.';
  end if;

  for v_item in select e.item from jsonb_array_elements(p_types) as e(item) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'TIPOS_INVALIDO: Tipo de ingresso inválido.';
    end if;

    v_preset := null;
    if v_item -> 'preset' is not null and jsonb_typeof(v_item -> 'preset') <> 'null' then
      v_preset := v_item ->> 'preset';
      if jsonb_typeof(v_item -> 'preset') <> 'string'
        or v_preset not in ('inteira', 'meia', 'casadinha', 'familia') then
        raise exception 'TIPOS_INVALIDO: Tipo pronto inválido.';
      end if;
      if v_preset = any(v_presets) then
        raise exception 'TIPOS_INVALIDO: Tipo de ingresso repetido.';
      end if;
    end if;

    if v_preset is not null then
      v_name := case v_preset
        when 'inteira' then 'Inteira'
        when 'meia' then 'Meia-entrada'
        when 'casadinha' then 'Casadinha'
        else 'Pacote família'
      end;
      v_kind := case v_preset when 'meia' then 'meia' else 'inteira' end;
      v_people := case v_preset when 'casadinha' then 2 when 'familia' then 4 else 1 end;
      v_unlock_op := 'clear';
      v_unlock_hash := null;
    else
      v_name := btrim(coalesce(v_item ->> 'name', ''));
      if char_length(v_name) not between 1 and 60 then
        raise exception 'TIPOS_NOME: Nome do tipo inválido.';
      end if;
      if lower(v_name) in (
        'cortesia', 'inteira', 'meia', 'meia-entrada', 'meia entrada',
        'casadinha', 'pacote família', 'pacote familia'
      ) then
        raise exception 'TIPOS_NOME_RESERVADO:%', v_name;
      end if;
      v_kind := 'inteira';

      v_raw := v_item ->> 'people_per_unit';
      if jsonb_typeof(v_item -> 'people_per_unit') is distinct from 'number'
        or v_raw !~ '^[0-9]{1,2}$' then
        raise exception 'TIPOS_PESSOAS: Pessoas por unidade inválido.';
      end if;
      v_people := v_raw::integer;
      if v_people not between 1 and 10 then
        raise exception 'TIPOS_PESSOAS: Pessoas por unidade inválido.';
      end if;

      v_unlock_op := coalesce(nullif(btrim(v_item ->> 'unlock_code_op'), ''), 'keep');
      if v_unlock_op not in ('keep', 'set', 'clear') then
        raise exception 'TIPOS_CODIGO: Operação de código inválida.';
      end if;
      v_unlock_hash := null;
      if v_unlock_op = 'set' then
        v_unlock_hash := lower(btrim(coalesce(v_item ->> 'unlock_code_hash', '')));
        if v_unlock_hash !~ '^[0-9a-f]{64}$' then
          raise exception 'TIPOS_CODIGO: Código de acesso inválido.';
        end if;
      end if;
    end if;

    if lower(v_name) = any(v_names) then
      raise exception 'TIPOS_NOME_REPETIDO:%', v_name;
    end if;

    v_raw := v_item ->> 'price_cents';
    if jsonb_typeof(v_item -> 'price_cents') is distinct from 'number'
      or v_raw !~ '^[0-9]{1,9}$' then
      raise exception 'TIPOS_PRECO: Preço inválido.';
    end if;
    v_price := v_raw::integer;
    if v_price not between 1 and 10000000 then
      raise exception 'TIPOS_PRECO: Preço inválido.';
    end if;

    v_max := null;
    if v_item -> 'max_units' is not null and jsonb_typeof(v_item -> 'max_units') <> 'null' then
      v_raw := v_item ->> 'max_units';
      if jsonb_typeof(v_item -> 'max_units') <> 'number' or v_raw !~ '^[0-9]{1,6}$' then
        raise exception 'TIPOS_LIMITE: Limite inválido.';
      end if;
      v_max := v_raw::integer;
      if v_max not between 1 and 100000 then
        raise exception 'TIPOS_LIMITE: Limite inválido.';
      end if;
    end if;

    v_id := null;
    if v_preset is not null then
      select * into v_existing
      from public.ticket_types tt
      where tt.event_id = p_event_id and tt.preset = v_preset
      order by (tt.archived_at is null) desc, tt.archived_at desc nulls first
      limit 1
      for update;
      if found then
        v_id := v_existing.id;
      end if;
    elsif v_item -> 'id' is not null and jsonb_typeof(v_item -> 'id') <> 'null' then
      v_raw := v_item ->> 'id';
      if jsonb_typeof(v_item -> 'id') <> 'string'
        or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'TIPOS_INVALIDO: Tipo de ingresso inválido.';
      end if;
      v_id := v_raw::uuid;
      if v_id = any(v_keep_ids) then
        raise exception 'TIPOS_INVALIDO: Tipo de ingresso repetido.';
      end if;

      select * into v_existing
      from public.ticket_types tt
      where tt.id = v_id
        and tt.event_id = p_event_id
        and tt.archived_at is null
        and tt.preset is null
        and tt.kind <> 'cortesia'
      for update;
      if not found then
        raise exception 'TIPOS_DESATUALIZADO: Tipo não encontrado.';
      end if;

      if v_existing.people_per_unit <> v_people and exists (
        select 1 from public.order_items oi where oi.ticket_type_id = v_id
      ) then
        raise exception 'TIPOS_PESSOAS_COM_VENDAS:%', v_existing.name;
      end if;
      v_custom_keep_ids := v_custom_keep_ids || v_id;
    end if;

    if v_preset is null and v_unlock_op = 'keep' and v_id is null then
      -- Tipo novo sem código: fica público.
      v_unlock_op := 'clear';
    end if;
    if v_preset is null and v_unlock_op = 'keep' and v_id is not null
       and v_existing.unlock_code_hash is null then
      v_unlock_op := 'clear';
    end if;
    if v_preset is null and v_unlock_op = 'set' and v_id is null then
      null; -- ok
    end if;

    if v_id is not null then
      if v_max is not null then
        v_taken := public.ticket_type_units_taken(v_id);
        if v_max < v_taken then
          raise exception 'TIPOS_LIMITE_MENOR:%:%', v_taken, v_name;
        end if;
      end if;
      v_keep_ids := v_keep_ids || v_id;
    end if;

    v_ids := v_ids || v_id;
    v_presets := v_presets || v_preset;
    v_names := v_names || lower(v_name);
    v_display_names := v_display_names || v_name;
    v_kinds := v_kinds || v_kind;
    v_prices := v_prices || v_price;
    v_peoples := v_peoples || v_people;
    v_maxes := v_maxes || v_max;
    v_unlock_ops := v_unlock_ops || v_unlock_op;
    v_unlock_hashes := v_unlock_hashes || v_unlock_hash;
  end loop;

  update public.ticket_types tt
  set archived_at = now(),
      active = false
  where tt.event_id = p_event_id
    and tt.archived_at is null
    and tt.kind <> 'cortesia'
    and not (tt.id = any(v_keep_ids));

  update public.ticket_types tt
  set name = '~' || tt.id::text
  where tt.id = any(v_custom_keep_ids);

  for i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    if v_ids[i] is not null then
      update public.ticket_types tt
      set name = v_display_names[i],
          price_cents = v_prices[i],
          people_per_unit = v_peoples[i],
          max_units = v_maxes[i],
          sort_order = i - 1,
          archived_at = null,
          active = true,
          unlock_code_hash = case v_unlock_ops[i]
            when 'set' then v_unlock_hashes[i]
            when 'clear' then null
            else tt.unlock_code_hash
          end
      where tt.id = v_ids[i];
    else
      insert into public.ticket_types (
        event_id, kind, preset, name, price_cents, people_per_unit, max_units,
        sort_order, active, unlock_code_hash
      ) values (
        p_event_id, v_kinds[i]::public.ticket_kind, v_presets[i], v_display_names[i],
        v_prices[i], v_peoples[i], v_maxes[i], i - 1, true,
        case when v_unlock_ops[i] = 'set' then v_unlock_hashes[i] else null end
      );
    end if;
  end loop;

  if not exists (
    select 1 from public.ticket_types tt
    where tt.event_id = p_event_id and tt.kind = 'cortesia' and tt.archived_at is null
  ) then
    insert into public.ticket_types (
      event_id, kind, name, price_cents, people_per_unit, sort_order, active
    ) values (p_event_id, 'cortesia', 'Cortesia', 0, 1, 1000, true);
  end if;
end;
$$;

commit;
