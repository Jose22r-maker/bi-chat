import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { isSupabaseConfigured, supabase, uploadFile } from './lib/supabase';
import type { Conversation, Message, Profile, Attachment } from './lib/types';
import { parseCommand, executeCommand } from './lib/commands';
import { startScheduler } from './lib/scheduler';

type AppState = 'loading' | 'signed-out' | 'ready' | 'missing-config';

const formatTime = new Intl.DateTimeFormat('es', {
  hour: '2-digit',
  minute: '2-digit',
});

function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
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

function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function getAvatarColor(id: string) {
  const colors = ['#00A884', '#53BDEB', '#E67E22', '#8E44AD', '#E74C3C', '#2ECC71', '#3498DB'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
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

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<AppState>(isSupabaseConfigured ? 'loading' : 'missing-config');

  useEffect(() => {
    if (supabase) startScheduler();
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

function MissingConfig() {
  return (
    <main className="centered-status">
      <div className="missing-config-card">
        <div className="missing-config-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#E74C3C" strokeWidth="2"/>
            <line x1="12" y1="8" x2="12" y2="12" stroke="#E74C3C" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="12" cy="16" r="1" fill="#E74C3C"/>
          </svg>
        </div>
        <h1>BI Chat</h1>
        <p>Configura las variables de entorno para conectar Supabase.</p>
        <code>VITE_SUPABASE_URL</code>
        <code>VITE_SUPABASE_ANON_KEY</code>
      </div>
    </main>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [focalid, setFocalid] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (mode === 'sign-up') {
      setFocalid(Math.random().toString(36).substring(2, 10));
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
        const email = `${focalid}@focalid.bi-chat.x21.local`;
        const authResult = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: focalid, display_name: focalid, qr_id: focalid } },
        });
        if (authResult.error) { setStatus(authResult.error.message); return; }
        const { error: x21Error } = await supabase.from('x21_users').insert([{ focalid, email }]);
        if (x21Error) { setStatus(`Cuenta creada pero error en FOCALID: ${x21Error.message}`); return; }
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
        const { data: userRecord, error: lookupError } = await supabase
          .from('x21_users').select('email').eq('focalid', focalid).single();
        if (lookupError || !userRecord) { setStatus('FOCALID no encontrado.'); return; }
        const loginResult = await supabase.auth.signInWithPassword({ email: userRecord.email, password });
        if (loginResult.error) { setStatus(loginResult.error.message); return; }
        setStatus('');
      }
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : 'Error en la autenticación');
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="auth-logo">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 1.74.45 3.38 1.24 4.81L2 22l5.19-1.24C8.62 21.55 10.26 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" fill="#25D366"/>
              <path d="M16.5 14.5c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.5-.89-.8-1.5-1.78-1.67-2.08-.18-.3 0-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35z" fill="white"/>
            </svg>
          </div>
          <h1 id="auth-title">BI Chat</h1>
          <p className="auth-copy">Entra con tu FOCALID de 8 caracteres</p>
        </div>
        <div className="auth-tabs" role="tablist">
          <button
            aria-selected={mode === 'sign-in'}
            className={`tab-button ${mode === 'sign-in' ? 'active' : ''}`}
            onClick={() => setMode('sign-in')}
            role="tab"
            type="button"
          >
            Entrar
          </button>
          <button
            aria-selected={mode === 'sign-up'}
            className={`tab-button ${mode === 'sign-up' ? 'active' : ''}`}
            onClick={() => setMode('sign-up')}
            role="tab"
            type="button"
          >
            Crear cuenta
          </button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="focalid">FOCALID</label>
            <input
              id="focalid"
              autoComplete="username"
              maxLength={8}
              minLength={8}
              onChange={(e) => setFocalid(e.target.value)}
              pattern="[a-z0-9]{8}"
              placeholder="Tu identificador de 8 caracteres"
              required
              type="text"
              value={focalid}
            />
          </div>
          <div className="input-group">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              required
              type="password"
              value={password}
            />
          </div>
          <button className="auth-submit" type="submit">
            {mode === 'sign-up' ? 'Crear cuenta' : 'Entrar'}
          </button>
          <p aria-live="polite" className="form-status">{status}</p>
        </form>
      </section>
    </main>
  );
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
  const [status, setStatus] = useState('');
  const [showCommandHelp, setShowCommandHelp] = useState(false);
  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});
  const [fileAttachments, setFileAttachments] = useState<Attachment[]>([]);
  const [mobileView, setMobileView] = useState<'chats' | 'chat'>('chats');
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const activeConvIdRef = useRef<string | null>(null);
  const pendingMessageIdsRef = useRef<Set<string>>(new Set());

  const username = typeof user.user_metadata.username === 'string' ? user.user_metadata.username : user.id.slice(0, 8);
  const displayName =
    typeof user.user_metadata.display_name === 'string' && user.user_metadata.display_name.trim()
      ? user.user_metadata.display_name
      : username;

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  const visibleConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((c) => {
      const title = c.title ?? 'Conversación';
      return title.toLowerCase().includes(query);
    });
  }, [conversations, searchQuery]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => messageListRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  useEffect(() => {
    activeConvIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!supabase) return;
    void ensureProfile(user);
    supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setStatus('No se pudieron cargar las conversaciones.'); return; }
        setConversations(data ?? []);
        setActiveConversationId((current) => current ?? data?.[0]?.id ?? null);
      });
  }, [user]);

  useEffect(() => {
    if (!supabase || !searchOpen) { setProfileResults([]); return; }
    const query = normalizeUsername(searchQuery);
    if (query.length < 2) { setProfileResults([]); return; }
    supabase
      .from('profiles')
      .select('*')
      .or(`username.ilike.%${query}%,qr_id.ilike.%${query}%,display_name.ilike.%${query}%`)
      .neq('id', user.id)
      .limit(8)
      .then(({ data, error }) => {
        if (error) { setStatus('Error al buscar usuarios.'); setProfileResults([]); return; }
        setProfileResults(data ?? []);
      });
  }, [searchOpen, searchQuery, user.id]);

  useEffect(() => {
    if (!supabase || !activeConversationId) { setMessages([]); return; }
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', activeConversationId)
      .order('created_at', { ascending: true })
      .limit(250)
      .then(({ data, error }) => {
        if (error) { setStatus('No se pudo cargar el historial.'); return; }
        setMessages(data ?? []);
        queueMicrotask(() => virtualizer.scrollToIndex((data?.length ?? 1) - 1, { align: 'end' }));
      });
  }, [activeConversationId, virtualizer]);

  useEffect(() => {
    if (messages.length === 0 || !supabase) return;
    const missingIds = [...new Set(messages.map((m) => m.sender_id).filter((id) => !profilesMap[id]))];
    if (missingIds.length === 0) return;
    supabase
      .from('profiles')
      .select('*')
      .in('id', missingIds)
      .then(({ data }) => {
        if (data) {
          setProfilesMap((prev) => {
            const next = { ...prev };
            data.forEach((p) => { next[p.id] = p; });
            return next;
          });
        }
      });
  }, [messages, profilesMap]);

  useEffect(() => {
    if (messages.length > 0 && messageListRef.current) {
      queueMicrotask(() => {
        virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
      });
    }
  }, [messages, virtualizer]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    const channel = client
      .channel('global-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMsg = payload.new as Message;
        const currentActiveId = activeConvIdRef.current;
        if (pendingMessageIdsRef.current.has(newMsg.id)) {
          pendingMessageIdsRef.current.delete(newMsg.id);
          return;
        }
        if (newMsg.conversation_id === currentActiveId) {
          setMessages((current) => {
            const next = [...current, newMsg];
            queueMicrotask(() => virtualizer.scrollToIndex(next.length - 1, { align: 'end' }));
            return next;
          });
        }
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
                new Notification(name, { body: newMsg.body, tag: 'bi-chat-new' });
              }
            });
        }
        setConversations((current) => {
          const exists = current.some((c) => c.id === newMsg.conversation_id);
          if (!exists) {
            client
              .from('conversations')
              .select('*')
              .order('updated_at', { ascending: false })
              .then(({ data }) => { if (data) setConversations(data); });
            return current;
          }
          return current
            .map((c) => c.id === newMsg.conversation_id ? { ...c, updated_at: newMsg.created_at } : c)
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        });
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [user.id, virtualizer]);

  const sendMessage = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !activeConversationId) return;
    const body = draft.trim();
    setDraft('');
    fileAttachments.forEach((f) => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
    setFileAttachments([]);
    const command = parseCommand(body);
    if (command) {
      const result = await executeCommand(command, activeConversationId, user.id);
      setStatus(result.message || '');
      return;
    }
    const tempId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `temp-${Date.now()}`;
    const tempMsg: Message = {
      id: tempId, conversation_id: activeConversationId, sender_id: user.id,
      body, attachment_path: null, created_at: new Date().toISOString(),
    };
    setMessages((current) => {
      const next = [...current, tempMsg];
      queueMicrotask(() => virtualizer.scrollToIndex(next.length - 1, { align: 'end' }));
      return next;
    });
    let attachmentPath: string | null = null;
    if (fileAttachments.length > 0) {
      attachmentPath = await uploadFile(fileAttachments[0].file, activeConversationId);
      if (!attachmentPath) {
        setStatus('Error al subir el archivo.');
        setMessages((current) => current.filter((m) => m.id !== tempId));
        return;
      }
    }
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: activeConversationId, sender_id: user.id, body, attachment_path: attachmentPath })
      .select().single();
    if (error || !data) {
      setMessages((current) => current.filter((m) => m.id !== tempId));
      setDraft(body);
      setStatus('No se pudo enviar el mensaje.');
      return;
    }
    setMessages((current) => current.map((m) => (m.id === tempId ? (data as Message) : m)));
    setStatus('');
  }, [draft, activeConversationId, fileAttachments, user.id, virtualizer]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'document';
      newAttachments.push({
        file, type,
        previewUrl: type === 'image' ? URL.createObjectURL(file) : undefined,
      });
    }
    setFileAttachments((prev) => [...prev, ...newAttachments].slice(0, 5));
    event.target.value = '';
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setFileAttachments((prev) => {
      const removed = prev[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  async function createConversation() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('conversations')
      .insert({ title: 'Nueva conversación', created_by: user.id })
      .select().single();
    if (error) { setStatus('No se pudo crear la conversación.'); return; }
    setConversations((current) => [data, ...current]);
    setActiveConversationId(data.id);
  }

  async function startConversationWithProfile(profile: Profile) {
    if (!supabase) return;
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({ title: profile.display_name || profile.username, created_by: user.id })
      .select().single();
    if (convError) { setStatus('No se pudo crear la conversación.'); return; }
    const { error: memberError } = await supabase.from('conversation_members').insert({
      conversation_id: conversation.id, user_id: profile.id, role: 'member',
    });
    if (memberError) { setStatus('Conversación creada, pero no se pudo agregar el contacto.'); return; }
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setSearchQuery('');
    setProfileResults([]);
    setSearchOpen(false);
    setMobileView('chat');
    setStatus('');
  }

  function selectConversation(id: string) {
    setActiveConversationId(id);
    setMobileView('chat');
  }

  return (
    <main className="chat-app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-header-left">
            <div className="user-avatar" style={{ background: getAvatarColor(user.id) }}>
              {getInitials(displayName)}
            </div>
            <h1>Chats</h1>
          </div>
          <div className="sidebar-header-actions">
            <button aria-label="Nuevo chat" className="icon-btn" onClick={createConversation} type="button">
              <IconNewChat />
            </button>
            <button aria-label="Menú" className="icon-btn" onClick={() => setSettingsOpen(true)} type="button">
              <IconMenu />
            </button>
          </div>
        </div>

        <div className="sidebar-search">
          <div className="search-input-wrapper">
            <IconSearch />
            <input
              aria-label="Buscar conversaciones"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar o empezar un nuevo chat"
              type="text"
              value={searchQuery}
            />
          </div>
          <button aria-label="Buscar por QR" className="icon-btn" onClick={() => setQrOpen(true)} type="button">
            <IconQr />
          </button>
        </div>

        {searchOpen && (
          <div className="user-search-panel">
            <div className="user-search-header">
              <button className="icon-btn" onClick={() => { setSearchOpen(false); setSearchQuery(''); }} type="button">
                <IconBack />
              </button>
              <span>Buscar usuarios</span>
            </div>
            {profileResults.length > 0 && (
              <div className="profile-results">
                {profileResults.map((profile) => (
                  <button key={profile.id} className="profile-result-item" onClick={() => startConversationWithProfile(profile)} type="button">
                    <div className="user-avatar" style={{ background: getAvatarColor(profile.id) }}>
                      {getInitials(profile.display_name || profile.username)}
                    </div>
                    <div className="profile-result-info">
                      <span className="profile-result-name">{profile.display_name}</span>
                      <span className="profile-result-id">@{profile.username}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="conversation-list">
          {visibleConversations.length === 0 && (
            <div className="empty-state">
              <IconEmptyChat />
              <p>No hay conversaciones</p>
              <span>Inicia una búsqueda o crea un nuevo chat</span>
            </div>
          )}
          {visibleConversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === activeConversationId}
              onClick={() => selectConversation(conversation.id)}
            />
          ))}
        </div>
      </aside>

      <section className="chat-panel">
        {activeConversationId ? (
          <>
            <div className="chat-header">
              <button className="icon-btn mobile-only" onClick={() => setMobileView('chats')} type="button">
                <IconBack />
              </button>
              <div className="chat-header-info">
                <div
                  className="user-avatar small"
                  style={{ background: getAvatarColor(activeConversation?.created_by ?? '') }}
                >
                  {getInitials(activeConversation?.title ?? 'Chat')}
                </div>
                <div>
                  <h2>{activeConversation?.title ?? 'Conversación'}</h2>
                  <p>en línea</p>
                </div>
              </div>
              <div className="chat-header-actions">
                <button aria-label="Buscar" className="icon-btn" type="button">
                  <IconSearch />
                </button>
                <button aria-label="Más opciones" className="icon-btn" type="button">
                  <IconMenu />
                </button>
              </div>
            </div>

            <div className="message-list" ref={messageListRef}>
              <div className="message-virtual-space" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const msg = messages[virtualRow.index];
                  const isOwn = msg.sender_id === user.id;
                  const senderProfile = profilesMap[msg.sender_id];
                  const showSenderHeader = !isOwn;
                  return (
                    <div
                      className={`message-row ${isOwn ? 'own' : 'received'}`}
                      key={msg.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <div className="message-bubble">
                        {showSenderHeader && senderProfile && (
                          <div className="message-sender" style={{ color: getAvatarColor(msg.sender_id) }}>
                            {senderProfile.display_name || senderProfile.username}
                          </div>
                        )}
                        {msg.attachment_path && (
                          <div className="message-attachment">
                            {msg.attachment_path.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                              <img alt="Adjunto" className="message-image" src={msg.attachment_path} />
                            ) : msg.attachment_path.match(/\.(mp4|webm)$/i) ? (
                              <video className="message-video" controls src={msg.attachment_path} />
                            ) : msg.attachment_path.match(/\.(mp3|wav|ogg)$/i) ? (
                              <audio className="message-audio" controls src={msg.attachment_path} />
                            ) : (
                              <a className="message-file" href={msg.attachment_path} rel="noopener noreferrer" target="_blank">
                                <IconFile /> {msg.attachment_path.split('/').pop()}
                              </a>
                            )}
                          </div>
                        )}
                        <p>{msg.body}</p>
                        <div className="message-meta">
                          <time>{formatTime.format(new Date(msg.created_at))}</time>
                          {isOwn && <span className="message-check"><IconCheck /></span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {fileAttachments.length > 0 && (
              <div className="file-previews">
                {fileAttachments.map((att, i) => (
                  <div className="file-preview-item" key={i}>
                    {att.previewUrl && <img alt="" className="file-preview-thumb" src={att.previewUrl} />}
                    {!att.previewUrl && <span className="file-preview-icon">{att.type === 'video' ? '🎬' : att.type === 'audio' ? '🎵' : '📄'}</span>}
                    <span className="file-preview-name">{att.file.name}</span>
                    <button className="icon-btn small" onClick={() => removeAttachment(i)} type="button">
                      <IconClose />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {status && <div className="chat-status">{status}</div>}

            <form className="composer" onSubmit={sendMessage}>
              <button className="icon-btn attach-btn" onClick={() => setShowAttachMenu(!showAttachMenu)} type="button">
                <IconAttach />
              </button>
              {showAttachMenu && (
                <div className="attach-menu">
                  <button className="attach-menu-item" onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }} type="button">
                    <span className="attach-menu-icon">📄</span> Documento
                  </button>
                  <button className="attach-menu-item" onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }} type="button">
                    <span className="attach-menu-icon">📷</span> Foto
                  </button>
                </div>
              )}
              <input
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                aria-hidden="true"
                className="file-input-hidden"
                multiple
                onChange={handleFileSelect}
                ref={fileInputRef}
                tabIndex={-1}
                type="file"
              />
              <div className="composer-input-wrapper">
                <input
                  aria-label="Escribir mensaje"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === '/' && draft.length === 0) setShowCommandHelp(true);
                  }}
                  placeholder="Escribe un mensaje"
                  type="text"
                  value={draft}
                />
              </div>
              <button
                className={`send-btn ${draft.trim() || fileAttachments.length > 0 ? 'active' : ''}`}
                disabled={!draft.trim() && fileAttachments.length === 0}
                type="submit"
              >
                <IconSend />
              </button>
            </form>
          </>
        ) : (
          <div className="no-chat-selected">
            <div className="no-chat-content">
              <IconNoChat />
              <h2>BI Chat</h2>
              <p>Envía y recibe mensajes sin mantener tu teléfono conectado.</p>
              <span>Usa la búsqueda para empezar un chat</span>
            </div>
          </div>
        )}
      </section>

      <nav className="mobile-bottom-nav">
        <button onClick={() => setMobileView('chats')} className={mobileView === 'chats' ? 'active' : ''} type="button">
          <IconMessages /> <span>Chats</span>
        </button>
        <button onClick={() => setSearchOpen(true)} type="button">
          <IconSearch /> <span>Buscar</span>
        </button>
        <button onClick={() => setSettingsOpen(true)} type="button">
          <IconSettings /> <span>Ajustes</span>
        </button>
      </nav>

      {settingsOpen && (
        <SettingsDialog
          displayName={displayName}
          onClose={() => setSettingsOpen(false)}
          onStatus={setStatus}
          username={username}
        />
      )}
      {qrOpen && (
        <QrSearchDialog
          onClose={() => setQrOpen(false)}
          onSearch={(value) => { setSearchQuery(value); setSearchOpen(true); setQrOpen(false); }}
          onStatus={setStatus}
          username={username}
        />
      )}
      {showCommandHelp && (
        <CommandHelpDialog onClose={() => setShowCommandHelp(false)} />
      )}
    </main>
  );
}

function ConversationItem({
  conversation,
  isActive,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`conversation-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <div className="user-avatar" style={{ background: getAvatarColor(conversation.id) }}>
        {getInitials(conversation.title ?? 'Chat')}
      </div>
      <div className="conversation-info">
        <div className="conversation-info-top">
          <span className="conversation-name">{conversation.title ?? 'Conversación'}</span>
          <time className="conversation-time">
            {formatTime.format(new Date(conversation.updated_at))}
          </time>
        </div>
        <p className="conversation-preview">Toca para abrir el chat</p>
      </div>
    </button>
  );
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
    const { error } = await supabase.auth.updateUser({ data: { display_name: name.trim() } });
    onStatus(error ? 'No se pudo guardar el perfil.' : 'Perfil guardado.');
    if (!error) onClose();
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <section aria-labelledby="settings-title" aria-modal="true" className="dialog-panel" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="dialog-header">
          <h2 id="settings-title">Ajustes</h2>
          <button aria-label="Cerrar" className="icon-btn" onClick={onClose} type="button">
            <IconClose />
          </button>
        </div>
        <div className="settings-profile">
          <div className="user-avatar large" style={{ background: getAvatarColor(username) }}>
            {getInitials(name)}
          </div>
          <span className="settings-focalid">{username}</span>
        </div>
        <form className="settings-form" onSubmit={saveProfile}>
          <div className="input-group">
            <label htmlFor="display-name">Nombre</label>
            <input
              id="display-name"
              onChange={(e) => setName(e.target.value)}
              value={name}
            />
          </div>
          <div className="input-group">
            <label>FOCALID</label>
            <input readOnly value={username} />
          </div>
          <div className="settings-actions">
            <button className="primary-btn" type="submit">Guardar</button>
            <button className="danger-btn" onClick={signOut} type="button">Cerrar sesión</button>
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
      onStatus('Tu navegador no permite leer QR desde imagen.');
      return;
    }
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const bitmap = await createImageBitmap(file);
    const codes = await detector.detect(bitmap);
    const value = codes[0]?.rawValue ?? '';
    if (!value) { onStatus('No se encontró un QR legible.'); return; }
    setQrValue(value);
    onSearch(value);
  }

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <section aria-labelledby="qr-title" aria-modal="true" className="dialog-panel" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="dialog-header">
          <h2 id="qr-title">Buscar por QR</h2>
          <button aria-label="Cerrar" className="icon-btn" onClick={onClose} type="button">
            <IconClose />
          </button>
        </div>
        <div className="qr-card" aria-label="Tu QR de perfil">
          {ownQr.map((row, ri) => (
            <div className="qr-row" key={ri}>
              {row.map((cell, ci) => (
                <span className={`qr-cell ${cell ? 'active' : ''}`} key={ci} />
              ))}
            </div>
          ))}
        </div>
        <form className="settings-form" onSubmit={(e) => { e.preventDefault(); if (qrValue.trim()) onSearch(qrValue.trim()); }}>
          <div className="input-group">
            <label htmlFor="qr-file">Leer QR desde imagen</label>
            <input
              id="qr-file"
              accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void decodeImage(f); }}
              type="file"
            />
          </div>
          <div className="input-group">
            <label htmlFor="qr-value">O pega una clave</label>
            <input
              id="qr-value"
              onChange={(e) => setQrValue(e.target.value)}
              placeholder="Usuario, nombre o id"
              value={qrValue}
            />
          </div>
          <button className="primary-btn" type="submit">Buscar</button>
        </form>
      </section>
    </div>
  );
}

function makeReadableQr(value: string) {
  const size = 11;
  const seed = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const finder =
        (row < 3 && col < 3) || (row < 3 && col > size - 4) || (row > size - 4 && col < 3);
      return finder || ((row * 7 + col * 11 + seed) % 5 < 2);
    }),
  );
}

function CommandHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <section aria-labelledby="commands-title" aria-modal="true" className="dialog-panel" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="dialog-header">
          <h2 id="commands-title">Comandos</h2>
          <button aria-label="Cerrar" className="icon-btn" onClick={onClose} type="button">
            <IconClose />
          </button>
        </div>
        <div className="command-help-list">
          {[
            ['/future=1M [texto]', 'Mensaje programado'],
            ['/onevision=5 [texto]', 'Auto-destruible'],
            ['/boom=100-Hola', 'Envía 100 mensajes'],
            ['/spam=50-Hola', 'Envía 50 mensajes'],
            ['/echo=3-Hola', 'Repetir texto'],
            ['/ascii=Hello', 'Arte ASCII'],
            ['/hack=5', 'Animación hack'],
            ['/speak=Hello', 'Texto a voz'],
            ['/countdown=10', 'Cuenta regresiva'],
          ].map(([cmd, desc]) => (
            <div className="command-help-item" key={cmd}>
              <code>{cmd}</code>
              <span>{desc}</span>
            </div>
          ))}
        </div>
        <button className="primary-btn full-width" onClick={onClose} type="button">Entendido</button>
      </section>
    </div>
  );
}

/* ─── Icons ─── */

function IconNewChat() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 14H6l-2 2V4h16v12z"/>
      <path d="M13 5h-2v4H7v2h4v4h2v-4h4V9h-4z"/>
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
    </svg>
  );
}

function IconQr() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 3h8v8H3V3zm3 3v2h2V6H6zm7-3h8v8h-8V3zm3 3v2h2V6h-2zM3 13h8v8H3v-8zm3 3v2h2v-2H6zm9-3h2v2h-2v-2zm4 0h2v4h-4v-2h2v-2zm-6 4h2v4h-2v-4zm4 2h4v2h-4v-2z"/>
    </svg>
  );
}

function IconBack() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
    </svg>
  );
}

function IconAttach() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
    </svg>
  );
}

function IconMessages() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/>
    </svg>
  );
}

function IconFile() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
    </svg>
  );
}

function IconNoChat() {
  return (
    <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#667781" strokeWidth="1">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      <line x1="7" y1="10" x2="17" y2="10"/>
      <line x1="7" y1="14" x2="13" y2="14"/>
    </svg>
  );
}

function IconEmptyChat() {
  return (
    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#667781" strokeWidth="1.5">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
    </svg>
  );
}
