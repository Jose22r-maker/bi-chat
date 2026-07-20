create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  qr_id text not null unique,
  display_name text not null default 'Usuario',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.conversation_role as enum ('owner', 'member');

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.conversation_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  attachment_path text,
  created_at timestamptz not null default now()
);

create index if not exists conversation_members_user_idx on public.conversation_members(user_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists profiles_username_idx on public.profiles(username);
create index if not exists profiles_qr_id_idx on public.profiles(qr_id);

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create or replace function public.is_conversation_member(conversation_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversation_members
    where conversation_id = conversation_uuid
      and user_id = auth.uid()
  );
$$;

create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

create or replace function public.add_conversation_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.conversation_members(conversation_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_conversation_created
after insert on public.conversations
for each row execute function public.add_conversation_owner();

create trigger on_message_created
after insert on public.messages
for each row execute function public.touch_conversation();

create policy "profiles_select_members"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.conversation_members mine
    join public.conversation_members theirs
      on theirs.conversation_id = mine.conversation_id
    where mine.user_id = auth.uid()
      and theirs.user_id = profiles.id
  )
);

create policy "profiles_select_authenticated_search"
on public.profiles for select
to authenticated
using (true);

create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "conversations_select_member"
on public.conversations for select
to authenticated
using (created_by = auth.uid() or public.is_conversation_member(id));

create policy "conversations_insert_own"
on public.conversations for insert
to authenticated
with check (created_by = auth.uid());

create policy "conversations_update_owner"
on public.conversations for update
to authenticated
using (
  exists (
    select 1
    from public.conversation_members
    where conversation_id = conversations.id
      and user_id = auth.uid()
      and role = 'owner'
  )
);

create policy "members_select_own_conversations"
on public.conversation_members for select
to authenticated
using (public.is_conversation_member(conversation_id));

create policy "members_insert_owner"
on public.conversation_members for insert
to authenticated
with check (
  exists (
    select 1
    from public.conversation_members
    where conversation_id = conversation_members.conversation_id
      and user_id = auth.uid()
      and role = 'owner'
  )
);

create policy "messages_select_member"
on public.messages for select
to authenticated
using (public.is_conversation_member(conversation_id));

create policy "messages_insert_member"
on public.messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
);

alter publication supabase_realtime add table public.messages;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "attachments_read_member"
on storage.objects for select
to authenticated
using (
  bucket_id = 'attachments'
  and public.is_conversation_member((storage.foldername(name))[1]::uuid)
);

create policy "attachments_insert_member"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'attachments'
  and public.is_conversation_member((storage.foldername(name))[1]::uuid)
);

create or replace function public.add_message(conversation_uuid uuid, body text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  new_row public.messages%rowtype;
begin
  insert into public.messages (conversation_id, sender_id, body)
  values (conversation_uuid, auth.uid(), body)
  returning * into new_row;
  return new_row;
end;
$$;

grant execute on function public.add_message(uuid, text) to authenticated;
