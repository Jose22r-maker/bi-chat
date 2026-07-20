-- Script de parche para Supabase
-- Corrige la política RLS que bloquea la creación de conversaciones

drop policy if exists "conversations_select_member" on public.conversations;

create policy "conversations_select_member"
on public.conversations for select
to authenticated
using (created_by = auth.uid() or public.is_conversation_member(id));
