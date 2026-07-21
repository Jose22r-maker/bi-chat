import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 8,
        },
      },
    })
  : null;

export async function uploadFile(file: File, conversationId: string): Promise<string | null> {
  if (!supabase) return null;

  const uniqueName = `${conversationId}/${Date.now()}-${file.name}`;
  
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('attachments')
    .upload(uniqueName, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    console.error('File upload error:', uploadError);
    return null;
  }

  const { data: { publicUrl } } = supabase.storage
    .from('attachments')
    .getPublicUrl(uniqueName);

  return publicUrl;
}

export async function scheduleMessage(
  conversationId: string,
  senderId: string,
  body: string,
  attachmentPath: string | null,
  scheduledAt: Date
) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('scheduled_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      body,
      attachment_path: attachmentPath,
      scheduled_at: scheduledAt.toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('Schedule message error:', error);
    return null;
  }

  return data;
}

export async function executeScheduledMessage(scheduledMsgId: string) {
  if (!supabase) return null;

  const { data: scheduled, error: fetchError } = await supabase
    .from('scheduled_messages')
    .select('*')
    .eq('id', scheduledMsgId)
    .single();

  if (fetchError || !scheduled) {
    console.error('Fetch scheduled message error:', fetchError);
    return null;
  }

  const { error: insertError } = await supabase
    .from('messages')
    .insert({
      conversation_id: scheduled.conversation_id,
      sender_id: scheduled.sender_id,
      body: scheduled.body,
      attachment_path: scheduled.attachment_path,
    });

  if (insertError) {
    console.error('Insert message error:', insertError);
    return null;
  }

  const { error: updateError } = await supabase
    .from('scheduled_messages')
    .update({ executed: true })
    .eq('id', scheduledMsgId);

  if (updateError) {
    console.error('Update scheduled message error:', updateError);
  }

  return true;
}
