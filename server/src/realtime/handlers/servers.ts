// Serveurs, invitations, catégories, salons, rôles et pseudos.
import crypto from 'node:crypto';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { findValidInvite } from '../../http/invites.js';
import { AppError } from '../../services/errors.js';
import { closeRoom } from '../../services/livekit.js';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, P, requireAbove, requireMember, type MemberContext } from '../../services/permissions.js';
import { serverPayload } from '../../services/serialize.js';
import { activeVoiceChannels, voiceUsers } from '../../services/voice.js';
import { emitToServer, emitToUser, joinServerRoom, leaveServerRoom, syncServer } from '../hub.js';
import { action, id, txt } from '../registry.js';
import { disconnectVoiceInServer, endVoiceRoom } from './voice.js';

const MAX_SERVERS_OWNED = 50;
const MAX_CHANNELS = 200;
const MAX_ROLES = 100;

export async function audit(serverId: number, actorId: number, actionName: string, target = '', details = '') {
  await query('INSERT INTO audit_log (server_id, actor_id, action, target, details) VALUES ($1, $2, $3, $4, $5)',
    [serverId, actorId, actionName, target.slice(0, 200), details.slice(0, 300)]);
}

async function requireImage(uploadId: string | null | undefined, userId: number) {
  if (!uploadId) return;
  const file = await one<any>('SELECT owner_id, kind FROM uploads WHERE id = $1', [uploadId]);
  if (!file || file.owner_id !== userId || file.kind !== 'image') throw new AppError('Image invalide.');
}

const inviteCode = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);

/** Ajoute un membre à un serveur (et prévient tout le monde). */
export async function addMember(serverId: number, userId: number) {
  await tx(async (db) => {
    await db.query('INSERT INTO members (server_id, user_id) VALUES ($1, $2)', [serverId, userId]);
    // Les anciens messages ne comptent pas comme « non lus » pour un nouveau membre
    await db.query(`INSERT INTO read_states (user_id, channel_id, last_read_id)
                    SELECT $1, c.id, COALESCE((SELECT max(id) FROM messages WHERE channel_id = c.id), 0) FROM channels c WHERE c.server_id = $2
                    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id`, [userId, serverId]);
  });
  joinServerRoom(userId, serverId);
  await syncServer(serverId);
}

/** Retire un membre (départ, expulsion, bannissement). */
export async function removeMember(serverId: number, userId: number) {
  await query('DELETE FROM members WHERE server_id = $1 AND user_id = $2', [serverId, userId]);
  await disconnectVoiceInServer(serverId, userId);
  leaveServerRoom(userId, serverId);
  emitToUser(userId, 'server:removed', { serverId });
  await syncServer(serverId);
}

// ----- Serveurs -----

action('server:create', z.object({ name: txt(60, 2), iconId: z.string().regex(/^[A-Za-z0-9_-]{22}$/).nullable().optional() }), async (ctx, data) => {
  await requireImage(data.iconId, ctx.userId);
  const owned = await one<{ n: number }>('SELECT count(*)::int AS n FROM servers WHERE owner_id = $1', [ctx.userId]);
  if (owned!.n >= MAX_SERVERS_OWNED) throw new AppError(`Tu possèdes déjà ${MAX_SERVERS_OWNED} serveurs.`);
  const serverId = await tx(async (db) => {
    const s = (await db.query('INSERT INTO servers (name, icon_id, owner_id) VALUES ($1, $2, $3) RETURNING id', [data.name, data.iconId ?? null, ctx.userId])).rows[0].id as number;
    await db.query("INSERT INTO roles (server_id, name, permissions, position, is_default, hoist) VALUES ($1, '@everyone', $2, 0, true, false)", [s, DEFAULT_PERMISSIONS]);
    await db.query('INSERT INTO members (server_id, user_id) VALUES ($1, $2)', [s, ctx.userId]);
    const text = (await db.query("INSERT INTO categories (server_id, name, position) VALUES ($1, 'Salons textuels', 0) RETURNING id", [s])).rows[0].id;
    const voice = (await db.query("INSERT INTO categories (server_id, name, position) VALUES ($1, 'Salons vocaux', 1) RETURNING id", [s])).rows[0].id;
    await db.query("INSERT INTO channels (server_id, category_id, type, name, position) VALUES ($1, $2, 'text', 'général', 0), ($1, $3, 'voice', 'Général', 1)", [s, text, voice]);
    await db.query('INSERT INTO invites (code, server_id, created_by) VALUES ($1, $2, $3)', [inviteCode(), s, ctx.userId]);
    return s;
  });
  joinServerRoom(ctx.userId, serverId);
  return serverPayload(serverId);
});

action('server:update', z.object({ serverId: id, name: txt(60, 2).optional(), iconId: z.string().regex(/^[A-Za-z0-9_-]{22}$/).nullable().optional() }), async (ctx, data) => {
  await requireMember(data.serverId, ctx.userId, P.MANAGE_SERVER);
  await requireImage(data.iconId, ctx.userId);
  await query('UPDATE servers SET name = COALESCE($2, name), icon_id = CASE WHEN $3::boolean THEN $4 ELSE icon_id END WHERE id = $1',
    [data.serverId, data.name ?? null, data.iconId !== undefined, data.iconId ?? null]);
  await audit(data.serverId, ctx.userId, 'server_update', data.name ?? '');
  await syncServer(data.serverId);
});

action('server:delete', z.object({ serverId: id }), async (ctx, { serverId }) => {
  const member = await requireMember(serverId, ctx.userId);
  if (member.ownerId !== ctx.userId) throw new AppError('Seul le propriétaire peut supprimer le serveur.');
  for (const c of await query<{ id: number }>("SELECT id FROM channels WHERE server_id = $1 AND type = 'voice'", [serverId])) {
    await endVoiceRoom(c.id);
    await closeRoom(c.id);
  }
  emitToServer(serverId, 'server:removed', { serverId });
  await query('DELETE FROM servers WHERE id = $1', [serverId]);
});

action('server:leave', z.object({ serverId: id }), async (ctx, { serverId }) => {
  const member = await requireMember(serverId, ctx.userId);
  if (member.ownerId === ctx.userId) throw new AppError('Le propriétaire ne peut pas quitter son serveur : supprime-le ou transfère-le.');
  await removeMember(serverId, ctx.userId);
});

action('server:transfer', z.object({ serverId: id, userId: id }), async (ctx, { serverId, userId }) => {
  const member = await requireMember(serverId, ctx.userId);
  if (member.ownerId !== ctx.userId) throw new AppError('Seul le propriétaire peut transférer le serveur.');
  if (!(await one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [serverId, userId]))) throw new AppError('Ce membre est introuvable.');
  await query('UPDATE servers SET owner_id = $2 WHERE id = $1', [serverId, userId]);
  await audit(serverId, ctx.userId, 'server_transfer', String(userId));
  await syncServer(serverId);
});

// ----- Invitations -----

action('invite:create', z.object({ serverId: id, maxUses: z.number().int().min(1).max(1000).nullable().optional(), expiresInHours: z.number().int().min(1).max(24 * 30).nullable().optional() }), async (ctx, data) => {
  await requireMember(data.serverId, ctx.userId, P.CREATE_INVITE);
  const count = await one<{ n: number }>('SELECT count(*)::int AS n FROM invites WHERE server_id = $1', [data.serverId]);
  if (count!.n >= 100) throw new AppError("Trop d'invitations : supprime-en quelques-unes.");
  const code = inviteCode();
  await query(`INSERT INTO invites (code, server_id, created_by, max_uses, expires_at)
               VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(hours => $5::int) END)`,
    [code, data.serverId, ctx.userId, data.maxUses ?? null, data.expiresInHours ?? null]);
  return { code };
});

action('invite:list', z.object({ serverId: id }), async (ctx, { serverId }) => {
  await requireMember(serverId, ctx.userId, P.MANAGE_SERVER);
  return query(`SELECT i.code, i.uses, i.max_uses AS "maxUses", i.expires_at AS "expiresAt", i.created_at AS "createdAt", u.username AS "createdBy"
                  FROM invites i LEFT JOIN users u ON u.id = i.created_by WHERE i.server_id = $1 ORDER BY i.created_at DESC`, [serverId]);
});

action('invite:default', z.object({ serverId: id }), async (ctx, { serverId }) => {
  await requireMember(serverId, ctx.userId, P.CREATE_INVITE);
  const existing = await one<{ code: string }>(
    `SELECT code FROM invites WHERE server_id = $1 AND max_uses IS NULL AND expires_at IS NULL ORDER BY created_at LIMIT 1`, [serverId]);
  if (existing) return existing;
  const code = inviteCode();
  await query('INSERT INTO invites (code, server_id, created_by) VALUES ($1, $2, $3)', [code, serverId, ctx.userId]);
  return { code };
});

action('invite:delete', z.object({ serverId: id, code: z.string().max(20) }), async (ctx, { serverId, code }) => {
  await requireMember(serverId, ctx.userId, P.MANAGE_SERVER);
  await query('DELETE FROM invites WHERE server_id = $1 AND code = $2', [serverId, code]);
});

action('invite:join', z.object({ code: z.string().max(40) }), async (ctx, { code }) => {
  const clean = code.trim().replace(/^.*\/invite\//, '');
  const invite = await findValidInvite(clean);
  if (!invite) throw new AppError("Cette invitation n'existe pas ou a expiré.");
  const serverId = invite.server_id;
  if (await one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [serverId, ctx.userId])) return { serverId, already: true };
  if (await one('SELECT 1 FROM bans WHERE server_id = $1 AND user_id = $2', [serverId, ctx.userId])) throw new AppError('Tu es banni de ce serveur.');
  const count = await one<{ n: number }>('SELECT count(*)::int AS n FROM members WHERE user_id = $1', [ctx.userId]);
  if (count!.n >= 100) throw new AppError('Tu es déjà dans 100 serveurs.');
  const used = await query('UPDATE invites SET uses = uses + 1 WHERE code = $1 AND (max_uses IS NULL OR uses < max_uses) RETURNING 1', [clean]);
  if (!used.length) throw new AppError('Cette invitation a été utilisée trop de fois.');
  await addMember(serverId, ctx.userId);
  await audit(serverId, ctx.userId, 'member_join', '', `invitation ${clean}`);
  const voiceStates: Record<number, unknown> = {};
  for (const c of activeVoiceChannels()) {
    const ch = await one<{ server_id: number }>('SELECT server_id FROM channels WHERE id = $1', [c]);
    if (ch?.server_id === serverId) voiceStates[c] = voiceUsers(c);
  }
  return { serverId, server: await serverPayload(serverId), voiceStates };
});

// ----- Catégories et salons -----

action('category:create', z.object({ serverId: id, name: txt(40, 1) }), async (ctx, { serverId, name }) => {
  await requireMember(serverId, ctx.userId, P.MANAGE_CHANNELS);
  await query('INSERT INTO categories (server_id, name, position) VALUES ($1, $2, (SELECT COALESCE(max(position), -1) + 1 FROM categories WHERE server_id = $1))', [serverId, name]);
  await syncServer(serverId);
});

action('category:update', z.object({ categoryId: id, name: txt(40, 1) }), async (ctx, { categoryId, name }) => {
  const cat = await one<any>('SELECT server_id FROM categories WHERE id = $1', [categoryId]);
  if (!cat) throw new AppError('Catégorie introuvable.');
  await requireMember(cat.server_id, ctx.userId, P.MANAGE_CHANNELS);
  await query('UPDATE categories SET name = $1 WHERE id = $2', [name, categoryId]);
  await syncServer(cat.server_id);
});

action('category:delete', z.object({ categoryId: id }), async (ctx, { categoryId }) => {
  const cat = await one<any>('SELECT server_id FROM categories WHERE id = $1', [categoryId]);
  if (!cat) throw new AppError('Catégorie introuvable.');
  await requireMember(cat.server_id, ctx.userId, P.MANAGE_CHANNELS);
  await query('DELETE FROM categories WHERE id = $1', [categoryId]);
  await syncServer(cat.server_id);
});

const channelName = (name: string, type: string) => (type === 'text' ? name.toLowerCase().replace(/\s+/g, '-').slice(0, 40) : name);

async function checkCategory(serverId: number, categoryId: number | null | undefined) {
  if (categoryId == null) return null;
  if (!(await one('SELECT 1 FROM categories WHERE id = $1 AND server_id = $2', [categoryId, serverId]))) throw new AppError('Catégorie introuvable.');
  return categoryId;
}

action('channel:create', z.object({ serverId: id, type: z.enum(['text', 'voice']), name: txt(40, 1), categoryId: id.nullable().optional() }), async (ctx, data) => {
  await requireMember(data.serverId, ctx.userId, P.MANAGE_CHANNELS);
  const count = await one<{ n: number }>('SELECT count(*)::int AS n FROM channels WHERE server_id = $1', [data.serverId]);
  if (count!.n >= MAX_CHANNELS) throw new AppError(`Un serveur compte ${MAX_CHANNELS} salons au maximum.`);
  const row = await one<{ id: number }>(
    `INSERT INTO channels (server_id, category_id, type, name, position)
     VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(position), -1) + 1 FROM channels WHERE server_id = $1)) RETURNING id`,
    [data.serverId, await checkCategory(data.serverId, data.categoryId), data.type, channelName(data.name, data.type)]);
  await audit(data.serverId, ctx.userId, 'channel_create', data.name);
  await syncServer(data.serverId);
  return { id: row!.id, type: data.type };
});

async function serverChannel(channelId: number, userId: number, perm: number) {
  const channel = await one<any>('SELECT * FROM channels WHERE id = $1 AND server_id IS NOT NULL', [channelId]);
  if (!channel) throw new AppError('Salon introuvable.');
  await requireMember(channel.server_id, userId, perm);
  return channel;
}

action('channel:update', z.object({
  channelId: id, name: txt(40, 1).optional(), topic: txt(300).optional(),
  slowmode: z.number().int().min(0).max(21600).optional(), userLimit: z.number().int().min(0).max(99).optional(),
  categoryId: id.nullable().optional(),
}), async (ctx, data) => {
  const channel = await serverChannel(data.channelId, ctx.userId, P.MANAGE_CHANNELS);
  const category = data.categoryId === undefined ? channel.category_id : await checkCategory(channel.server_id, data.categoryId);
  await query(`UPDATE channels SET name = COALESCE($2, name), topic = COALESCE($3, topic), slowmode = COALESCE($4, slowmode),
                      user_limit = COALESCE($5, user_limit), category_id = $6 WHERE id = $1`,
    [channel.id, data.name ? channelName(data.name, channel.type) : null, data.topic ?? null, data.slowmode ?? null, data.userLimit ?? null, category]);
  await audit(channel.server_id, ctx.userId, 'channel_update', data.name ?? channel.name);
  await syncServer(channel.server_id);
});

action('channel:move', z.object({ channelId: id, direction: z.enum(['up', 'down']) }), async (ctx, { channelId, direction }) => {
  const channel = await serverChannel(channelId, ctx.userId, P.MANAGE_CHANNELS);
  const siblings = await query<{ id: number }>(
    'SELECT id FROM channels WHERE server_id = $1 AND category_id IS NOT DISTINCT FROM $2 ORDER BY position, id', [channel.server_id, channel.category_id]);
  const i = siblings.findIndex((s) => s.id === channelId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= siblings.length) return;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  await tx(async (db) => {
    for (const [pos, s] of siblings.entries()) await db.query('UPDATE channels SET position = $1 WHERE id = $2', [pos, s.id]);
  });
  await syncServer(channel.server_id);
});

action('channel:delete', z.object({ channelId: id }), async (ctx, { channelId }) => {
  const channel = await serverChannel(channelId, ctx.userId, P.MANAGE_CHANNELS);
  if (channel.type === 'voice') {
    await endVoiceRoom(channelId);
    await closeRoom(channelId);
  }
  await query('DELETE FROM channels WHERE id = $1', [channelId]);
  await audit(channel.server_id, ctx.userId, 'channel_delete', channel.name);
  await syncServer(channel.server_id);
});

// ----- Rôles -----

/** On ne peut gérer que les rôles placés sous son propre rôle le plus haut. */
function requireRoleBelow(actor: MemberContext, position: number) {
  if (actor.topPosition <= position) throw new AppError('Ce rôle est égal ou supérieur au tien : tu ne peux pas le modifier.');
}

async function loadRole(roleId: number, userId: number) {
  const role = await one<any>('SELECT * FROM roles WHERE id = $1', [roleId]);
  if (!role) throw new AppError('Rôle introuvable.');
  const actor = await requireMember(role.server_id, userId, P.MANAGE_ROLES);
  return { role, actor };
}

action('role:create', z.object({ serverId: id }), async (ctx, { serverId }) => {
  const actor = await requireMember(serverId, ctx.userId, P.MANAGE_ROLES);
  const count = await one<{ n: number; top: number }>('SELECT count(*)::int AS n, COALESCE(max(position), 0) AS top FROM roles WHERE server_id = $1', [serverId]);
  if (count!.n >= MAX_ROLES) throw new AppError(`Un serveur compte ${MAX_ROLES} rôles au maximum.`);
  // Le nouveau rôle est placé juste sous le rôle le plus haut de son créateur
  const position = actor.topPosition === Infinity ? count!.top + 1 : actor.topPosition;
  await query('UPDATE roles SET position = position + 1 WHERE server_id = $1 AND position >= $2 AND NOT is_default', [serverId, position]);
  const role = await one<{ id: number }>("INSERT INTO roles (server_id, name, position) VALUES ($1, 'nouveau rôle', $2) RETURNING id", [serverId, position]);
  await audit(serverId, ctx.userId, 'role_create');
  await syncServer(serverId);
  return { id: role!.id };
});

action('role:update', z.object({
  roleId: id, name: txt(40, 1), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  permissions: z.number().int().min(0).max(ALL_PERMISSIONS), hoist: z.boolean(),
}), async (ctx, data) => {
  const { role, actor } = await loadRole(data.roleId, ctx.userId);
  if (!role.is_default) requireRoleBelow(actor, role.position);
  // On ne peut pas donner des permissions qu'on n'a pas soi-même
  if ((data.permissions & ~actor.permissions) !== 0) throw new AppError("Tu ne peux pas donner une permission que tu n'as pas.");
  await query('UPDATE roles SET name = $2, color = $3, permissions = $4, hoist = $5 WHERE id = $1',
    [role.id, role.is_default ? '@everyone' : data.name, data.color, data.permissions, role.is_default ? false : data.hoist]);
  await audit(role.server_id, ctx.userId, 'role_update', data.name);
  await syncServer(role.server_id);
});

action('role:move', z.object({ roleId: id, direction: z.enum(['up', 'down']) }), async (ctx, { roleId, direction }) => {
  const { role, actor } = await loadRole(roleId, ctx.userId);
  if (role.is_default) throw new AppError('@everyone reste toujours en bas.');
  const roles = await query<{ id: number; position: number }>('SELECT id, position FROM roles WHERE server_id = $1 AND NOT is_default ORDER BY position DESC', [role.server_id]);
  const i = roles.findIndex((r) => r.id === roleId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= roles.length) return;
  requireRoleBelow(actor, Math.max(roles[i].position, roles[j].position));
  await tx(async (db) => {
    await db.query('UPDATE roles SET position = $1 WHERE id = $2', [roles[j].position, roles[i].id]);
    await db.query('UPDATE roles SET position = $1 WHERE id = $2', [roles[i].position, roles[j].id]);
  });
  await syncServer(role.server_id);
});

action('role:delete', z.object({ roleId: id }), async (ctx, { roleId }) => {
  const { role, actor } = await loadRole(roleId, ctx.userId);
  if (role.is_default) throw new AppError('Le rôle @everyone ne peut pas être supprimé.');
  requireRoleBelow(actor, role.position);
  await query('DELETE FROM roles WHERE id = $1', [roleId]);
  await audit(role.server_id, ctx.userId, 'role_delete', role.name);
  await syncServer(role.server_id);
});

action('member:roles', z.object({ serverId: id, userId: id, roleIds: z.array(id).max(MAX_ROLES) }), async (ctx, data) => {
  const actor = await requireMember(data.serverId, ctx.userId, P.MANAGE_ROLES);
  if (data.userId !== ctx.userId) await requireAbove(actor, data.userId);
  else if (!(await one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [data.serverId, data.userId]))) throw new AppError('Membre introuvable.');
  const roles = await query<{ id: number; position: number }>('SELECT id, position FROM roles WHERE server_id = $1 AND NOT is_default', [data.serverId]);
  const current = new Set((await query<{ role_id: number }>('SELECT role_id FROM member_roles WHERE server_id = $1 AND user_id = $2', [data.serverId, data.userId])).map((r) => r.role_id));
  const wanted = new Set(data.roleIds.filter((r) => roles.some((x) => x.id === r)));
  // Seuls les rôles sous le sien peuvent être ajoutés ou retirés
  for (const role of roles) {
    if (current.has(role.id) !== wanted.has(role.id)) requireRoleBelow(actor, role.position);
  }
  await tx(async (db) => {
    await db.query('DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2', [data.serverId, data.userId]);
    for (const r of wanted) await db.query('INSERT INTO member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3)', [data.serverId, data.userId, r]);
  });
  await audit(data.serverId, ctx.userId, 'member_roles', String(data.userId));
  await syncServer(data.serverId);
});

action('member:nick', z.object({ serverId: id, userId: id.optional(), nickname: txt(32) }), async (ctx, data) => {
  const target = data.userId ?? ctx.userId;
  const actor = await requireMember(data.serverId, ctx.userId, target === ctx.userId ? 0 : P.MANAGE_SERVER);
  if (target !== ctx.userId) await requireAbove(actor, target);
  await query('UPDATE members SET nickname = $3 WHERE server_id = $1 AND user_id = $2', [data.serverId, target, data.nickname || null]);
  await syncServer(data.serverId);
});
