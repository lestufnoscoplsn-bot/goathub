// Outils partagés du temps réel : envoyer un événement à un utilisateur, un serveur, un salon…
import type { Server } from 'socket.io';
import { query } from '../db/pool.js';
import type { ChannelRow } from '../services/access.js';
import { serverPayload } from '../services/serialize.js';

let io: Server;
export const setIo = (server: Server) => { io = server; };
export const getIo = () => io;

export const userRoom = (id: number) => `user:${id}`;
export const serverRoom = (id: number) => `server:${id}`;

export const emitToUser = (userId: number, event: string, payload: unknown) => io.to(userRoom(userId)).emit(event, payload);
export const emitToServer = (serverId: number, event: string, payload: unknown) => io.to(serverRoom(serverId)).emit(event, payload);

export async function recipientsOf(channelId: number): Promise<number[]> {
  return (await query<{ user_id: number }>('SELECT user_id FROM channel_recipients WHERE channel_id = $1', [channelId])).map((r) => r.user_id);
}

/** Envoie un événement à tous ceux qui voient ce salon (sauf éventuellement une connexion). */
export async function emitToChannel(channel: Pick<ChannelRow, 'id' | 'server_id'>, event: string, payload: unknown, exceptSocket?: string) {
  let target = exceptSocket ? io.except(exceptSocket) : io;
  if (channel.server_id) target = target.to(serverRoom(channel.server_id));
  else target = target.to((await recipientsOf(channel.id)).map(userRoom));
  target.emit(event, payload);
}

/** Renvoie à tous les membres l'état complet et à jour d'un serveur. */
export async function syncServer(serverId: number) {
  const payload = await serverPayload(serverId);
  if (payload) emitToServer(serverId, 'server:update', payload);
}

export const joinServerRoom = (userId: number, serverId: number) => io.in(userRoom(userId)).socketsJoin(serverRoom(serverId));
export const leaveServerRoom = (userId: number, serverId: number) => io.in(userRoom(userId)).socketsLeave(serverRoom(serverId));

/** Ceux qui doivent voir le statut d'un utilisateur : les membres de ses serveurs et ses amis. */
export async function presenceAudience(userId: number): Promise<string[]> {
  const [servers, friends] = await Promise.all([
    query<{ server_id: number }>('SELECT server_id FROM members WHERE user_id = $1', [userId]),
    query<{ id: number }>(`SELECT other_id AS id FROM friendships WHERE user_id = $1 AND status = 'accepted'
                           UNION SELECT user_id FROM channel_recipients WHERE channel_id IN
                             (SELECT channel_id FROM channel_recipients WHERE user_id = $1)`, [userId]),
  ]);
  return [...servers.map((s) => serverRoom(s.server_id)), ...friends.map((f) => userRoom(f.id)), userRoom(userId)];
}
