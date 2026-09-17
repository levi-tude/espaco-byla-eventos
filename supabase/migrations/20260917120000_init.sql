create extension if not exists "pgcrypto";

create type public.ticket_kind as enum ('inteira', 'meia', 'cortesia');
create type public.ticket_status as enum ('nao_pago', 'pago', 'cancelado', 'check_in');
create type public.order_status as enum ('pendente', 'pago', 'cancelado', 'expirado');

create table public.staff_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  venue text not null,
  starts_at timestamptz not null,
  capacity int not null check (capacity > 0),
  cover_image_url text,
  sales_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind public.ticket_kind not null,
  price_cents int not null check (price_cents >= 0),
  active boolean not null default true,
  unique (event_id, kind)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text,
  total_cents int not null check (total_cents >= 0),
  status public.order_status not null default 'pendente',
  public_token text not null unique,
  payment_provider text,
  payment_external_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create unique index orders_payment_external_id_uidx
  on public.orders (payment_provider, payment_external_id)
  where payment_external_id is not null;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  event_id uuid not null references public.events (id),
  ticket_type_id uuid not null references public.ticket_types (id),
  kind public.ticket_kind not null,
  status public.ticket_status not null default 'nao_pago',
  code text not null unique,
  buyer_name text not null,
  price_cents int not null,
  checked_in_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create index tickets_event_id_idx on public.tickets (event_id);
create index tickets_status_idx on public.tickets (status);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_profiles sp where sp.user_id = auth.uid()
  );
$$;

alter table public.staff_profiles enable row level security;
alter table public.events enable row level security;
alter table public.ticket_types enable row level security;
alter table public.orders enable row level security;
alter table public.tickets enable row level security;

create policy events_public_read on public.events
  for select using (sales_open = true or public.is_staff());

create policy events_staff_write on public.events
  for all using (public.is_staff()) with check (public.is_staff());

create policy ticket_types_public_read on public.ticket_types
  for select using (
    kind <> 'cortesia' and active = true
    and exists (
      select 1
      from public.events e
      where e.id = event_id and e.sales_open = true
    )
    or public.is_staff()
  );

create policy ticket_types_staff_write on public.ticket_types
  for all using (public.is_staff()) with check (public.is_staff());

create policy staff_profiles_self on public.staff_profiles
  for select using (user_id = auth.uid() or public.is_staff());

create policy orders_staff on public.orders
  for all using (public.is_staff()) with check (public.is_staff());

create policy tickets_staff on public.tickets
  for all using (public.is_staff()) with check (public.is_staff());
