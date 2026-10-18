-- =====================================================================
-- Poker Podium — esquema para Supabase
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run.
-- Es seguro volver a ejecutarlo (no borra datos).
-- =====================================================================

-- ---------- Tablas ----------

create table if not exists public.players (
  id          bigint generated always as identity primary key,
  name        text not null check (length(trim(name)) > 0),
  nickname    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists players_name_key on public.players (lower(name));

create table if not exists public.settings (
  key    text primary key,
  value  text
);

-- places = arreglo JSON de porcentajes por posición, ej. [50,30,20].
-- Lo que falte para 100% va al fondo de fin de año.
create or replace function public.places_valid(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) > 0
     and (select bool_and(value::numeric > 0) and sum(value::numeric) <= 100
          from jsonb_array_elements_text(p))
$$;

create table if not exists public.payout_templates (
  id      bigint generated always as identity primary key,
  name    text not null,
  places  jsonb not null check (public.places_valid(places))
);

-- Cada partida guarda su propia configuración: cambiar los valores por defecto no altera el historial.
create table if not exists public.games (
  id          bigint generated always as identity primary key,
  date        date not null default current_date,
  location    text,
  buy_in      integer not null check (buy_in >= 0),
  rebuy       integer not null check (rebuy >= 0),
  dealer_fee  integer not null default 0 check (dealer_fee >= 0),
  places      jsonb not null default '[100]' check (public.places_valid(places)),
  rounding    integer not null default 0 check (rounding >= 0),
  status      text not null default 'open' check (status in ('open', 'finished')),
  seating     jsonb,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists games_date_idx on public.games (date);

create table if not exists public.entries (
  id              bigint generated always as identity primary key,
  game_id         bigint not null references public.games (id) on delete cascade,
  player_id       bigint not null references public.players (id),
  rebuys          integer not null default 0 check (rebuys >= 0),
  position        integer check (position is null or position >= 1),
  prize_override  integer check (prize_override is null or prize_override >= 0),
  paid            boolean not null default false,
  unique (game_id, player_id)
);
create index if not exists entries_player_idx on public.entries (player_id);

-- Movimientos manuales del fondo: negativo = gasto, positivo = aporte extra.
create table if not exists public.fund_movements (
  id           bigint generated always as identity primary key,
  date         date not null,
  amount       integer not null check (amount <> 0),
  description  text
);

-- Correos con permiso de edición. Solo se administra desde el SQL Editor.
create table if not exists public.admins (
  email  text primary key
);

-- ---------- Seguridad ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

grant usage on schema public to anon, authenticated;
grant select on public.players, public.settings, public.payout_templates,
                public.games, public.entries, public.fund_movements to anon, authenticated;
grant insert, update, delete on public.players, public.settings, public.payout_templates,
                public.games, public.entries, public.fund_movements to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- Lectura pública; escritura solo para usuarios cuyo correo esté en public.admins.
do $$
declare t text;
begin
  foreach t in array array['players', 'settings', 'payout_templates', 'games', 'entries', 'fund_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "lectura publica" on public.%I', t);
    execute format('create policy "lectura publica" on public.%I for select using (true)', t);
    execute format('drop policy if exists "escritura admins" on public.%I', t);
    execute format(
      'create policy "escritura admins" on public.%I for all to authenticated
         using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

alter table public.admins enable row level security;  -- sin políticas: nadie la lee desde la app

-- ---------- Datos iniciales ----------

insert into public.settings (key, value) values
  ('group_name', 'Poker Podium'),
  ('buy_in', '10000'),
  ('rebuy', '10000'),
  ('dealer_fee', '2000'),
  ('rounding', '1000'),
  ('seats_per_table', '9'),
  ('default_template_id', '')
on conflict (key) do nothing;

insert into public.payout_templates (name, places)
select v.name, v.places::jsonb
from (values
  ('Solo 1° (100%)', '[100]'),
  ('Top 2 (65 / 35)', '[65,35]'),
  ('Top 3 (50 / 30 / 20)', '[50,30,20]'),
  ('1° 70% + 30% al fondo', '[70]')
) as v (name, places)
where not exists (select 1 from public.payout_templates);

update public.settings
set value = (select id::text from public.payout_templates where name = '1° 70% + 30% al fondo' limit 1)
where key = 'default_template_id' and coalesce(value, '') = '';

-- ---------- Administradores ----------
-- Agrega el correo de cada persona que puede editar (cámbialo por el real) y ejecuta:
--
--   insert into public.admins (email) values ('tu-correo@ejemplo.com') on conflict do nothing;
--
-- Luego crea su usuario en Authentication → Users → Add user (con "Auto Confirm User").
