// Mise en forme des données envoyées aux navigateurs (jamais d'email, d'empreinte ou de secret).
import { query, one } from '../db/pool.js';
import { visibleStatus } from './presence.js';

export const USER_COLS = 'u.id, u.username, u.avatar_id, u.accent_color, u.bio, u.custom_status, u.status';

export const uploadUrl = (id: string | null) => (id ? `/api/uploads/${id}` : null);

export function publicUser(row: any) {
  return {
    id: row.id,
    username: row.username,
    avatar: uploadUrl(row.avatar_id),
    accentColor: row.accent_color,
    bio: row.bio,
    customStatus: row.custom_status,
    status: visibleStatus(row.id, row.status),
  };
}
export type PublicUser = ReturnType<typeof publicUser>;

export async function getUser(id: number) {
  const row = await one(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [id]);
  return row ? publicUser(row) : null;
}

export async function serverPayload(serverId: number) {
  const server = await one<any>('SELECT id, name, icon_id, owner_id, created_at FROM servers WHERE id = $1', [serverId]);
  if (!server) return null;
  const [roles, categories, channels, members, memberRoles] = await Promise.all([
    query('SELECT id, name, color, permissions, position, is_default AS "isDefault", hoist FROM roles WHERE server_id = $1 ORDER BY position DESC, id', [serverId]),
    query('SELECT id, name, position FROM categories WHERE server_id = $1 ORDER BY position, id', [serverId]),
    query(`SELECT id, type, name, topic, position, slowmode, user_limit AS "userLimit", category_id AS "categoryId"
             FROM channels WHERE server_id = $1 ORDER BY position, id`, [serverId]),
    query(`SELECT m.nickname, m.joined_at, m.muted_until, m.voice_muted, ${USER_COLS}
             FROM members m JOIN users u ON u.id = m.user_id WHERE m.server_id = $1 ORDER BY lower(u.username)`, [serverId]),
    query<{ user_id: number; role_id: number }>('SELECT user_id, role_id FROM member_roles WHERE server_id = $1', [serverId]),
  ]);
  const rolesByUser = new Map<number, number[]>();
  for (const r of memberRoles) {
    if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, []);
    rolesByUser.get(r.user_id)!.push(r.role_id);
  }
  return {
    id: server.id,
    name: server.name,
    icon: uploadUrl(server.icon_id),
    ownerId: server.owner_id,
    roles,
    categories,
    channels,
    members: members.map((m: any) => ({
      user: publicUser(m),
      nickname: m.nickname,
      roles: rolesByUser.get(m.id) ?? [],
      joinedAt: m.joined_at,
      mutedUntil: m.muted_until && new Date(m.muted_until) > new Date() ? m.muted_until : null,
      voiceMuted: m.voice_muted,
    })),
  };
}

const MESSAGE_SELECT = `
  SELECT m.id, m.channel_id, m.author_id, m.content, m.kind, m.attachments, m.mentions, m.mention_everyone,
         m.reply_to, m.pinned, m.created_at, m.edited_at, c.server_id,
         u.username AS author_username, u.avatar_id AS author_avatar
    FROM messages m JOIN channels c ON c.id = m.channel_id LEFT JOIN users u ON u.id = m.author_id`;

export async function formatMessages(rows: any[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const replyIds = [...new Set(rows.map((r) => r.reply_to).filter(Boolean))];
  const [reactions, replies] = await Promise.all([
    query<{ message_id: number; emoji: string; users: number[] }>(
      `SELECT message_id, emoji, array_agg(user_id ORDER BY created_at) AS users
         FROM reactions WHERE message_id = ANY($1) GROUP BY message_id, emoji ORDER BY MIN(created_at)`, [ids]),
    replyIds.length
      ? query(`SELECT m.id, m.author_id, left(m.content, 200) AS content, m.attachments <> '[]'::jsonb AS has_attachment,
                      u.username, u.avatar_id FROM messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ANY($1)`, [replyIds])
      : Promise.resolve([]),
  ]);
  const reactionsBy = new Map<number, { emoji: string; users: number[] }[]>();
  for (const r of reactions) {
    if (!reactionsBy.has(r.message_id)) reactionsBy.set(r.message_id, []);
    reactionsBy.get(r.message_id)!.push({ emoji: r.emoji, users: r.users.map(Number) });
  }
  const repliesBy = new Map(replies.map((r: any) => [r.id, {
    id: r.id, content: r.content, hasAttachment: r.has_attachment,
    author: r.author_id ? { id: r.author_id, username: r.username, avatar: uploadUrl(r.avatar_id) } : null,
  }]));
  return rows.map((r) => ({
    id: r.id,
    channelId: r.channel_id,
    serverId: r.server_id,
    author: r.author_id ? { id: r.author_id, username: r.author_username, avatar: uploadUrl(r.author_avatar) } : null,
    content: r.content,
    kind: r.kind,
    attachments: r.attachments,
    mentions: (r.mentions ?? []).map(Number),
    mentionEveryone: r.mention_everyone,
    replyTo: r.reply_to ? repliesBy.get(r.reply_to) ?? null : null,
    pinned: r.pinned,
    reactions: reactionsBy.get(r.id) ?? [],
    createdAt: r.created_at,
    editedAt: r.edited_at,
  }));
}

export async function messagesWhere(where: string, params: unknown[], order = 'm.id DESC', limit = 50) {
  const rows = await query(`${MESSAGE_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${Number(limit)}`, params);
  return formatMessages(rows);
}

export async function messageById(id: number) {
  return (await messagesWhere('m.id = $1', [id]))[0] ?? null;
}
