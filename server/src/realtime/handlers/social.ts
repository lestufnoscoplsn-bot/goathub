// Amis, blocages, messages privés et groupes privés.
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { AppError } from '../../services/errors.js';
import { channelAccess } from '../../services/access.js';
import { getUser, publicUser, USER_COLS } from '../../services/serialize.js';
import { emitToUser, recipientsOf } from '../hub.js';
import { action, id, txt } from '../registry.js';

const MAX_GROUP = 10;

// ----- Relations -----

export async function relationType(me: number, other: number): Promise<'friend' | 'outgoing' | 'incoming' | 'blocked' | null> {
  const rows = await query<{ user_id: number; status: string }>(
    'SELECT user_id, status FROM friendships WHERE (user_id = $1 AND other_id = $2) OR (user_id = $2 AND other_id = $1)', [me, other]);
  const mine = rows.find((r) => r.user_id === me);
  const theirs = rows.find((r) => r.user_id === other);
  if (mine?.status === 'blocked') return 'blocked';
  if (mine?.status === 'accepted') return 'friend';
  if (mine?.status === 'pending') return 'outgoing';
  if (theirs?.status === 'pending') return 'incoming';
  return null;
}

export const isBlockedBy = async (blocker: number, blocked: number) =>
  !!(await one("SELECT 1 FROM friendships WHERE user_id = $1 AND other_id = $2 AND status = 'blocked'", [blocker, blocked]));

export async function relationList(userId: number) {
  const rows = await query<any>(
    `SELECT DISTINCT ${USER_COLS} FROM users u WHERE u.id IN (
       SELECT other_id FROM friendships WHERE user_id = $1
       UNION SELECT user_id FROM friendships WHERE other_id = $1 AND status = 'pending')`, [userId]);
  const out = [];
  for (const row of rows) {
    const type = await relationType(userId, row.id);
    if (type) out.push({ user: publicUser(row), type });
  }
  return out;
}

async function announceRelation(a: number, b: number) {
  emitToUser(a, 'relation:update', { user: await getUser(b), type: await relationType(a, b) });
  emitToUser(b, 'relation:update', { user: await getUser(a), type: await relationType(b, a) });
}

const removeFriendship = (a: number, b: number) =>
  query("DELETE FROM friendships WHERE status <> 'blocked' AND ((user_id = $1 AND other_id = $2) OR (user_id = $2 AND other_id = $1))", [a, b]);

action('friend:request', z.object({ username: txt(40, 1) }), async (ctx, { username }) => {
  const other = await one<{ id: number }>('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
  if (!other) throw new AppError('Aucun utilisateur avec ce pseudo.');
  if (other.id === ctx.userId) throw new AppError("Tu ne peux pas t'ajouter toi-même.");
  if (await isBlockedBy(other.id, ctx.userId)) throw new AppError("Cette personne n'accepte pas ta demande.");
  const type = await relationType(ctx.userId, other.id);
  if (type === 'friend') throw new AppError('Vous êtes déjà amis.');
  if (type === 'outgoing') throw new AppError('Demande déjà envoyée.');
  if (type === 'blocked') throw new AppError("Tu as bloqué cette personne : débloque-la d'abord.");
  const pending = await one<{ n: number }>("SELECT count(*)::int AS n FROM friendships WHERE user_id = $1 AND status = 'pending'", [ctx.userId]);
  if (pending!.n >= 100) throw new AppError("Trop de demandes d'ami en attente.");
  await tx(async (db) => {
    if (type === 'incoming') {
      await db.query("UPDATE friendships SET status = 'accepted' WHERE user_id = $1 AND other_id = $2", [other.id, ctx.userId]);
      await db.query("INSERT INTO friendships (user_id, other_id, status) VALUES ($1, $2, 'accepted') ON CONFLICT (user_id, other_id) DO UPDATE SET status = 'accepted'", [ctx.userId, other.id]);
    } else {
      await db.query("INSERT INTO friendships (user_id, other_id, status) VALUES ($1, $2, 'pending')", [ctx.userId, other.id]);
    }
  });
  await announceRelation(ctx.userId, other.id);
});

action('friend:accept', z.object({ userId: id }), async (ctx, { userId }) => {
  if ((await relationType(ctx.userId, userId)) !== 'incoming') throw new AppError('Aucune demande à accepter.');
  await tx(async (db) => {
    await db.query("UPDATE friendships SET status = 'accepted' WHERE user_id = $1 AND other_id = $2", [userId, ctx.userId]);
    await db.query("INSERT INTO friendships (user_id, other_id, status) VALUES ($1, $2, 'accepted') ON CONFLICT (user_id, other_id) DO UPDATE SET status = 'accepted'", [ctx.userId, userId]);
  });
  await announceRelation(ctx.userId, userId);
});

action('friend:remove', z.object({ userId: id }), async (ctx, { userId }) => {
  await removeFriendship(ctx.userId, userId);
  await announceRelation(ctx.userId, userId);
});

action('user:block', z.object({ userId: id }), async (ctx, { userId }) => {
  if (userId === ctx.userId || !(await getUser(userId))) throw new AppError('Utilisateur introuvable.');
  await removeFriendship(ctx.userId, userId);
  await query("INSERT INTO friendships (user_id, other_id, status) VALUES ($1, $2, 'blocked') ON CONFLICT (user_id, other_id) DO UPDATE SET status = 'blocked'", [ctx.userId, userId]);
  await announceRelation(ctx.userId, userId);
});

action('user:unblock', z.object({ userId: id }), async (ctx, { userId }) => {
  await query("DELETE FROM friendships WHERE user_id = $1 AND other_id = $2 AND status = 'blocked'", [ctx.userId, userId]);
  await announceRelation(ctx.userId, userId);
});

action('user:get', z.object({ userId: id }), async (_ctx, { userId }) => {
  const user = await getUser(userId);
  if (!user) throw new AppError('Utilisateur introuvable.');
  return user;
});

// ----- Conversations privées -----

export async function dmPayload(channelId: number, viewerId: number) {
  const channel = await one<any>('SELECT id, type, name, owner_id FROM channels WHERE id = $1', [channelId]);
  const recipients = await query<any>(
    `SELECT ${USER_COLS} FROM channel_recipients r JOIN users u ON u.id = r.user_id WHERE r.channel_id = $1 ORDER BY lower(u.username)`, [channelId]);
  const last = await one<{ id: number }>('SELECT max(id) AS id FROM messages WHERE channel_id = $1', [channelId]);
  return {
    id: channel.id,
    type: channel.type as 'dm' | 'group',
    name: channel.name,
    ownerId: channel.owner_id,
    recipients: recipients.filter((r) => r.id !== viewerId || channel.type === 'group').map(publicUser),
    lastMessageId: last?.id ?? 0,
  };
}

export async function dmList(userId: number) {
  const rows = await query<{ channel_id: number }>(
    `SELECT r.channel_id FROM channel_recipients r WHERE r.user_id = $1 AND NOT r.hidden`, [userId]);
  const list = await Promise.all(rows.map((r) => dmPayload(r.channel_id, userId)));
  return list.sort((a, b) => b.lastMessageId - a.lastMessageId);
}

/** Envoie la conversation à jour à tous ses participants. */
export async function syncDm(channelId: number) {
  for (const userId of await recipientsOf(channelId)) emitToUser(userId, 'dm:update', await dmPayload(channelId, userId));
}

action('dm:open', z.object({ userId: id }), async (ctx, { userId }) => {
  if (userId === ctx.userId || !(await getUser(userId))) throw new AppError('Utilisateur introuvable.');
  const key = ctx.userId < userId ? `${ctx.userId}:${userId}` : `${userId}:${ctx.userId}`;
  const channelId = await tx(async (db) => {
    const existing = (await db.query('SELECT id FROM channels WHERE dm_key = $1', [key])).rows[0];
    if (existing) return existing.id as number;
    const created = (await db.query("INSERT INTO channels (type, dm_key) VALUES ('dm', $1) RETURNING id", [key])).rows[0].id as number;
    await db.query('INSERT INTO channel_recipients (channel_id, user_id, hidden) VALUES ($1, $2, true), ($1, $3, true)', [created, ctx.userId, userId]);
    return created;
  });
  await query('UPDATE channel_recipients SET hidden = false WHERE channel_id = $1 AND user_id = $2', [channelId, ctx.userId]);
  return dmPayload(channelId, ctx.userId);
});

action('dm:close', z.object({ channelId: id }), async (ctx, { channelId }) => {
  await query('UPDATE channel_recipients SET hidden = true WHERE channel_id = $1 AND user_id = $2', [channelId, ctx.userId]);
});

async function requireFriends(userId: number, others: number[]) {
  for (const other of others) {
    if ((await relationType(userId, other)) !== 'friend') throw new AppError('Tu ne peux ajouter que tes amis dans un groupe.');
  }
}

action('group:create', z.object({ userIds: z.array(id).min(1).max(MAX_GROUP - 1), name: txt(50).optional() }), async (ctx, data) => {
  const others = [...new Set(data.userIds)].filter((u) => u !== ctx.userId);
  if (!others.length) throw new AppError('Choisis au moins un ami.');
  await requireFriends(ctx.userId, others);
  const channelId = await tx(async (db) => {
    const created = (await db.query("INSERT INTO channels (type, name, owner_id) VALUES ('group', $1, $2) RETURNING id", [data.name ?? '', ctx.userId])).rows[0].id;
    for (const u of [ctx.userId, ...others]) await db.query('INSERT INTO channel_recipients (channel_id, user_id) VALUES ($1, $2)', [created, u]);
    return created as number;
  });
  await syncDm(channelId);
  return dmPayload(channelId, ctx.userId);
});

action('group:add', z.object({ channelId: id, userId: id }), async (ctx, { channelId, userId }) => {
  const { channel } = await channelAccess(channelId, ctx.userId);
  if (channel.type !== 'group') throw new AppError("Ce n'est pas un groupe.");
  await requireFriends(ctx.userId, [userId]);
  const count = (await recipientsOf(channelId)).length;
  if (count >= MAX_GROUP) throw new AppError(`Un groupe compte ${MAX_GROUP} personnes au maximum.`);
  await query('INSERT INTO channel_recipients (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [channelId, userId]);
  await syncDm(channelId);
});

action('group:rename', z.object({ channelId: id, name: txt(50) }), async (ctx, { channelId, name }) => {
  const { channel } = await channelAccess(channelId, ctx.userId);
  if (channel.type !== 'group') throw new AppError("Ce n'est pas un groupe.");
  await query('UPDATE channels SET name = $1 WHERE id = $2', [name, channelId]);
  await syncDm(channelId);
});

action('group:leave', z.object({ channelId: id }), async (ctx, { channelId }) => {
  const { channel } = await channelAccess(channelId, ctx.userId);
  if (channel.type !== 'group') throw new AppError("Ce n'est pas un groupe.");
  await query('DELETE FROM channel_recipients WHERE channel_id = $1 AND user_id = $2', [channelId, ctx.userId]);
  emitToUser(ctx.userId, 'dm:removed', { channelId });
  const left = await recipientsOf(channelId);
  if (!left.length) await query('DELETE FROM channels WHERE id = $1', [channelId]);
  else {
    if (channel.owner_id === ctx.userId) await query('UPDATE channels SET owner_id = $1 WHERE id = $2', [left[0], channelId]);
    await syncDm(channelId);
  }
});
