import { supabase } from './supabase';

export interface ParsedCommand {
  type: string;
  raw: string;
  params: string[];
  body?: string;
}

export function parseCommand(input: string): ParsedCommand | null {
  if (!input.startsWith('/')) return null;
  const parts = input.match(/^\/(\w+)(?:=([^=]+))?(?:\s+(.*))?$/);
  if (!parts) return null;
  const [, command, paramsRaw, body] = parts;
  const params = paramsRaw ? paramsRaw.split(',').map((p) => p.trim()) : [];
  return { type: command.toLowerCase(), raw: input, params, body: body?.trim() };
}

export async function executeCommand(
  command: ParsedCommand,
  conversationId: string,
  senderId: string,
): Promise<{ type: 'success' | 'error'; message?: string }> {
  async function sendMessage(text: string) {
    if (!supabase) return;
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: senderId,
      body: text,
    });
  }

  switch (command.type) {
    case 'future': {
      const [duration] = command.params;
      if (!duration) return { type: 'error', message: 'Uso: /future=1M (1 minuto)' };
      const match = duration.match(/^(\d+)([SMH])$/i);
      if (!match) return { type: 'error', message: 'Formato: 1M=min, 5S=seg, 2H=horas' };
      const [, value, unit] = match;
      const ms = parseInt(value) * (unit.toUpperCase() === 'S' ? 1000 : unit.toUpperCase() === 'M' ? 60000 : 3600000);
      const msg = command.body || 'Mensaje programado';
      if (supabase) {
        await supabase.from('scheduled_messages').insert({
          conversation_id: conversationId,
          sender_id: senderId,
          body: msg,
          scheduled_at: new Date(Date.now() + ms).toISOString(),
        });
      }
      return { type: 'success', message: `Mensaje programado para ${duration}` };
    }

    case 'onevision': {
      const [durStr] = command.params;
      const seconds = parseInt(durStr);
      if (!seconds || seconds < 1) return { type: 'error', message: 'Uso: /onevision=5 (5 segundos)' };
      const msg = command.body || 'Mensaje autodestructible';
      await sendMessage(msg);
      setTimeout(async () => {
        if (!supabase) return;
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('sender_id', senderId)
          .eq('body', msg)
          .order('created_at', { ascending: false })
          .limit(1);
        if (msgs?.[0]) {
          await supabase.from('messages').delete().eq('id', msgs[0].id);
        }
      }, seconds * 1000);
      return { type: 'success', message: `Mensaje se borrará en ${seconds}s` };
    }

    case 'boom': {
      const [countStr, text] = command.params.length >= 2 ? command.params : [command.params[0] || '10', 'Hola'];
      const count = Math.min(parseInt(countStr) || 10, 500);
      const msg = text || 'Hola';
      for (let i = 0; i < count; i++) {
        setTimeout(() => { void sendMessage(msg); }, i * 50);
      }
      return { type: 'success', message: `Enviando ${count} mensajes...` };
    }

    case 'spam': {
      const [countStr, text] = command.params.length >= 2 ? command.params : [command.params[0] || '20', 'Spam'];
      const count = Math.min(parseInt(countStr) || 20, 200);
      const msg = text || 'Spam';
      for (let i = 0; i < count; i++) {
        setTimeout(() => { void sendMessage(msg); }, i * 30);
      }
      return { type: 'success', message: `Spam: ${count} x "${msg}"` };
    }

    case 'echo': {
      const [countStr, text] = command.params.length >= 2 ? command.params : ['1', command.body];
      const count = Math.min(parseInt(countStr) || 1, 100);
      const msg = text || 'Echo';
      for (let i = 0; i < count; i++) {
        setTimeout(() => { void sendMessage(msg); }, i * 100);
      }
      return { type: 'success', message: `Echo ${count}x` };
    }

    case 'ascii': {
      const text = command.body || 'HI';
      const ascii = text.toUpperCase().split('').map((c) => `[${c}]`).join(' ');
      await sendMessage(ascii);
      return { type: 'success', message: 'ASCII enviado' };
    }

    case 'hack': {
      const [countStr] = command.params;
      const count = parseInt(countStr) || 5;
      const steps = ['Conectando...', 'Inyectando...', 'Escaneando...', 'Bypassing firewall...', 'Acceso concedido!'];
      for (let i = 0; i < count; i++) {
        setTimeout(() => { void sendMessage(steps[i % steps.length]); }, i * 200);
      }
      return { type: 'success', message: `Secuencia hack: ${count} pasos` };
    }

    case 'matrix': {
      const [countStr] = command.params;
      const count = parseInt(countStr) || 3;
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const bin = Array.from({ length: 8 }, () => Math.random() > 0.5 ? '1' : '0').join('');
          void sendMessage(`${bin} ${bin.split('').reverse().join('')}`);
        }, i * 150);
      }
      return { type: 'success', message: `Matrix: ${count} líneas` };
    }

    case 'speak': {
      const text = command.body || 'Hola';
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      }
      await sendMessage(text);
      return { type: 'success', message: 'Hablando...' };
    }

    case 'countdown': {
      const [countStr] = command.params;
      const count = parseInt(countStr) || 10;
      for (let i = count; i >= 0; i--) {
        setTimeout(() => { void sendMessage(`⏳ ${i}`); }, (count - i) * 1000);
      }
      return { type: 'success', message: `Countdown: ${count}s` };
    }

    case 'weather':
    case 'crypto':
    case 'robot':
      return { type: 'success', message: `Comando /${command.type} ejecutado` };

    default:
      return { type: 'error', message: `Comando desconocido: /${command.type}` };
  }
}
