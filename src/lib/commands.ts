// Parser and handlers for special commands

export interface ParsedCommand {
  type: string;
  raw: string;
  params: string[];
  body?: string;
  timestamp?: number;
  repeat?: number;
}

export function parseCommand(input: string): ParsedCommand | null {
  if (!input.startsWith('/')) return null;

  // Extract command and parameters
  const parts = input.match(/^\/(\w+)(?:=([^=]+))?(?:\s+(.*))?$/);
  if (!parts) return null;

  const [, command, paramsRaw, body] = parts;
  const params = paramsRaw ? paramsRaw.split(',').map(p => p.trim()) : [];

  return {
    type: command.toLowerCase(),
    raw: input,
    params,
    body: body?.trim(),
    timestamp: Date.now(),
  };
}

export async function executeCommand(
  command: ParsedCommand,
  conversationId: string,
  senderId: string
): Promise<{ type: 'success' | 'error'; message?: string; delay?: number }> {
  switch (command.type) {
    case 'future': {
      // /future=1M or /future=5S or /future=2H
      const [duration] = command.params;
      if (!duration) return { type: 'error', message: 'Uso: /future=1M (1 minuto)' };

      const match = duration.match(/^(\d+)([SMH])$/i);
      if (!match) return { type: 'error', message: 'Formato: 1M=minutes, 5S=seconds, 2H=hours' };

      const [, value, unit] = match;
      const delay = parseInt(value) * (unit.toUpperCase() === 'S' ? 1000 : unit.toUpperCase() === 'M' ? 60000 : 3600000);

      const msg = command.body || 'Mensaje programado';
      console.log(`Scheduled message: "${msg}" in ${delay}ms`);
      setTimeout(() => {
        console.log('Sending scheduled message:', msg);
      }, delay);

      return { type: 'success', message: `Mensaje programado en ${duration} (se enviará en ${delay}ms)` };
    }

    case 'onevision': {
      // /onevision=5 or /onevision=10
      const [duration] = command.params;
      const seconds = parseInt(duration);
      if (!seconds || seconds < 1) return { type: 'error', message: 'Uso: /onevision=5 (5 segundos)' };

      const msg = command.body || 'Mensaje autodestructible';
      console.log(`OneVision message: "${msg}" will be deleted in ${seconds}s`);

      setTimeout(() => {
        console.log('OneVision expired - delete message:', msg);
      }, seconds * 1000);

      return { type: 'success', message: `Mensaje OneVision creado (se borrará en ${seconds}s)` };
    }

    case 'boom': {
      // /boom=100-Hola or /boom=50
      const [countStr, text] = command.params.length >= 2 ? command.params : [command.params[0] || '10', 'Hola'];
      const count = parseInt(countStr);
      if (!count || count < 1 || count > 500) return { type: 'error', message: 'Rango: 1-500 mensajes' };

      const messageText = text || 'Hola';
      console.log(`Boom: sending ${count} x "${messageText}"`);

      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          console.log(`Boom message ${i + 1}/${count}: ${messageText}`);
        }, i * 50); // 50ms between messages
      }

      return { type: 'success', message: `Boom! Enviando ${count} mensajes...` };
    }

    case 'spam': {
      // /spam=50-Hola
      const [countStr, text] = command.params.length >= 2 ? command.params : [command.params[0] || '20', 'Spam'];
      const count = parseInt(countStr);
      if (!count || count < 1 || count > 200) return { type: 'error', message: 'Rango: 1-200' };

      const msg = text || 'Spam';
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          console.log(`Spam ${i + 1}: ${msg}`);
        }, i * 30);
      }
      return { type: 'success', message: `Spam activado: ${count} x "${msg}"` };
    }

    case 'echo': {
      // /echo=3-Hola or /echo
      const [countStr, text] = command.params.length >= 2 ? command.params : ['1', command.body];
      const count = parseInt(countStr);
      const msg = text || 'Echo';

      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          console.log(`Echo ${i + 1}/${count}: ${msg}`);
        }, i * 100);
      }
      return { type: 'success', message: `Echo ${count}x: "${msg}"` };
    }

    case 'robot': {
      // /robot=file.js or /robot
      const [fileName] = command.params;
      console.log(`Robot mode: loading ${fileName || 'default.js'}`);
      
      return { type: 'success', message: `Robot mode iniciado. Cargando: ${fileName || 'default.js'}` };
    }

    case 'ascii': {
      // /ascii=Hello or /ascii
      const text = command.body || 'HI';
      const asciiArt = text.toUpperCase().split('').map(c => {
        // Simple placeholder
        return `[${c}]`;
      }).join(' ');
      console.log(`ASCII art: ${asciiArt}`);
      return { type: 'success', message: `ASCII: ${asciiArt}` };
    }

    case 'crypto': {
      // /crypto=BTC,ETH or /crypto
      const coins = command.params.length ? command.params : ['BTC', 'ETH'];
      console.log(`Crypto prices for: ${coins.join(', ')}`);
      return { type: 'success', message: `Crypto: ${coins.join(', ')}` };
    }

    case 'weather': {
      // /weather=Madrid or /weather
      const city = command.params[0] || 'Tu ubicación';
      console.log(`Weather for: ${city}`);
      return { type: 'success', message: `Clima en: ${city}` };
    }

    case 'hack': {
      // /hack or /hack=10
      const [countStr] = command.params;
      const count = parseInt(countStr) || 5;
      const phrases = ['Conectando...', 'Inyectando...', 'Escaneando...', 'Bypassing firewall...', 'Acceso concedido!'];
      
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          console.log(`Hack sequence ${i + 1}: ${phrases[i % phrases.length]}`);
        }, i * 200);
      }
      return { type: 'success', message: `Hack sequence: ${count} steps` };
    }

    case 'matrix': {
      // /matrix or /matrix=5
      const [countStr] = command.params;
      const count = parseInt(countStr) || 3;
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          console.log(`Matrix: 01001010 10101010 00110011`);
        }, i * 150);
      }
      return { type: 'success', message: `Matrix mode: ${count} matrices` };
    }

    case 'speak': {
      // /speak=Hello world or /speak
      const text = command.body || 'Hola';
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utterance);
      }
      return { type: 'success', message: `Speaking: "${text}"` };
    }

    case 'countdown': {
      // /countdown=10 or /countdown=5-Hola
      const [countStr, msg] = command.params.length >= 2 ? command.params : [command.params[0] || '10', ''];
      const count = parseInt(countStr);
      if (!count || count < 1) return { type: 'error', message: 'Countdown debe ser >= 1' };

      for (let i = count; i >= 0; i--) {
        setTimeout(() => {
          console.log(`Countdown: ${i}`);
        }, (count - i) * 1000);
      }
      return { type: 'success', message: `Countdown de ${count} segundos` };
    }

    default:
      return { type: 'error', message: `Comando desconocido: /${command.type}` };
  }
}

export function getCommandHelp(): string {
  return `
Comandos disponibles:
/future=1M [texto]     - Mensaje programado (1M=min, 5S=seg, 2H=horas)
/onevision=5 [texto]   - Mensaje autodestructible (5 segundos)
/boom=100-Hola         - 100x "Hola" rápidamente
/spam=50-Hola          - 50x "Hola"
/echo=3-Hola           - Echo 3x
/robot=file.js         - Robot programming mode
/ascii=Hello           - ASCII art
/crypto=BTC,ETH        - Precios cripto
/weather=Madrid        - Clima
/hack=5                - Hack sequence
/matrix=3              - Matrix mode
/speak=Hello world     - Speak text
/countdown=10          - Countdown de 10s
`;
}
