-- Improved Supabase schema and enhancements
-- File: supabase/schema_improved.sql
-- Purpose: Full schema (tables, indexes, RLS) plus a separated 'IMPROVEMENTS' section
-- Instructions: Run this in the Supabase SQL editor or via psql to create schema and helpers.

begin;

-- ==========================
-- Extensions
-- ==========================
create extension if not exists "pgcrypto";

-- ==========================
-- Tables: public.profiles
-- ==========================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  qr_id text not null unique,
  display_name text not null default 'Usuario',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ==========================
-- Tables: public.conversations
-- ==========================
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_role') THEN
    CREATE TYPE public.conversation_role AS ENUM ('owner', 'member');
  END IF;
END
$$;

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

-- ==========================
-- Indexes
-- ==========================
create index if not exists conversation_members_user_idx on public.conversation_members(user_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists profiles_username_idx on public.profiles(username);
create index if not exists profiles_qr_id_idx on public.profiles(qr_id);

-- ==========================
-- Enable Row Level Security
-- ==========================
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- ==========================
-- Utility functions and triggers
-- ==========================
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

-- ==========================
-- Policies (RLS)
-- ==========================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'profiles_select_members' AND polrelid = 'public.profiles'::regclass
  ) THEN
    CREATE POLICY "profiles_select_members"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
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
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'profiles_select_authenticated_search' AND polrelid = 'public.profiles'::regclass
  ) THEN
    CREATE POLICY "profiles_select_authenticated_search"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'profiles_insert_own' AND polrelid = 'public.profiles'::regclass
  ) THEN
    CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (id = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'profiles_update_own' AND polrelid = 'public.profiles'::regclass
  ) THEN
    CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'conversations_select_member' AND polrelid = 'public.conversations'::regclass
  ) THEN
    CREATE POLICY "conversations_select_member"
    ON public.conversations FOR SELECT
    TO authenticated
    USING (created_by = auth.uid() or public.is_conversation_member(id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'conversations_insert_own' AND polrelid = 'public.conversations'::regclass
  ) THEN
    CREATE POLICY "conversations_insert_own"
    ON public.conversations FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'conversations_update_owner' AND polrelid = 'public.conversations'::regclass
  ) THEN
    CREATE POLICY "conversations_update_owner"
    ON public.conversations FOR UPDATE
    TO authenticated
    USING (
      exists (
        select 1
        from public.conversation_members
        where conversation_id = conversations.id
          and user_id = auth.uid()
          and role = 'owner'
      )
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'members_select_own_conversations' AND polrelid = 'public.conversation_members'::regclass
  ) THEN
    CREATE POLICY "members_select_own_conversations"
    ON public.conversation_members FOR SELECT
    TO authenticated
    USING (public.is_conversation_member(conversation_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'members_insert_owner' AND polrelid = 'public.conversation_members'::regclass
  ) THEN
    CREATE POLICY "members_insert_owner"
    ON public.conversation_members FOR INSERT
    TO authenticated
    WITH CHECK (
      exists (
        select 1
        from public.conversation_members
        where conversation_id = conversation_members.conversation_id
          and user_id = auth.uid()
          and role = 'owner'
      )
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'messages_select_member' AND polrelid = 'public.messages'::regclass
  ) THEN
    CREATE POLICY "messages_select_member"
    ON public.messages FOR SELECT
    TO authenticated
    USING (public.is_conversation_member(conversation_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'messages_insert_member' AND polrelid = 'public.messages'::regclass
  ) THEN
    CREATE POLICY "messages_insert_member"
    ON public.messages FOR INSERT
    TO authenticated
    WITH CHECK (
      sender_id = auth.uid()
      and public.is_conversation_member(conversation_id)
    );
  END IF;
END
$$;

-- Realtime publication used by Supabase
alter publication supabase_realtime add table public.messages;

-- ==========================
-- Storage: attachments bucket and policies
-- ==========================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy if not exists "attachments_read_member"
on storage.objects for select
to authenticated
using (
  bucket_id = 'attachments'
  and public.is_conversation_member((storage.foldername(name))[1]::uuid)
);

create policy if not exists "attachments_insert_member"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'attachments'
  and public.is_conversation_member((storage.foldername(name))[1]::uuid)
);

-- ==========================
-- IMPROVEMENTS (separated)
-- 1) RPC helper to add a message server-side (uses auth.uid() so it's RLS-safe)
-- 2) Grant execute for authenticated role to avoid 403s when calling RPC
-- ==========================
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

commit;

-- End of file
