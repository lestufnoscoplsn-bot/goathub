// Messages : historique, envoi (avec anti-spam), modification, suppression, réactions, épingles, saisie, lecture.
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { securityLog } from '../../security/audit.js';
import { Limiter } from '../../security/limits.js';
import { channelAccess, type ChannelRow } from '../../services/access.js';
import { AppError } from '../../services/errors.js';
import { P, requireNotTimedOut, type MemberContext } from '../../services/permissions.js';
import { messageById, messagesWhere } from '../../services/serialize.js';
import { emitToChannel, emitToUser, recipientsOf, syncServer } from '../hub.js';
import { action, id, txt, type Ctx } from '../registry.js';
import { audit } from './servers.js';
import { isBlockedBy } from './social.js';

const PAGE = 50;
const burst = new Limiter(5, 5_000);          // 5 messages en 5 secondes
const spamStrikes = new Limiter(3, 60_000);   // 3 avertissements en 1 minute => exclusion automatique
const recentContent = new Map<number, { text: string; at: number; count: number }>();
const lastSent = new Map<string, number>();    // `${userId}:${channelId}` -> heure (mode lent)

function need(member: MemberContext | null, perm: number) {
  if (member && (member.permissions & perm) !== perm) throw new AppError("Tu n'as pas la permission de faire ça.", 'forbidden');
}

/** Anti-spam : trop rapide, messages répétés, trop de mentions. Exclusion de 10 min au bout de 3 avertissements. */
async function antiSpam(ctx: Ctx, channel: ChannelRow, member: MemberContext | null, content: string, mentionCount: number) {
  const strike = async (message: string) => {
    if (channel.server_id && member && !(member.permissions & P.MANAGE_MESSAGES) && !spamStrikes.take(`${ctx.userId}:${channel.server_id}`)) {
      await query("UPDATE members SET muted_until = now() + interval '10 minutes' WHERE server_id = $1 AND user_id = $2", [channel.server_id, ctx.userId]);
      await audit(channel.server_id, ctx.userId, 'auto_timeout', String(ctx.userId), 'Anti-spam : 10 minutes');
      securityLog('flood', { userId: ctx.userId, serverId: channel.server_id, kind: 'auto_timeout' });
      await syncServer(channel.server_id);
      throw new AppError('Anti-spam : tu es exclu de ce serveur pendant 10 minutes.', 'timed_out');
    }
    throw new AppError(message, 'spam');
  };
  if (!burst.take(String(ctx.userId))) await strike('Doucement ! Tu envoies trop de messages.');
  if (mentionCount > 10) await strike('Trop de mentions dans un seul message.');
  const now = Date.now();
  const prev = recentContent.get(ctx.userId);
  if (content && prev && prev.text === content && now - prev.at < 30_000) {
    prev.count += 1;
    prev.at = now;
    if (prev.count >= 3) await strike('Tu as déjà envoyé ce message plusieurs fois.');
  } else {
    recentContent.set(ctx.userId, { text: content, at: now, count: 1 });
  }
  if (channel.slowmode && member && !(member.permissions & (P.MANAGE_MESSAGES | P.MANAGE_CHANNELS))) {
    const key = `${ctx.userId}:${channel.id}`;
    const wait = channel.slowmode * 1000 - (now - (lastSent.get(key) ?? 0));
    if (wait > 0) throw new AppError(`Mode lent : attends encore ${Math.ceil(wait / 1000)} s.`, 'slowmode');
    lastSent.set(key, now);
  }
}

action('messages:get', z.object({ channelId: id, before: id.optional(), around: id.optional() }), async (ctx, data) => {
  const { channel } = await channelAccess(data.channelId, ctx.userId);
  if (channel.type === 'voice') return { messages: [], hasMore: false };
  if (data.around) {
    const older = await messagesWhere('m.channel_id = $1 AND m.id <= $2', [channel.id, data.around], 'm.id DESC', 25);
    const newer = await messagesWhere('m.channel_id = $1 AND m.id > $2', [channel.id, data.around], 'm.id ASC', 25);
    return { messages: [...older.reverse(), ...newer], hasMore: true };
  }
  const rows = data.before
    ? await messagesWhere('m.channel_id = $1 AND m.id < $2', [channel.id, data.before], 'm.id DESC', PAGE + 1)
    : await messagesWhere('m.channel_id = $1', [channel.id], 'm.id DESC', PAGE + 1);
  return { messages: rows.slice(0, PAGE).reverse(), hasMore: rows.length > PAGE };
});

action('pins:get', z.object({ channelId: id }), async (ctx, { channelId }) => {
  await channelAccess(channelId, ctx.userId);
  return messagesWhere('m.channel_id = $1 AND m.pinned', [channelId], 'm.id DESC', 50);
});

action('message:send', z.object({
  channelId: id,
  content: z.string().max(4000),
  replyTo: id.optional(),
  attachmentIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{22}$/)).max(10).default([]),
  nonce: z.string().max(40).optional(),
}), async (ctx, data) => {
  const { channel, member } = await channelAccess(data.channelId, ctx.userId);
  if (channel.type === 'voice') throw new AppError('On ne peut pas écrire dans un salon vocal.');
  const content = data.content.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').trim();
  if (content.length > 2000) throw new AppError('Message trop long (2000 caractères maximum).');
  if (!content && !data.attachmentIds.length) throw new AppError('Le message est vide.');
  if (member) {
    requireNotTimedOut(member);
    need(member, P.SEND_MESSAGES);
    if (data.attachmentIds.length) need(member, P.ATTACH_FILES);
  } else {
    const others = (await recipientsOf(channel.id)).filter((u) => u !== ctx.userId);
    if (channel.type === 'dm') {
      if (await isBlockedBy(ctx.userId, others[0])) throw new AppError('Tu as bloqué cette personne.');
      if (await isBlockedBy(others[0], ctx.userId)) throw new AppError('Tu ne peux pas envoyer de message à cette personne.');
    }
  }

  // Mentions : seulement des personnes qui voient ce salon
  const mentioned = [...new Set([...content.matchAll(/<@(\d{1,15})>/g)].map((m) => Number(m[1])))];
  const validMentions = mentioned.length
    ? (channel.server_id
      ? await query<{ user_id: number }>('SELECT user_id FROM members WHERE server_id = $1 AND user_id = ANY($2)', [channel.server_id, mentioned])
      : await query<{ user_id: number }>('SELECT user_id FROM channel_recipients WHERE channel_id = $1 AND user_id = ANY($2)', [channel.id, mentioned])
    ).map((r) => r.user_id)
    : [];
  const mentionEveryone = !!channel.server_id && /@(everyone|here)\b/.test(content) && !!member && (member.permissions & P.MENTION_EVERYONE) !== 0;
  await antiSpam(ctx, channel, member, content, mentioned.length);

  const replyTo = data.replyTo ? (await one<{ id: number }>('SELECT id FROM messages WHERE id = $1 AND channel_id = $2', [data.replyTo, channel.id]))?.id ?? null : null;

  const messageId = await tx(async (db) => {
    // Les fichiers doivent appartenir à l'expéditeur et ne pas avoir déjà été envoyés
    const files = data.attachmentIds.length
      ? (await db.query('UPDATE uploads SET channel_id = $1 WHERE id = ANY($2) AND owner_id = $3 AND channel_id IS NULL RETURNING id, filename, size, kind',
        [channel.id, data.attachmentIds, ctx.userId])).rows
      : [];
    if (files.length !== data.attachmentIds.length) throw new AppError('Pièce jointe invalide.');
    const ordered = data.attachmentIds.map((fid) => files.find((f: any) => f.id === fid)!);
    const attachments = ordered.map((f: any) => ({ id: f.id, url: `/api/uploads/${f.id}`, name: f.filename, size: f.size, kind: f.kind }));
    const row = (await db.query(
      `INSERT INTO messages (channel_id, author_id, content, attachments, mentions, mention_everyone, reply_to) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [channel.id, ctx.userId, content, JSON.stringify(attachments), validMentions, mentionEveryone, replyTo])).rows[0];
    await db.query(`INSERT INTO read_states (user_id, channel_id, last_read_id) VALUES ($1, $2, $3)
                    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = GREATEST(read_states.last_read_id, excluded.last_read_id)`, [ctx.userId, channel.id, row.id]);
    return row.id as number;
  });

  if (!channel.server_id) {
    // La conversation réapparaît chez ceux qui l'avaient fermée
    const hidden = await query<{ user_id: number }>('UPDATE channel_recipients SET hidden = false WHERE channel_id = $1 AND hidden RETURNING user_id', [channel.id]);
    const { dmPayload } = await import('./social.js');
    for (const h of hidden) emitToUser(h.user_id, 'dm:update', await dmPayload(channel.id, h.user_id));
  }
  const message = await messageById(messageId);
  await emitToChannel(channel, 'message:new', { ...message, nonce: data.nonce });
  return message;
});

async function loadMessage(messageId: number, userId: number) {
  const message = await one<any>('SELECT * FROM messages WHERE id = $1', [messageId]);
  if (!message) throw new AppError('Message introuvable.');
  const access = await channelAccess(message.channel_id, userId);
  return { message, ...access };
}

action('message:edit', z.object({ messageId: id, content: txt(2000) }), async (ctx, { messageId, content }) => {
  const { message, channel, member } = await loadMessage(messageId, ctx.userId);
  if (message.author_id !== ctx.userId) throw new AppError('Tu ne peux modifier que tes propres messages.');
  if (member) requireNotTimedOut(member);
  if (!content && message.attachments.length === 0) throw new AppError('Le message est vide.');
  await query('UPDATE messages SET content = $2, edited_at = now() WHERE id = $1', [messageId, content]);
  await emitToChannel(channel, 'message:update', await messageById(messageId));
});

action('message:delete', z.object({ messageId: id }), async (ctx, { messageId }) => {
  const { message, channel, member } = await loadMessage(messageId, ctx.userId);
  const moderator = member && (member.permissions & P.MANAGE_MESSAGES) !== 0;
  if (message.author_id !== ctx.userId && !moderator) throw new AppError("Tu n'as pas la permission de supprimer ce message.");
  await query('DELETE FROM messages WHERE id = $1', [messageId]);
  if (moderator && message.author_id !== ctx.userId && channel.server_id) {
    await audit(channel.server_id, ctx.userId, 'message_delete', String(message.author_id), message.content.slice(0, 200));
  }
  await emitToChannel(channel, 'message:delete', { channelId: channel.id, messageId });
});

action('message:pin', z.object({ messageId: id, pinned: z.boolean() }), async (ctx, { messageId, pinned }) => {
  const { channel, member } = await loadMessage(messageId, ctx.userId);
  if (member) need(member, P.MANAGE_MESSAGES);
  if (pinned) {
    const count = await one<{ n: number }>('SELECT count(*)::int AS n FROM messages WHERE channel_id = $1 AND pinned', [channel.id]);
    if (count!.n >= 50) throw new AppError('50 messages épinglés au maximum par salon.');
  }
  await query('UPDATE messages SET pinned = $2 WHERE id = $1', [messageId, pinned]);
  await emitToChannel(channel, 'message:update', await messageById(messageId));
});

action('reaction:toggle', z.object({ messageId: id, emoji: z.string().min(1).max(32).regex(/^[^\s<>"'`]+$/u) }), async (ctx, { messageId, emoji }) => {
  const { channel, member } = await loadMessage(messageId, ctx.userId);
  if (member) {
    requireNotTimedOut(member);
    need(member, P.ADD_REACTIONS);
  }
  const removed = await query('DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING 1', [messageId, ctx.userId, emoji]);
  if (!removed.length) {
    const distinct = await query<{ emoji: string }>('SELECT DISTINCT emoji FROM reactions WHERE message_id = $1', [messageId]);
    if (distinct.length >= 20 && !distinct.some((d) => d.emoji === emoji)) throw new AppError('Trop de réactions différentes sur ce message.');
    await query('INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)', [messageId, ctx.userId, emoji]);
  }
  await emitToChannel(channel, 'message:update', await messageById(messageId));
});

action('typing', z.object({ channelId: id }), async (ctx, { channelId }) => {
  const { channel } = await channelAccess(channelId, ctx.userId);
  await emitToChannel(channel, 'typing', { channelId, userId: ctx.userId }, ctx.socket.id);
});

action('channel:ack', z.object({ channelId: id, messageId: id.optional() }), async (ctx, { channelId, messageId }) => {
  await channelAccess(channelId, ctx.userId);
  const last = await one<{ id: number }>('SELECT COALESCE(max(id), 0) AS id FROM messages WHERE channel_id = $1', [channelId]);
  const upTo = Math.min(messageId ?? last!.id, last!.id);
  await query(`INSERT INTO read_states (user_id, channel_id, last_read_id) VALUES ($1, $2, $3)
               ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = GREATEST(read_states.last_read_id, excluded.last_read_id)`,
    [ctx.userId, channelId, upTo]);
});
