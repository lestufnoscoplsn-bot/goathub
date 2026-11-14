// Qui est connecté (et avec quel statut), en mémoire.
export type Status = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

interface Conn { idle: boolean }
const connections = new Map<number, Map<string, Conn>>(); // userId -> socketId -> état
const lastAnnounced = new Map<number, Status>();

export function addConnection(userId: number, socketId: string) {
  if (!connections.has(userId)) connections.set(userId, new Map());
  connections.get(userId)!.set(socketId, { idle: false });
}

export function removeConnection(userId: number, socketId: string) {
  const conns = connections.get(userId);
  conns?.delete(socketId);
  if (conns && !conns.size) connections.delete(userId);
}

export function setIdle(userId: number, socketId: string, idle: boolean) {
  const conn = connections.get(userId)?.get(socketId);
  if (conn) conn.idle = idle;
}

export const isConnected = (userId: number) => (connections.get(userId)?.size ?? 0) > 0;
export const socketIdsOf = (userId: number) => [...(connections.get(userId)?.keys() ?? [])];

/** Le statut que voient les autres. */
export function visibleStatus(userId: number, preference: string): Status {
  const conns = connections.get(userId);
  if (!conns?.size || preference === 'invisible') return 'offline';
  if (preference === 'online' && [...conns.values()].every((c) => c.idle)) return 'idle';
  return preference as Status;
}

/** Renvoie le nouveau statut s'il a changé depuis la dernière annonce, sinon null. */
export function statusChange(userId: number, preference: string): Status | null {
  const status = visibleStatus(userId, preference);
  if (lastAnnounced.get(userId) === status) return null;
  lastAnnounced.set(userId, status);
  return status;
}
