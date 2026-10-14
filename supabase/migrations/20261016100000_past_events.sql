-- Eventos passados: depois que acontecem, continuam visíveis no site
-- (página inicial e página do evento), sem compra e sem preços.

alter table public.events
  add column published_at timestamptz,
  add column hidden_from_past boolean not null default false;

-- Eventos que já estão à venda contam como publicados.
update public.events
set published_at = created_at
where sales_open = true and published_at is null;

-- "Publicado" = vendas abertas pelo menos uma vez. Marca na primeira abertura
-- e nunca mais muda; ninguém grava a data à mão.
create function public.events_mark_published()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.published_at is not null then
    new.published_at := old.published_at;
  elsif new.sales_open then
    new.published_at := now();
  else
    new.published_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.events_mark_published() from public, anon, authenticated;

create trigger events_mark_published
  before insert or update on public.events
  for each row execute function public.events_mark_published();

-- Passado = publicado, não escondido, com sessão ativa, a partir do dia seguinte
-- (Brasília) ao fim da última sessão — a mesma data em que vira "A pagar".
create function public.event_is_past(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.published_at is not null
      and not e.hidden_from_past
      and exists (
        select 1 from public.event_sessions s
        where s.event_id = e.id and s.status = 'ativa' and s.archived_at is null
      )
      and (now() at time zone 'America/Sao_Paulo')::date >= public.event_fee_due_date(e.id)
  );
$$;

revoke all on function public.event_is_past(uuid) from public, anon, authenticated;
grant execute on function public.event_is_past(uuid) to anon, authenticated;

-- Lista da página inicial: só campos públicos, do mais recente para o mais antigo.
-- A página pede um a mais que o limite para saber se mostra "Ver mais".
create function public.public_past_events(p_limit integer)
returns table (
  id uuid,
  slug text,
  name text,
  venue text,
  cover_image_url text,
  session_starts timestamptz[],
  last_session_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.slug,
    e.name,
    e.venue,
    e.cover_image_url,
    array_agg(s.starts_at order by s.starts_at),
    max(coalesce(s.ends_at, s.starts_at)) as last_session_at
  from public.events e
  join public.event_sessions s
    on s.event_id = e.id and s.status = 'ativa' and s.archived_at is null
  where public.event_is_past(e.id)
  group by e.id
  order by last_session_at desc, e.id
  limit least(greatest(coalesce(p_limit, 12), 1), 121);
$$;

revoke all on function public.public_past_events(integer) from public, anon, authenticated;
grant execute on function public.public_past_events(integer) to anon, authenticated;

-- Leitura pública passa a incluir eventos passados (preços continuam fechados).
alter policy events_public_read on public.events
  using (sales_open = true or public.event_is_past(id) or public.is_staff());

alter policy event_images_public_read on public.event_images
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_id and (e.sales_open = true or public.event_is_past(e.id))
    )
    or public.is_staff()
  );

alter policy event_sessions_public_read on public.event_sessions
  using (
    (
      archived_at is null
      and exists (
        select 1 from public.events e
        where e.id = event_id and (e.sales_open = true or public.event_is_past(e.id))
      )
    )
    or public.is_staff()
  );
