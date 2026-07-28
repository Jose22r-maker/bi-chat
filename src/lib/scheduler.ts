import { supabase, isSupabaseConfigured } from './supabase';

export async function checkAndExecuteScheduledMessages() {
  if (!isSupabaseConfigured || !supabase) return;
  const now = new Date().toISOString();
  const { data: scheduled, error } = await supabase
    .from('scheduled_messages')
    .select('*')
    .eq('executed', false)
    .lte('scheduled_at', now)
    .limit(50);
  if (error || !scheduled || scheduled.length === 0) return;
  for (const msg of scheduled) {
    const { error: insertErr } = await supabase.from('messages').insert({
      conversation_id: msg.conversation_id,
      sender_id: msg.sender_id,
      body: msg.body,
      attachment_path: msg.attachment_path,
    });
    if (!insertErr) {
      await supabase.from('scheduled_messages').update({ executed: true }).eq('id', msg.id);
    }
  }
}

let checkInterval: number | null = null;

export function startScheduler() {
  if (checkInterval) return;
  checkAndExecuteScheduledMessages();
  checkInterval = window.setInterval(checkAndExecuteScheduledMessages, 30000);
}

export function stopScheduler() {
  if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
}
