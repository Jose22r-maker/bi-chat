// Scheduled message execution
import type { ScheduledMessage } from './types';
import { isSupabaseConfigured, supabase } from './supabase';

export async function checkAndExecuteScheduledMessages() {
  if (!isSupabaseConfigured || !supabase) return;

  const now = new Date().toISOString();
  
  // Get pending scheduled messages
  const { data: scheduledMessages, error } = await supabase
    .from('scheduled_messages')
    .select('*')
    .eq('executed', false)
    .lte('scheduled_at', now)
    .limit(50);

  if (error) {
    console.error('Error fetching scheduled messages. Please verify the table "scheduled_messages" exists in Supabase and that RLS policies allow access:', error);
    return;
  }

  if (!scheduledMessages || scheduledMessages.length === 0) return;

  // Execute each message
  for (const msg of scheduledMessages) {
    await executeMessage(msg);
  }
}

async function executeMessage(scheduledMsg: ScheduledMessage) {
  if (!isSupabaseConfigured || !supabase) {
    console.error('Supabase not configured');
    return;
  }
  
  // Insert into messages table
  const { error: insertError } = await supabase
    .from('messages')
    .insert({
      conversation_id: scheduledMsg.conversation_id,
      sender_id: scheduledMsg.sender_id,
      body: scheduledMsg.body,
      attachment_path: scheduledMsg.attachment_path,
    });

  if (insertError) {
    console.error('Error inserting scheduled message:', insertError);
    return;
  }

  // Mark as executed
  const { error: updateError } = await supabase
    .from('scheduled_messages')
    .update({ executed: true })
    .eq('id', scheduledMsg.id);

  if (updateError) {
    console.error('Error marking scheduled message as executed:', updateError);
  }
}

// Run scheduled check every 30 seconds
let checkInterval: number | null = null;

export function startScheduler() {
  if (checkInterval) return;
  
  // Run immediately on start
  checkAndExecuteScheduledMessages();
  
  checkInterval = window.setInterval(checkAndExecuteScheduledMessages, 30000);
}

export function stopScheduler() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}