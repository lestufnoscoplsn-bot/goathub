// État global de l'application (bibliothèque zustand).
import { create } from 'zustand';
import { local } from './storage';
import type { Call, Dm, Me, Message, Relation, Server, User, VoiceUser } from './types';

export interface ChannelMessages { list: Message[]; hasMore: boolean; loaded: boolean; loading: boolean }

export type Modal =
  | { kind: 'createServer' }
  | { kind: 'invite'; serverId: number }
  | { kind: 'serverSettings'; serverId: number; tab?: string }
  | { kind: 'channelSettings'; channelId: number; serverId: number }
  | { kind: 'createChannel'; serverId: number; type?: 'text' | 'voice'; categoryId?: number | null }
  | { kind: 'userSettings'; tab?: string }
  | { kind: 'report'; userId: number; messageId?: number; serverId?: number }
  | { kind: 'newGroup'; channelId?: number }
  | { kind: 'confirm'; title: string; text: string; danger?: boolean; confirm: string; onConfirm: () => Promise<unknown> | unknown }
  | { kind: 'moderate'; serverId: number; userId: number; action: 'kick' | 'ban' | 'timeout' }
  | { kind: 'image'; url: string; name: string }
  | { kind: 'recoveryCodes'; codes: string[] }
  | { kind: 'prompt'; title: string; label: string; value?: string; maxLength?: number; confirm: string; allowEmpty?: boolean; text?: string; onSubmit: (value: string) => Promise<unknown> | unknown };

export interface Toast { id: number; text: string; tone?: 'info' | 'error' | 'success' }

export interface VoiceSession {
  channelId: number | null;
  connecting: boolean;
  muted: boolean;
  deafened: boolean;
  canSpeak: boolean;
  canStream: boolean;
  screen: boolean;
  camera: boolean;
  speaking: Record<number, boolean>;
  quality: Record<number, string>;
  error: string | null;
}

export interface State {
  phase: 'loading' | 'auth' | 'ready' | 'offline';
  config: { signupCodeRequired: boolean; maxUploadMb: number };
  me: Me | null;
  users: Record<number, User>;
  servers: Record<number, Server>;
  serverOrder: number[];
  dms: Dm[];
  relations: Record<number, Relation>;
  reads: Record<number, { unread: number; mentions: number }>;
  voiceStates: Record<number, VoiceUser[]>;
  calls: Record<number, Call>;
  messages: Record<number, ChannelMessages>;
  typing: Record<number, Record<number, number>>;
  livekitUrl: string;
  publicUrl: string;
  lastChannel: Record<number, number>;
  showMembers: boolean;
  mobileNav: boolean;
  modal: Modal | null;
  toasts: Toast[];
  voice: VoiceSession;
  pendingInvite: string | null;
}

export const emptyVoice: VoiceSession = {
  channelId: null, connecting: false, muted: local.get('muted', false), deafened: local.get('deafened', false),
  canSpeak: true, canStream: true, screen: false, camera: false, speaking: {}, quality: {}, error: null,
};

export const useStore = create<State>(() => ({
  phase: 'loading',
  config: { signupCodeRequired: false, maxUploadMb: 25 },
  me: null,
  users: {},
  servers: {},
  serverOrder: [],
  dms: [],
  relations: {},
  reads: {},
  voiceStates: {},
  calls: {},
  messages: {},
  typing: {},
  livekitUrl: '',
  publicUrl: location.origin,
  lastChannel: local.get('lastChannel', {}),
  showMembers: local.get('showMembers', true),
  mobileNav: false,
  modal: null,
  toasts: [],
  voice: emptyVoice,
  pendingInvite: null,
}));

export const set = useStore.setState;

// Valeurs vides PARTAGÉES : un sélecteur ne doit jamais renvoyer un nouvel objet à chaque appel
// (sinon React croit que l'état change sans arrêt et boucle à l'infini).
export const NO_VOICE: VoiceUser[] = [];
export const NO_SPEAKING: Record<number, boolean> = {};
export const get = useStore.getState;

let toastId = 0;
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
}
export const openModal = (modal: Modal) => set({ modal });
export const closeModal = () => set({ modal: null });

export function rememberUsers(users: (User | null | undefined)[]) {
  set((s) => {
    const next = { ...s.users };
    for (const u of users) if (u) next[u.id] = { ...next[u.id], ...u };
    return { users: next };
  });
}

export function upsertServer(server: Server) {
  rememberUsers(server.members.map((m) => m.user));
  set((s) => ({
    servers: { ...s.servers, [server.id]: server },
    serverOrder: s.serverOrder.includes(server.id) ? s.serverOrder : [...s.serverOrder, server.id],
  }));
}

export function removeServer(serverId: number) {
  set((s) => {
    const servers = { ...s.servers };
    delete servers[serverId];
    return { servers, serverOrder: s.serverOrder.filter((id) => id !== serverId) };
  });
}

export function upsertDm(dm: Dm) {
  rememberUsers(dm.recipients);
  set((s) => {
    const others = s.dms.filter((d) => d.id !== dm.id);
    return { dms: [dm, ...others].sort((a, b) => b.lastMessageId - a.lastMessageId) };
  });
}

/** Nom affiché dans un serveur : le pseudo de serveur s'il existe. */
export function displayName(userId: number, serverId?: number | null): string {
  const s = get();
  if (serverId) {
    const member = s.servers[serverId]?.members.find((m) => m.user.id === userId);
    if (member?.nickname) return member.nickname;
  }
  return s.users[userId]?.username ?? 'Utilisateur inconnu';
}

export function roleColor(userId: number, serverId?: number | null): string | undefined {
  if (!serverId) return undefined;
  const server = get().servers[serverId];
  const member = server?.members.find((m) => m.user.id === userId);
  if (!member) return undefined;
  return server.roles.find((r) => !r.isDefault && member.roles.includes(r.id) && r.color !== '#9aa4b8')?.color;
}

export function dmName(dm: Dm): string {
  if (dm.name) return dm.name;
  const me = get().me?.id;
  const others = dm.recipients.filter((r) => r.id !== me);
  return others.map((r) => r.username).join(', ') || 'Groupe vide';
}

export function findChannelServer(channelId: number): Server | undefined {
  return Object.values(get().servers).find((s) => s.channels.some((c) => c.id === channelId));
}
