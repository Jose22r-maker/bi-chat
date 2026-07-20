alter table public.profiles
add column if not exists username text,
add column if not exists qr_id text;

update public.profiles
set
  username = coalesce(nullif(username, ''), left(id::text, 8)),
  qr_id = coalesce(nullif(qr_id, ''), left(id::text, 8))
where username is null
   or qr_id is null
   or username = ''
   or qr_id = '';

alter table public.profiles
alter column username set not null,
alter column qr_id set not null;

create unique index if not exists profiles_username_unique_idx on public.profiles(username);
create unique index if not exists profiles_qr_id_unique_idx on public.profiles(qr_id);
create index if not exists profiles_username_idx on public.profiles(username);
create index if not exists profiles_qr_id_idx on public.profiles(qr_id);

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_select_authenticated_search'
  ) then
    create policy "profiles_select_authenticated_search"
    on public.profiles for select
    to authenticated
    using (true);
  end if;
end $$;
