-- Fotos dos eventos: capa enviada pela equipe e galeria (até 10 por evento).
-- Leitura pública só pelas URLs do bucket; escrita só pelo servidor (service_role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-media',
  'event-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.event_images (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  constraint event_images_path_format check (
    storage_path ~ (
      '^events/' || event_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$'
    )
  )
);

create index event_images_event_created_idx
  on public.event_images (event_id, created_at);

alter table public.event_images enable row level security;
revoke all on table public.event_images from public, anon, authenticated;
grant select on table public.event_images to anon, authenticated;

create policy event_images_public_read on public.event_images
  for select using (
    exists (
      select 1
      from public.events e
      where e.id = event_id and e.sales_open = true
    )
    or public.is_staff()
  );

create or replace function public.enforce_event_images_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Serializa envios do mesmo evento para a contagem não estourar o limite.
  perform pg_advisory_xact_lock(hashtextextended('event_images:' || new.event_id::text, 0));

  select count(*) into v_count
  from public.event_images
  where event_id = new.event_id;

  if v_count >= 10 then
    raise exception 'Limite de 10 fotos por evento atingido.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_event_images_limit() from public, anon, authenticated;

create trigger event_images_limit
  before insert on public.event_images
  for each row execute function public.enforce_event_images_limit();
