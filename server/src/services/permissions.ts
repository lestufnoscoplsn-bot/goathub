// Permissions des rôles (comme Discord : chaque permission est un bit).
import { one, query, type Db } from '../db/pool.js';
import { AppError } from './errors.js';

export const P = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  MANAGE_MESSAGES: 1 << 4,
  KICK_MEMBERS: 1 << 5,
  BAN_MEMBERS: 1 << 6,
  MODERATE_MEMBERS: 1 << 7, // rendre muet, exclure temporairement, déconnecter du vocal, voir les signalements
  CREATE_INVITE: 1 << 8,
  SEND_MESSAGES: 1 << 9,
  ATTACH_FILES: 1 << 10,
  ADD_REACTIONS: 1 << 11,
  MENTION_EVERYONE: 1 << 12,
  CONNECT: 1 << 13,
  SPEAK: 1 << 14,
  STREAM: 1 << 15,
} as const;

export const ALL_PERMISSIONS = (1 << 16) - 1;
export const DEFAULT_PERMISSIONS = P.CREATE_INVITE | P.SEND_MESSAGES | P.ATTACH_FILES | P.ADD_REACTIONS | P.CONNECT | P.SPEAK | P.STREAM;

export interface MemberContext {
  serverId: number;
  ownerId: number;
  userId: number;
  permissions: number;
  topPosition: number; // position du rôle le plus haut (Infinity pour le propriétaire)
  mutedUntil: Date | null;
  voiceMuted: boolean;
}

export async function memberContext(serverId: number, userId: number, db?: Db): Promise<MemberContext | null> {
  const row = await one<any>(
    `SELECT s.owner_id, m.muted_until, m.voice_muted,
            COALESCE(BIT_OR(r.permissions), 0) AS perms, COALESCE(MAX(r.position) FILTER (WHERE NOT r.is_default), 0) AS top
       FROM members m
       JOIN servers s ON s.id = m.server_id
       LEFT JOIN roles r ON r.server_id = m.server_id
            AND (r.is_default OR r.id IN (SELECT role_id FROM member_roles mr WHERE mr.user_id = m.user_id AND mr.server_id = m.server_id))
      WHERE m.server_id = $1 AND m.user_id = $2
      GROUP BY s.owner_id, m.muted_until, m.voice_muted`,
    [serverId, userId], db,
  );
  if (!row) return null;
  const isOwner = row.owner_id === userId;
  let permissions = isOwner ? ALL_PERMISSIONS : Number(row.perms);
  if (permissions & P.ADMINISTRATOR) permissions = ALL_PERMISSIONS;
  const mutedUntil = row.muted_until && new Date(row.muted_until) > new Date() ? new Date(row.muted_until) : null;
  return {
    serverId, ownerId: row.owner_id, userId, permissions,
    topPosition: isOwner ? Infinity : Number(row.top),
    mutedUntil, voiceMuted: row.voice_muted,
  };
}

/** Le membre doit faire partie du serveur et (si demandé) avoir la permission. */
export async function requireMember(serverId: number, userId: number, perm = 0): Promise<MemberContext> {
  const ctx = await memberContext(serverId, userId);
  if (!ctx) throw new AppError('Serveur introuvable.', 'not_found');
  if (perm && (ctx.permissions & perm) !== perm) throw new AppError("Tu n'as pas la permission de faire ça.", 'forbidden');
  return ctx;
}

export function requireNotTimedOut(ctx: MemberContext): void {
  if (ctx.mutedUntil) {
    throw new AppError(`Tu es exclu temporairement de ce serveur jusqu'à ${ctx.mutedUntil.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`, 'timed_out');
  }
}

/** Vérifie qu'un modérateur peut agir sur une cible (hiérarchie des rôles, propriétaire intouchable). */
export async function requireAbove(actor: MemberContext, targetId: number): Promise<MemberContext> {
  if (targetId === actor.userId) throw new AppError('Tu ne peux pas faire ça sur toi-même.');
  const target = await memberContext(actor.serverId, targetId);
  if (!target) throw new AppError('Ce membre est introuvable.');
  if (targetId === actor.ownerId) throw new AppError('Impossible : cette personne est propriétaire du serveur.');
  if (actor.topPosition <= target.topPosition) throw new AppError("Son rôle est égal ou supérieur au tien : tu ne peux pas agir sur cette personne.");
  return target;
}

export async function rolePositions(serverId: number, roleIds: number[]): Promise<Map<number, number>> {
  if (!roleIds.length) return new Map();
  const rows = await query<{ id: number; position: number }>('SELECT id, position FROM roles WHERE server_id = $1 AND id = ANY($2)', [serverId, roleIds]);
  return new Map(rows.map((r) => [r.id, r.position]));
}
