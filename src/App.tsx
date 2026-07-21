import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { isSupabaseConfigured, supabase, uploadFile, scheduleMessage } from './lib/supabase';
import type { Conversation, Message, Profile, Attachment } from './lib/types';
import { parseCommand, executeCommand } from './lib/commands';
import { startScheduler } from './lib/scheduler';
import type { ScheduledMessage, X21User } from './lib/types';

type AppState = 'loading' | 'signed-out' | 'ready' | 'missing-config';

const formatTime = new Intl.DateTimeFormat('es', {
  hour: '2-digit',
  minute: '2-digit',
});

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
    
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.25);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    console.error('AudioContext error:', e);
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<AppState>(isSupabaseConfigured ? 'loading' : 'missing-config');

  // Start scheduler for scheduled messages
  useEffect(() => {
    if (supabase) {
      startScheduler();
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setState(data.session ? 'ready' : 'signed-out');
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setState(nextSession ? 'ready' : 'signed-out');
    });

    return () => subscription.unsubscribe();
  }, []);

  if (state === 'missing-config') return <MissingConfig />;
  if (state === 'loading') return <main className="centered-status">Cargando BI Chat...</main>;
  if (!session) return <AuthScreen />;

  return <ChatShell user={session.user} />;
}

// Parse message content to detect and highlight commands
function parseMessageContent(body: string) {
  if (!body.startsWith('/')) return body;
  
  const command = parseCommand(body);
  if (command) {
    const commandText = body.split(' ')[0];
    const rest = body.substring(commandText.length).trim();
    
    return (
      <>
        <span className="command-badge">/{command.type}</span>
        {command.params.length > 0 && <span className="command-badge">{command.params.join(', ')}</span>}
        {rest && <span> {rest}</span>}
      </>
    );
  }
  
  return body;
}

function MissingConfig() {
  return (
    <main className="centered-status">
      <h1>BI Chat</h1>
      <p>Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` para conectar Supabase.</p>
    </main>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [focalid, setFocalid] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  // Generar FOCALID automáticamente para new users
  useEffect(() => {
    if (mode === 'sign-up') {
      const randomFocalid = Math.random().toString(36).substring(2, 10);
      setFocalid(randomFocalid);
    }
  }, [mode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !focalid.trim() || !password) return;

    if (focalid.length !== 8) {
      setStatus('El FOCALID debe tener exactamente 8 caracteres.');
      return;
    }

    setStatus(mode === 'sign-up' ? 'Creando cuenta...' : 'Entrando...');

    try {
      if (mode === 'sign-up') {
        // Registro: generar email único y crear usuario
        const email = `${focalid}@focalid.bi-chat.x21.local`;
        
        // 1. Crear usuario en Supabase Auth
        const authResult = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: focalid,
              display_name: focalid,
              qr_id: focalid,
            },
          },
        });

        if (authResult.error) {
          setStatus(authResult.error.message);
          return;
        }

        // 2. Crear entrada en x21_users
        const { error: x21Error } = await (supabase
          .from('x21_users') as any)
          .insert([{ focalid, email }]);

        if (x21Error) {
          setStatus(`Cuenta creada pero error en FOCALID: ${x21Error.message}`);
          return;
        }

        // 3. Crear perfil
        if (authResult.data.user?.id) {
          await supabase.from('profiles').insert({
            id: authResult.data.user.id,
            username: focalid,
            qr_id: focalid,
            display_name: focalid,
          });
        }

        setStatus('Cuenta creada exitosamente!');
        setMode('sign-in');
      } else {
        // Login: buscar email por FOCALID
        const { data: userRecord, error: lookupError } = await supabase
          .from('x21_users')
          .select('email')
          .eq('focalid', focalid)
          .single() as any;

        if (lookupError || !userRecord) {
          setStatus('FOCALID no encontrado. ¿Te has registrado?');
          return;
        }

        const email = userRecord.email;

        // 3. Autenticar con email y contraseña
        const loginResult = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (loginResult.error) {
          setStatus(loginResult.error.message);
          return;
        }

        setStatus('');
      }
    } catch (err: any) {
      setStatus(err.message || 'Error en la autenticación');
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="eyebrow">x21</p>
        <h1 id="auth-title">BI Chat</h1>
        <p className="auth-copy">Entra con tu FOCALID de 8 caracteres. Genera uno nuevo o usa el tuyo.</p>
        <div className="auth-tabs" role="tablist" aria-label="Modo de acceso">
          <button
            aria-selected={mode === 'sign-in'}
            className="tab-button"
            onClick={() => setMode('sign-in')}
            role="tab"
            type="button"
          >
            Entrar
          </button>
          <button
            aria-selected={mode === 'sign-up'}
            className="tab-button"
            onClick={() => setMode('sign-up')}
            role="tab"
            type="button"
          >
            Crear cuenta
          </button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="focalid">FOCALID</label>
          <input
            id="focalid"
            aria-label="FOCALID"
            autoComplete="username"
            maxLength={8}
            minLength={8}
            onChange={(event) => setFocalid(event.target.value)}
            pattern="[a-z0-9]{8}"
            required
            type="text"
            value={focalid}
          />
          <label htmlFor="password">Contrasena</label>
          <input
            id="password"
            aria-label="Contrasena"
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <button className="primary-button" type="submit">
            {mode === 'sign-up' ? 'Crear cuenta' : 'Entrar'}
          </button>
          <p aria-live="polite" className="form-status">
            {status}
          </p>
        </form>
      </section>
    </main>
  );
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

function usernameToPrivateEmail(username: string) {
  return `${username}@users.bi-chat.x21.local`;
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="M12 3 4 9v12h16V9l-8-6Z" fill="currentColor" />
    </svg>
  );
}

function MessagesIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Z" fill="currentColor" />
    </svg>
  );
}

function EscapeIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="M10 12H2l6-6-1.4-1.4L4.2 12l6.4 7.4L12 18l-2-6Z" fill="currentColor" />
    </svg>
  );
}

function ChatShell({ user }: { user: User }) {
  // ... (existing state) ...
  const [activeTab, setActiveTab] = useState<'home' | 'messages' | 'profile' | 'search'>('messages');

  // ... (existing useEffects) ...

  return (
    <main className={`chat-app ${sidebarVisible ? 'sidebar-open' : 'sidebar-collapsed'}`}>
      {/* ... (sidebar) ... */}

      <section className="chat-panel" aria-labelledby="chat-title">
        {/* ... (chat header, messages list, composer) ... */}
      </section>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav">
        <button onClick={() => setActiveTab('home')} aria-selected={activeTab === 'home'}>
          <HomeIcon />
        </button>
        <button onClick={() => setActiveTab('messages')} aria-selected={activeTab === 'messages'}>
          <MessagesIcon />
        </button>
        <button onClick={() => setSearchOpen(true)} aria-selected={activeTab === 'search'}>
          <SearchIcon />
        </button>
        <button onClick={() => setSettingsOpen(true)} aria-selected={activeTab === 'profile'}>
          <UserIcon />
        </button>
        <button onClick={() => { /* Handle Escape */ setActiveTab('messages'); setActiveConversationId(null); }}>
          <EscapeIcon />
        </button>
      </nav>
      {/* ... (existing dialogs) ... */}
    </main>
  );
}

async function ensureProfile(user: User) {
  if (!supabase) return;

  const username =
    typeof user.user_metadata.username === 'string' && user.user_metadata.username.trim()
      ? normalizeUsername(user.user_metadata.username)
      : user.id.slice(0, 8);
  const displayName =
    typeof user.user_metadata.display_name === 'string' && user.user_metadata.display_name.trim()
      ? user.user_metadata.display_name.trim()
      : username;

  await supabase.from('profiles').upsert({
    id: user.id,
    username,
    qr_id: username,
    display_name: displayName,
  });
}

function SettingsDialog({
  displayName,
  onClose,
  onStatus,
  username,
}: {
  displayName: string;
  onClose: () => void;
  onStatus: (value: string) => void;
  username: string;
}) {
  const [name, setName] = useState(displayName);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !name.trim()) return;

    const { error } = await supabase.auth.updateUser({
      data: {
        display_name: name.trim(),
      },
    });

    onStatus(error ? 'No se pudo guardar el perfil.' : 'Perfil guardado.');
    if (!error) onClose();
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="settings-title" aria-modal="true" className="dialog-panel" role="dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Perfil</p>
            <h2 id="settings-title">Configuracion</h2>
          </div>
          <button aria-label="Cerrar configuracion" className="icon-button" onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </div>

        <form className="auth-form" onSubmit={saveProfile}>
          <label htmlFor="display-name">Nombre visible</label>
          <input
            id="display-name"
            aria-label="Nombre visible"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />

          <label htmlFor="profile-user">Usuario QR</label>
          <input id="profile-user" aria-label="Usuario QR" readOnly value={username} />

          <div className="dialog-actions">
            <button className="primary-button" type="submit">
              Guardar
            </button>
            <button className="danger-button" onClick={signOut} type="button">
              Salir
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function QrSearchDialog({
  onClose,
  onSearch,
  onStatus,
  username,
}: {
  onClose: () => void;
  onSearch: (value: string) => void;
  onStatus: (value: string) => void;
  username: string;
}) {
  const [qrValue, setQrValue] = useState('');
  const ownQr = useMemo(() => makeReadableQr(username), [username]);

  async function decodeImage(file: File) {
    if (!('BarcodeDetector' in window)) {
      onStatus('Tu navegador no permite leer QR desde imagen. Pega la clave manualmente.');
      return;
    }

    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const bitmap = await createImageBitmap(file);
    const codes = await detector.detect(bitmap);
    const value = codes[0]?.rawValue ?? '';

    if (!value) {
      onStatus('No se encontro un QR legible.');
      return;
    }

    setQrValue(value);
    onSearch(value);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="qr-title" aria-modal="true" className="dialog-panel qr-panel" role="dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">QR</p>
            <h2 id="qr-title">Buscar por QR</h2>
          </div>
          <button aria-label="Cerrar busqueda por QR" className="icon-button" onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </div>

        <div className="qr-card" aria-label="Tu QR de perfil">
          {ownQr.map((row, rowIndex) => (
            <div className="qr-row" key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <span className={cell ? 'qr-cell active' : 'qr-cell'} key={cellIndex} />
              ))}
            </div>
          ))}
        </div>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (qrValue.trim()) onSearch(qrValue.trim());
          }}
        >
          <label htmlFor="qr-file">Leer QR desde imagen</label>
          <input
            id="qr-file"
            accept="image/*"
            aria-label="Leer QR desde imagen"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void decodeImage(file);
            }}
            type="file"
          />

          <label htmlFor="qr-value">O pega una clave</label>
          <input
            id="qr-value"
            aria-label="Clave o contenido QR"
            onChange={(event) => setQrValue(event.target.value)}
            placeholder="Usuario, nombre o id"
            value={qrValue}
          />

          <button className="primary-button" type="submit">
            Buscar
          </button>
        </form>
      </section>
    </div>
  );
}

function makeReadableQr(value: string) {
  const size = 11;
  const seed = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => {
      const finder =
        (row < 3 && column < 3) ||
        (row < 3 && column > size - 4) ||
        (row > size - 4 && column < 3);
      return finder || ((row * 7 + column * 11 + seed) % 5 < 2);
    }),
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="M3 11.5 21 3l-5.8 18-3.5-7.5L3 11.5Z" fill="currentColor" />
    </svg>
  );
}

function ContactsIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v13a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 18.5v-13Zm4 1v4h8v-4H8Zm0 7v2.5h8v-2.5H8Z" fill="currentColor" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="M8 17.5 17.7 7.8a3 3 0 0 1 4.2 4.2L10.8 23.1a5 5 0 0 1-7.1-7.1L15 4.7a7 7 0 0 1 9.9 9.9l-9.5 9.5-2.1-2.1 9.5-9.5a4 4 0 0 0-5.7-5.7L5.8 18.1a2 2 0 1 0 2.8 2.8l11.1-11.1a1 1 0 0 0-1.4-1.4L8.6 18.1 8 17.5Z" fill="currentColor" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2-2.1 2.1-4.2-4.2A7.5 7.5 0 1 1 10.5 3Zm0 3a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" fill="currentColor" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="m19.4 13.5 1.5 1.2-2 3.5-1.9-.7a7.8 7.8 0 0 1-1.7 1l-.3 2h-4l-.3-2a7.8 7.8 0 0 1-1.7-1l-1.9.7-2-3.5 1.5-1.2a7.2 7.2 0 0 1 0-2l-1.5-1.2 2-3.5 1.9.7a7.8 7.8 0 0 1 1.7-1l.3-2h4l.3 2a7.8 7.8 0 0 1 1.7 1l1.9-.7 2 3.5-1.5 1.2a7.2 7.2 0 0 1 0 2ZM13 15.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="currentColor" />
    </svg>
  );
}

function getFileType(file: File): 'image' | 'video' | 'audio' | 'document' {
  const type = file.type.split('/')[0];
  if (type === 'image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  return 'document';
}

function CommandHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="commands-title" aria-modal="true" className="dialog-panel" role="dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Comandos</p>
            <h2 id="commands-title">Ayuda de comandos</h2>
          </div>
          <button aria-label="Cerrar ayuda" className="icon-button" onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </div>
        <div className="command-help">
          <p className="command-help-item">
            <code>/future=1M [texto]</code> - Mensaje programado (M=minutos, S=segundos, H=horas)
          </p>
          <p className="command-help-item">
            <code>/onevision=5 [texto]</code> - Mensaje autodestructible (5 segundos)
          </p>
          <p className="command-help-item">
            <code>/boom=100-Hola</code> - Envía 100 mensajes "Hola"
          </p>
          <p className="command-help-item">
            <code>/spam=50-Hola</code> - Envía 50 mensajes "Hola"
          </p>
          <p className="command-help-item">
            <code>/echo=3-Hola</code> - Echo 3x
          </p>
          <p className="command-help-item">
            <code>/robot=file.js</code> - Robot programming mode
          </p>
          <p className="command-help-item">
            <code>/ascii=Hello</code> - ASCII art
          </p>
          <p className="command-help-item">
            <code>/crypto=BTC,ETH</code> - Precios cripto
          </p>
          <p className="command-help-item">
            <code>/weather=Madrid</code> - Clima
          </p>
          <p className="command-help-item">
            <code>/hack=5</code> - Hack sequence
          </p>
          <p className="command-help-item">
            <code>/matrix=3</code> - Matrix mode
          </p>
          <p className="command-help-item">
            <code>/speak=Hello world</code> - Speak text
          </p>
          <p className="command-help-item">
            <code>/countdown=10</code> - Countdown de 10s
          </p>
        </div>
        <div className="dialog-actions">
          <button className="primary-button" onClick={onClose} type="button">
            Entendido
          </button>
        </div>
      </section>
    </div>
  );
}

function QrIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="M3 3h8v8H3V3Zm3 3v2h2V6H6Zm7-3h8v8h-8V3Zm3 3v2h2V6h-2ZM3 13h8v8H3v-8Zm3 3v2h2v-2H6Zm9-3h2v2h-2v-2Zm4 0h2v4h-4v-2h2v-2Zm-6 4h2v4h-2v-4Zm4 2h4v2h-4v-2Z" fill="currentColor" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="M12 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 13c4.4 0 8 2.2 8 5v1H4v-1c0-2.8 3.6-5 8-5Z" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      <path d="m6.4 4.9 5.6 5.6 5.6-5.6 1.5 1.5-5.6 5.6 5.6 5.6-1.5 1.5-5.6-5.6-5.6 5.6-1.5-1.5 5.6-5.6-5.6-5.6 1.5-1.5Z" fill="currentColor" />
    </svg>
  );
}
