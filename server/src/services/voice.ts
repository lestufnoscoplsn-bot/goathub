// État des salons vocaux et des appels (en mémoire).
export interface VoiceUser {
  userId: number;
  socketId: string;
  muted: boolean;
  deafened: boolean;
  serverMuted: boolean;
  video: boolean;
  screen: boolean;
  joinedAt: number;
}

const rooms = new Map<number, Map<number, VoiceUser>>(); // channelId -> userId -> état
const userChannel = new Map<number, number>();            // userId -> channelId

export const voiceUsers = (channelId: number) => [...(rooms.get(channelId)?.values() ?? [])].map(({ socketId, ...u }) => u);
export const voiceChannelOf = (userId: number) => userChannel.get(userId) ?? null;
export const voiceEntry = (channelId: number, userId: number) => rooms.get(channelId)?.get(userId) ?? null;
export const activeVoiceChannels = () => [...rooms.keys()];
export const voiceCount = (channelId: number) => rooms.get(channelId)?.size ?? 0;

export function addVoice(channelId: number, entry: VoiceUser) {
  if (!rooms.has(channelId)) rooms.set(channelId, new Map());
  rooms.get(channelId)!.set(entry.userId, entry);
  userChannel.set(entry.userId, channelId);
}

/** Retire quelqu'un ; renvoie true s'il était bien dans ce salon. */
export function removeVoice(channelId: number, userId: number): boolean {
  const room = rooms.get(channelId);
  if (!room?.delete(userId)) return false;
  if (!room.size) rooms.delete(channelId);
  if (userChannel.get(userId) === channelId) userChannel.delete(userId);
  return true;
}

// ----- Appels privés -----
export interface Call {
  channelId: number;
  startedBy: number;
  startedAt: number;
  ringing: Set<number>;
  timer?: NodeJS.Timeout;
}
export const calls = new Map<number, Call>();
export const callPayload = (c: Call) => ({ channelId: c.channelId, startedBy: c.startedBy, ringing: [...c.ringing] });
