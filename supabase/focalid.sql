-- Tabla de usuarios con FOCALID
create table if not exists public.x21_users (
  focalid text primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Habilitar RLS
alter table public.x21_users enable row level security;

-- Función para generar FOCALID único (8 caracteres alfanuméricos)
create or replace function public.generate_focalid(base_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  focalid text;
  exists_count int;
  attempts int := 0;
begin
  loop
    -- Generar FOCALID aleatorio de 8 caracteres alfanuméricos
    focalid := lower(left(encode(gen_random_bytes(6), 'base64'), 8));
    focalid := translate(focalid, '+/=', 'abc');
    
    -- Verificar que no exista
    select count(*) into exists_count from public.x21_users where focalid = focalid;
    
    if exists_count = 0 then
      return focalid;
    end if;
    
    attempts := attempts + 1;
    exit when attempts >= 10; -- Evitar bucle infinito
  end loop;
  
  -- Fallback: usar hash del email
  return lower(left(encode(sha256(base_email::bytea), 'hex'), 8));
end;
$$;

-- Política de acceso para x21_users
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

-- Trigger para eliminar FOCALID al eliminar usuario de auth
create or replace function public.delete_x21_user_on_auth_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.x21_users where email = old.email;
  return old;
end;
$$;

create trigger on_auth_user_deleted
after delete on auth.users
for each row execute function public.delete_x21_user_on_auth_delete();