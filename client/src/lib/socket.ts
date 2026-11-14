// Connexion temps réel avec le serveur (Socket.IO / WebSocket) et réception des événements.
import { io, type Socket } from 'socket.io-client';
import { getRoute } from './router';
import { emptyVoice, get, rememberUsers, removeServer, set, toast, upsertDm, upsertServer } from './store';
import type { Call, Dm, Message, Relation, Server, User, VoiceUser } from './types';
import { notifyMessage, notifyText } from './notify';
import { sounds } from './sounds';
import { voice } from '../voice/voice';

let socket: Socket | null = null;

export function emit<T = any>(event: string, data: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('Connexion au serveur perdue.'));
    socket.timeout(15_000).emit(event, data, (err: Error | null, res: { ok: boolean; data: T; error: string }) => {
      if (err) return reject(new Error('Le serveur ne répond pas.'));
      if (res.ok) resolve(res.data);
      else reject(new Error(res.error));
    });
  });
}

export const rawEmit = (event: string, data: unknown) => socket?.emit(event, data);

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Erreur.'), { status: res.status });
  return data as T;
}

export async function uploadFile(file: File, onProgress?: (p: number) => void): Promise<{ id: string; url: string; name: string; size: number; kind: string }> {
  const max = get().config.maxUploadMb;
  if (file.size > max * 1048576) throw new Error(`« ${file.name} » est trop volumineux (${max} Mo maximum).`);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name || 'fichier'));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* réponse vide */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error ?? "L'envoi a échoué."));
    };
    xhr.onerror = () => reject(new Error("L'envoi a échoué."));
    xhr.send(file);
  });
}

function updateMessage(channelId: number, fn: (list: Message[]) => Message[]) {
  set((s) => {
    const cache = s.messages[channelId];
    if (!cache) return {};
    return { messages: { ...s.messages, [channelId]: { ...cache, list: fn(cache.list) } } };
  });
}

/** Le salon actuellement affiché. */
export function viewedChannelId(): number | null {
  const route = getRoute();
  if (route.name === 'home') return route.dmId ?? null;
  if (route.name === 'server') return route.channelId ?? null;
  return null;
}

export function markRead(channelId: number, messageId?: number) {
  const had = !!get().reads[channelId];
  set((s) => {
    const reads = { ...s.reads };
    delete reads[channelId];
    return { reads };
  });
  if (had || messageId) socket?.emit('channel:ack', { channelId, ...(messageId ? { messageId } : {}) });
}

export async function loadInitial() {
  const data = await emit<any>('init');
  const users: User[] = [data.me];
  set({
    me: data.me,
    servers: {},
    serverOrder: [],
    dms: [],
    relations: {},
    reads: data.reads,
    voiceStates: data.voiceStates,
    calls: Object.fromEntries(data.calls.map((c: Call) => [c.channelId, c])),
    livekitUrl: data.livekitUrl,
    publicUrl: data.publicUrl,
    phase: 'ready',
  });
  for (const server of data.servers as Server[]) upsertServer(server);
  for (const dm of data.dms as Dm[]) upsertDm(dm);
  for (const r of data.relations as { user: User; type: Relation }[]) users.push(r.user);
  rememberUsers(users);
  set({ relations: Object.fromEntries(data.relations.map((r: any) => [r.user.id, r.type])) });
}

export function connect() {
  socket?.disconnect();
  socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });

  socket.on('connect', async () => {
    try {
      await loadInitial();
      set({ messages: {} }); // l'historique est rechargé à la demande
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  });

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') {
      socket?.disconnect();
      set({ phase: 'auth', me: null });
    } else if (get().phase === 'loading') set({ phase: 'offline' });
  });

  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') {
      // Le serveur a fermé la session (déconnexion à distance, mot de passe changé…)
      voice.leave(true);
      set({ phase: 'auth', me: null });
      toast('Tu as été déconnecté de cet appareil.', 'error');
    } else if (get().phase === 'ready') {
      toast('Connexion perdue, reconnexion…', 'error');
    }
  });

  socket.on('presence', ({ userId, status }: { userId: number; status: User['status'] }) => {
    set((s) => {
      const users = s.users[userId] ? { ...s.users, [userId]: { ...s.users[userId], status } } : s.users;
      const me = s.me?.id === userId ? { ...s.me, status } : s.me;
      return { users, me };
    });
  });

  socket.on('user:update', (user: User) => {
    rememberUsers([user]);
    set((s) => (s.me?.id === user.id ? { me: { ...s.me, ...user } } : {}));
  });

  socket.on('relation:update', ({ user, type }: { user: User; type: Relation | null }) => {
    rememberUsers([user]);
    const before = get().relations[user.id];
    set((s) => {
      const relations = { ...s.relations };
      if (type) relations[user.id] = type;
      else delete relations[user.id];
      return { relations };
    });
    if (type === 'incoming' && before !== 'incoming') notifyText(`${user.username} t'a envoyé une demande d'ami`, '', '/channels/@me');
    if (type === 'friend' && before === 'outgoing') toast(`${user.username} a accepté ta demande d'ami !`, 'success');
  });

  socket.on('server:update', (server: Server) => upsertServer(server));
  socket.on('server:removed', ({ serverId }: { serverId: number }) => {
    const server = get().servers[serverId];
    removeServer(serverId);
    if (voice.serverOf() === serverId) voice.leave(true);
    const route = getRoute();
    if (route.name === 'server' && route.serverId === serverId) {
      history.replaceState(null, '', '/channels/@me');
      dispatchEvent(new PopStateEvent('popstate'));
      if (server) toast(`Tu ne fais plus partie de « ${server.name} ».`);
    }
  });

  socket.on('dm:update', (dm: Dm) => upsertDm(dm));
  socket.on('dm:removed', ({ channelId }: { channelId: number }) => set((s) => ({ dms: s.dms.filter((d) => d.id !== channelId) })));

  socket.on('message:new', (msg: Message) => {
    const s = get();
    if (msg.author) rememberUsers([{ ...(s.users[msg.author.id] ?? { accentColor: '#7b5cff', bio: '', customStatus: '', status: 'offline' }), ...msg.author } as User]);
    updateMessage(msg.channelId, (list) => {
      const withoutPending = msg.nonce ? list.filter((m) => m.nonce !== msg.nonce) : list;
      return withoutPending.some((m) => m.id === msg.id) ? withoutPending : [...withoutPending, msg];
    });
    if (!msg.serverId) {
      const dm = s.dms.find((d) => d.id === msg.channelId);
      if (dm) upsertDm({ ...dm, lastMessageId: msg.id });
    }
    if (msg.author?.id === s.me?.id) return;
    const viewing = viewedChannelId() === msg.channelId && document.hasFocus();
    set((st) => ({ typing: { ...st.typing, [msg.channelId]: Object.fromEntries(Object.entries(st.typing[msg.channelId] ?? {}).filter(([u]) => Number(u) !== msg.author?.id)) } }));
    if (viewing) {
      dispatchEvent(new CustomEvent('gh:new-message', { detail: msg }));
      return;
    }
    const mentioned = !msg.serverId || msg.mentions.includes(s.me!.id) || msg.mentionEveryone;
    set((st) => {
      const prev = st.reads[msg.channelId] ?? { unread: 0, mentions: 0 };
      return { reads: { ...st.reads, [msg.channelId]: { unread: prev.unread + 1, mentions: prev.mentions + (mentioned ? 1 : 0) } } };
    });
    if (mentioned) notifyMessage(msg);
  });

  socket.on('message:update', (msg: Message) => updateMessage(msg.channelId, (list) => list.map((m) => (m.id === msg.id ? msg : m))));
  socket.on('message:delete', ({ channelId, messageId }: { channelId: number; messageId: number }) =>
    updateMessage(channelId, (list) => list.filter((m) => m.id !== messageId).map((m) => (m.replyTo?.id === messageId ? { ...m, replyTo: null } : m))));

  socket.on('typing', ({ channelId, userId }: { channelId: number; userId: number }) => {
    set((s) => ({ typing: { ...s.typing, [channelId]: { ...s.typing[channelId], [userId]: Date.now() + 8000 } } }));
  });

  socket.on('voice:update', ({ channelId, users }: { channelId: number; users: VoiceUser[] }) => {
    const before = get().voiceStates[channelId] ?? [];
    set((s) => {
      const voiceStates = { ...s.voiceStates };
      if (users.length) voiceStates[channelId] = users;
      else delete voiceStates[channelId];
      return { voiceStates };
    });
    if (get().voice.channelId === channelId) {
      const me = get().me?.id;
      const joined = users.filter((u) => u.userId !== me && !before.some((b) => b.userId === u.userId));
      const left = before.filter((b) => b.userId !== me && !users.some((u) => u.userId === b.userId));
      if (joined.length) sounds.join();
      else if (left.length) sounds.leave();
    }
  });
  socket.on('voice:force-leave', ({ channelId, reason }: { channelId: number; reason: string }) => {
    if (get().voice.channelId === channelId) {
      voice.leave(true);
      toast(reason);
    }
  });
  socket.on('voice:permissions', (p: { channelId: number; speak: boolean; stream: boolean; serverMuted: boolean }) => voice.applyPermissions(p));

  socket.on('call:update', (call: Call) => {
    set((s) => {
      const calls = { ...s.calls };
      if (call.ended) delete calls[call.channelId];
      else calls[call.channelId] = call;
      return { calls };
    });
  });
  socket.on('call:declined', ({ userId }: { userId: number }) => toast(`${get().users[userId]?.username ?? "Quelqu'un"} a refusé l'appel.`));

  socket.on('security:alert', ({ message }: { message: string }) => {
    sounds.mention();
    set({ modal: { kind: 'confirm', title: '⚠️ Alerte de sécurité', text: message, confirm: 'Voir la sécurité', onConfirm: () => set({ modal: { kind: 'userSettings', tab: 'security' } }) } });
    notifyText('Alerte de sécurité GoatHub', message, null);
  });
}

export function disconnect() {
  socket?.disconnect();
  socket = null;
  set({ voice: emptyVoice });
}
