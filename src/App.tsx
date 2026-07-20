import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import type { Conversation, Message, Profile } from './lib/types';

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !username.trim() || !password) return;

    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      setStatus('Usa solo letras, numeros, punto, guion o guion bajo.');
      return;
    }

    const email = usernameToPrivateEmail(normalizedUsername);
    setStatus(mode === 'sign-up' ? 'Creando cuenta...' : 'Entrando...');

    const result =
      mode === 'sign-up'
        ? await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                username: normalizedUsername,
                display_name: normalizedUsername,
                qr_id: normalizedUsername,
              },
            },
          })
        : await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setStatus(result.error.message);
      return;
    }

    setStatus('');
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="eyebrow">x21</p>
        <h1 id="auth-title">BI Chat</h1>
        <p className="auth-copy">Entra con usuario y contrasena. Tu usuario se usa como identidad QR.</p>
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
          <label htmlFor="username">Usuario</label>
          <input
            id="username"
            aria-label="Usuario"
            autoComplete="username"
            maxLength={32}
            minLength={3}
            onChange={(event) => setUsername(event.target.value)}
            pattern="[A-Za-z0-9._-]{3,32}"
            required
            type="text"
            value={username}
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

function ChatShell({ user }: { user: User }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [profileResults, setProfileResults] = useState<Profile[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [status, setStatus] = useState('');
  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const sidebarVisible = sidebarPinned || sidebarHovered || searchOpen || settingsOpen || qrOpen;
  const username = typeof user.user_metadata.username === 'string' ? user.user_metadata.username : user.id.slice(0, 8);
  const displayName =
    typeof user.user_metadata.display_name === 'string' && user.user_metadata.display_name.trim()
      ? user.user_metadata.display_name
      : username;

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  const visibleConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations;

    return conversations.filter((conversation) => {
      const title = conversation.title ?? 'Conversacion';
      return `${title} ${conversation.id}`.toLowerCase().includes(query);
    });
  }, [conversations, searchQuery]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => messageListRef.current,
    estimateSize: () => 88,
    overscan: 8,
  });

  useEffect(() => {
    if (!supabase) return;

    void ensureProfile(user);

    supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setStatus('No se pudieron cargar las conversaciones.');
          return;
        }

        setConversations(data ?? []);
        setActiveConversationId((current) => current ?? data?.[0]?.id ?? null);
      });
  }, [user]);

  useEffect(() => {
    if (!supabase || !searchOpen) {
      setProfileResults([]);
      return;
    }

    const query = normalizeUsername(searchQuery);
    if (query.length < 2) {
      setProfileResults([]);
      return;
    }

    const request = supabase
      .from('profiles')
      .select('*')
      .or(`username.ilike.%${query}%,qr_id.ilike.%${query}%,display_name.ilike.%${query}%`)
      .neq('id', user.id)
      .limit(8);

    request.then(({ data, error }) => {
      if (error) {
        setStatus('No se pudo buscar usuarios. Revisa el SQL/RLS de profiles.');
        setProfileResults([]);
        return;
      }

      setProfileResults(data ?? []);
    });
  }, [searchOpen, searchQuery, user.id]);

  // Cargar historial de mensajes cuando cambia la conversación activa
  useEffect(() => {
    if (!supabase || !activeConversationId) {
      setMessages([]);
      return;
    }
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', activeConversationId)
      .order('created_at', { ascending: true })
      .limit(250)
      .then(({ data, error }) => {
        if (error) {
          setStatus('No se pudo cargar el historial.');
          return;
        }
        setMessages(data ?? []);
        queueMicrotask(() => virtualizer.scrollToIndex((data?.length ?? 1) - 1, { align: 'end' }));
      });
  }, [activeConversationId, virtualizer]);

  // Cargar perfiles de los emisores de los mensajes cargados de forma automática
  useEffect(() => {
    if (messages.length === 0 || !supabase) return;
    const missingIds = messages
      .map((m) => m.sender_id)
      .filter((id) => !profilesMap[id]);

    if (missingIds.length === 0) return;

    const uniqueIds = Array.from(new Set(missingIds));

    supabase
      .from('profiles')
      .select('*')
      .in('id', uniqueIds)
      .then(({ data }) => {
        if (data) {
          setProfilesMap((prev) => {
            const next = { ...prev };
            data.forEach((p) => {
              next[p.id] = p;
            });
            return next;
          });
        }
      });
  }, [messages, profilesMap]);

  // Referencia para la conversación activa para evitar cierres obsoletos en la suscripción global
  const activeConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeConvIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // Suscripción en tiempo real global para mensajes, notificaciones y orden de conversaciones
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;

    // Solicitar permisos de notificación en navegador
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }

    const channel = client
      .channel('global-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const newMsg = payload.new as Message;
          const currentActiveId = activeConvIdRef.current;

          // 1. Si pertenece a la conversación actual, añadirlo a la pantalla
          if (newMsg.conversation_id === currentActiveId) {
            setMessages((current) => {
              const next = [...current, newMsg];
              queueMicrotask(() => virtualizer.scrollToIndex(next.length - 1, { align: 'end' }));
              return next;
            });
          }

          // 2. Alertas visuales y sonoras de notificación (si no es nuestro mensaje)
          if (newMsg.sender_id !== user.id) {
            playNotificationSound();

            client
              .from('profiles')
              .select('display_name, username')
              .eq('id', newMsg.sender_id)
              .single()
              .then(({ data: senderProf }) => {
                const name = senderProf?.display_name || senderProf?.username || 'Contacto';
                if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
                  new Notification(`BI Chat - Nuevo mensaje de ${name}`, {
                    body: newMsg.body,
                    tag: 'bi-chat-new',
                  });
                }
              });
          }

          // 3. Actualizar la lista lateral de conversaciones y ordenarla al instante
          setConversations((current) => {
            const exists = current.some((c) => c.id === newMsg.conversation_id);
            if (!exists) {
              // Si nos llega un mensaje de una conversación que no tenemos cargada, recargar la lista entera
              client
                .from('conversations')
                .select('*')
                .order('updated_at', { ascending: false })
                .then(({ data }) => {
                  if (data) setConversations(data);
                });
              return current;
            }

            return current
              .map((c) => {
                if (c.id === newMsg.conversation_id) {
                  return { ...c, updated_at: newMsg.created_at };
                }
                return c;
              })
              .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
          });
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [user.id, virtualizer]);

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !activeConversationId || !draft.trim()) return;
    const body = draft.trim();
    setDraft('');

    const tempId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `temp-${Date.now()}`;
    const tempMsg: Message = {
      id: tempId,
      conversation_id: activeConversationId,
      sender_id: user.id,
      body,
      attachment_path: null,
      created_at: new Date().toISOString(),
    };

    // Optimistic update
    setMessages((current) => {
      const next = [...current, tempMsg];
      queueMicrotask(() => virtualizer.scrollToIndex(next.length - 1, { align: 'end' }));
      return next;
    });

    // Insert directly into messages table (RLS will check sender_id and membership)
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: activeConversationId,
        sender_id: user.id,
        body,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('Insert message error:', error);
      // Revert optimistic update
      setMessages((current) => current.filter((m) => m.id !== tempId));
      setDraft(body);
      if (error && (error as any).status === 403) {
        setStatus('Acceso denegado (403). Revisa los permisos RLS en la tabla messages.');
      } else {
        setStatus('No se pudo enviar el mensaje.');
      }
      return;
    }

    // Replace temporary message with server row
    setMessages((current) => current.map((m) => (m.id === tempId ? (data as Message) : m)));
    setStatus('');
  }

  async function createConversation() {
    if (!supabase) return;

    const { data, error } = await supabase
      .from('conversations')
      .insert({ title: 'Nueva conversacion', created_by: user.id })
      .select()
      .single();

    if (error) {
      setStatus('No se pudo crear la conversacion.');
      return;
    }

    setConversations((current) => [data, ...current]);
    setActiveConversationId(data.id);
  }

  async function startConversationWithProfile(profile: Profile) {
    if (!supabase) return;

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .insert({ title: profile.display_name || profile.username, created_by: user.id })
      .select()
      .single();

    if (conversationError) {
      setStatus('No se pudo crear la conversacion.');
      return;
    }

    const { error: memberError } = await supabase.from('conversation_members').insert({
      conversation_id: conversation.id,
      user_id: profile.id,
      role: 'member',
    });

    if (memberError) {
      setStatus('Se creo la conversacion, pero no se pudo agregar el contacto.');
      return;
    }

    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setSearchQuery('');
    setProfileResults([]);
    setSearchOpen(false);
    setStatus('');
  }

  return (
    <main className={`chat-app ${sidebarVisible ? 'sidebar-open' : 'sidebar-collapsed'}`}>
      <button
        aria-label={sidebarVisible ? 'Ocultar contactos' : 'Mostrar contactos'}
        aria-pressed={sidebarVisible}
        className="contact-rail"
        onClick={() => setSidebarPinned((current) => !current)}
        onMouseEnter={() => setSidebarHovered(true)}
        type="button"
      >
        <ContactsIcon />
        <span>Contactos</span>
      </button>

      <aside
        className="sidebar"
        aria-label="Conversaciones"
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => {
          if (!sidebarPinned) setSidebarHovered(false);
        }}
      >
        <div className="sidebar-header">
          <div>
            <h1>BI Chat</h1>
            <p className="sidebar-subtitle">Mensajes claros</p>
          </div>
          <button aria-label="Configuracion y perfil" className="icon-button" onClick={() => setSettingsOpen(true)} type="button">
            <GearIcon />
          </button>
        </div>

        <div className="sidebar-actions">
          <button aria-label="Buscar conversaciones" className="icon-button" onClick={() => setSearchOpen((current) => !current)} type="button">
            <SearchIcon />
          </button>
          <button aria-label="Buscar por QR" className="icon-button" onClick={() => setQrOpen(true)} type="button">
            <QrIcon />
          </button>
          <button className="secondary-button" onClick={createConversation} type="button">
            Nueva
          </button>
        </div>

        {searchOpen ? (
          <div className="search-row">
            <input
              aria-label="Buscar conversaciones"
              autoFocus
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Nombre o clave"
              type="search"
              value={searchQuery}
            />
            <button
              aria-label="Cerrar busqueda"
              className="icon-button"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery('');
              }}
              type="button"
            >
              <CloseIcon />
            </button>
          </div>
        ) : null}

        <nav className="conversation-list">
          {searchOpen && profileResults.length > 0 ? (
            <section className="search-results" aria-label="Usuarios encontrados">
              <p className="result-label">Usuarios</p>
              {profileResults.map((profile) => (
                <button
                  className="profile-result"
                  key={profile.id}
                  onClick={() => void startConversationWithProfile(profile)}
                  type="button"
                >
                  <span className="avatar-dot" aria-hidden="true">
                    {(profile.display_name || profile.username).slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{profile.display_name || profile.username}</strong>
                    <small>@{profile.username}</small>
                  </span>
                </button>
              ))}
            </section>
          ) : null}

          {visibleConversations.length === 0 && profileResults.length === 0 ? (
            <p className="empty-state">{searchQuery.trim() ? 'Sin resultados.' : 'Sin conversaciones.'}</p>
          ) : null}
          {visibleConversations.map((conversation) => (
            <button
              aria-current={conversation.id === activeConversationId ? 'page' : undefined}
              className="conversation-button"
              key={conversation.id}
              onClick={() => setActiveConversationId(conversation.id)}
              type="button"
            >
              <span className="conversation-title">{conversation.title ?? 'Conversacion'}</span>
              <span className="conversation-meta">{formatTime.format(new Date(conversation.updated_at))}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="chat-panel" aria-labelledby="chat-title">
        <header className="chat-header">
          <div>
            <h2 id="chat-title">{activeConversation?.title ?? 'Selecciona una conversacion'}</h2>
            <p><span className="presence-dot" aria-hidden="true" /> {displayName}</p>
          </div>
          <div className="chat-header-actions">
            <button aria-label="Buscar por QR" className="icon-button" onClick={() => setQrOpen(true)} type="button">
              <QrIcon />
            </button>
            <button aria-label="Perfil y configuracion" className="icon-button" onClick={() => setSettingsOpen(true)} type="button">
              <UserIcon />
            </button>
          </div>
        </header>

        <div
          aria-label="Mensajes"
          className="message-list"
          ref={messageListRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
        >
          <div
            className="message-virtual-space"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const message = messages[virtualItem.index];
              const isOwn = message.sender_id === user.id;
              const senderProfile = profilesMap[message.sender_id];
              const senderName = isOwn 
                ? 'Tú' 
                : (senderProfile?.display_name || senderProfile?.username || 'Contacto');

              return (
                <article
                  className={`message-row ${isOwn ? 'own' : 'received'}`}
                  key={message.id}
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <div className="message-bubble">
                    <div className="message-meta">
                      <strong>{senderName}</strong>
                      <time dateTime={message.created_at}>{formatTime.format(new Date(message.created_at))}</time>
                    </div>
                    <p>{message.body}</p>
                    {message.attachment_path ? (
                      <img alt="" className="message-image" loading="lazy" src={message.attachment_path} />
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <button aria-label="Adjuntar archivo" className="icon-button" type="button">
            <AttachIcon />
          </button>
          <textarea
            aria-label="Mensaje"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
              if (event.key === 'Escape') setDraft('');
            }}
            placeholder="Escribe un mensaje"
            rows={1}
            value={draft}
          />
          <button aria-label="Enviar mensaje" className="send-button" disabled={!draft.trim()} type="submit">
            <SendIcon />
          </button>
        </form>
        <p aria-live="polite" className="form-status">
          {status}
        </p>
      </section>

      {settingsOpen ? (
        <SettingsDialog
          displayName={displayName}
          onClose={() => setSettingsOpen(false)}
          onStatus={setStatus}
          username={username}
        />
      ) : null}

      {qrOpen ? (
        <QrSearchDialog
          onClose={() => setQrOpen(false)}
          onSearch={(value) => {
            setSearchQuery(value);
            setSearchOpen(true);
            setQrOpen(false);
            setSidebarHovered(true);
          }}
          onStatus={setStatus}
          username={username}
        />
      ) : null}
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
