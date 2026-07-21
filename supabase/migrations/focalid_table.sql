-- Crear tabla x21_users para sistema FOCALID
create table if not exists public.x21_users (
  focalid text primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Habilitar RLS
alter table public.x21_users enable row level security;

-- Políticas de seguridad
create policy "x21_users_select_own"
on public.x21_users for select
to authenticated
using (
  email = auth.email()
);

create policy "x21_users_insert_authenticated"
on public.x21_users for insert
to authenticated
with check (true);

create policy "x21_users_update_own"
on public.x21_users for update
to authenticated
using (
  email = auth.email()
);