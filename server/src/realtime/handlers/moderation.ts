// Modération : expulser, bannir, rendre muet, exclure temporairement, signalements, journal.
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { securityLog } from '../../security/audit.js';
import { channelAccess } from '../../services/access.js';
import { AppError } from '../../services/errors.js';
import { P, requireAbove, requireMember } from '../../services/permissions.js';
import { syncServer } from '../hub.js';
import { action, id, txt } from '../registry.js';
import { audit, removeMember } from './servers.js';
import { applyVoicePermissions, disconnectVoiceInServer } from './voice.js';

action('member:kick', z.object({ serverId: id, userId: id, reason: txt(300).optional() }), async (ctx, data) => {
  const actor = await requireMember(data.serverId, ctx.userId, P.KICK_MEMBERS);
  await requireAbove(actor, data.userId);
  await removeMember(data.serverId, data.userId);
  await audit(data.serverId, ctx.userId, 'member_kick', String(data.userId), data.reason ?? '');
});

action('member:ban', z.object({ serverId: id, userId: id, reason: txt(300).optional(), deleteMessagesHours: z.number().int().min(0).max(168).optional() }), async (ctx, data) => {
  const actor = await requireMember(data.serverId, ctx.userId, P.BAN_MEMBERS);
  await requireAbove(actor, data.userId);
  await query('INSERT INTO bans (server_id, user_id, reason, banned_by) VALUES ($1, $2, $3, $4) ON CONFLICT (server_id, user_id) DO UPDATE SET reason = $3',
    [data.serverId, data.userId, data.reason ?? '', ctx.userId]);
  if (data.deleteMessagesHours) {
    await query(`DELETE FROM messages WHERE author_id = $1 AND created_at > now() - make_interval(hours => $3)
                   AND channel_id IN (SELECT id FROM channels WHERE server_id = $2)`, [data.userId, data.serverId, data.deleteMessagesHours]);
  }
  await removeMember(data.serverId, data.userId);
  await audit(data.serverId, ctx.userId, 'member_ban', String(data.userId), data.reason ?? '');
});

action('ban:list', z.object({ serverId: id }), async (ctx, { serverId }) => {
  await requireMember(serverId, ctx.userId, P.BAN_MEMBERS);
  return query(`SELECT b.user_id AS "userId", u.username, b.reason, b.created_at AS "createdAt"
                  FROM bans b JOIN users u ON u.id = b.user_id WHERE b.server_id = $1 ORDER BY b.created_at DESC`, [serverId]);
});

action('ban:remove', z.object({ serverId: id, userId: id }), async (ctx, { serverId, userId }) => {
  await requireMember(serverId, ctx.userId, P.BAN_MEMBERS);
  await query('DELETE FROM bans WHERE server_id = $1 AND user_id = $2', [serverId, userId]);
  await audit(serverId, ctx.userId, 'member_unban', String(userId));
});

/** Exclusion temporaire : la personne ne peut plus écrire, réagir ni parler pendant la durée choisie. */
action('member:timeout', z.object({ serverId: id, userId: id, minutes: z.number().int().min(0).max(40320), reason: txt(300).optional() }), async (ctx, data) => {
  const actor = await requireMember(data.serverId, ctx.userId, P.MODERATE_MEMBERS);
  await requireAbove(actor, data.userId);
  await query(`UPDATE members SET muted_until = CASE WHEN $3 = 0 THEN NULL ELSE now() + make_interval(mins => $3) END
                WHERE server_id = $1 AND user_id = $2`, [data.serverId, data.userId, data.minutes]);
  await audit(data.serverId, ctx.userId, data.minutes ? 'member_timeout' : 'member_timeout_end', String(data.userId), data.reason ?? `${data.minutes} min`);
  await applyVoicePermissions(data.serverId, data.userId);
  await syncServer(data.serverId);
});

/** Rendre muet en vocal (le micro est coupé pour tout le monde, la personne ne peut pas le réactiver). */
action('member:voice-mute', z.object({ serverId: id, userId: id, muted: z.boolean() }), async (ctx, data) => {
  const actor = await requireMember(data.serverId, ctx.userId, P.MODERATE_MEMBERS);
  await requireAbove(actor, data.userId);
  await query('UPDATE members SET voice_muted = $3 WHERE server_id = $1 AND user_id = $2', [data.serverId, data.userId, data.muted]);
  await audit(data.serverId, ctx.userId, data.muted ? 'voice_mute' : 'voice_unmute', String(data.userId));
  await applyVoicePermissions(data.serverId, data.userId);
  await syncServer(data.serverId);
});

action('member:voice-disconnect', z.object({ serverId: id, userId: id }), async (ctx, data) => {
  const actor = await requireMember(data.serverId, ctx.userId, P.MODERATE_MEMBERS);
  await requireAbove(actor, data.userId);
  await disconnectVoiceInServer(data.serverId, data.userId);
  await audit(data.serverId, ctx.userId, 'voice_disconnect', String(data.userId));
});

action('audit:list', z.object({ serverId: id }), async (ctx, { serverId }) => {
  await requireMember(serverId, ctx.userId, P.MANAGE_SERVER | P.MODERATE_MEMBERS);
  return query(`SELECT a.id, a.action, a.target, a.details, a.created_at AS "createdAt", u.username AS actor, t.username AS "targetName"
                  FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
                  LEFT JOIN users t ON a.target ~ '^[0-9]+$' AND t.id = a.target::bigint
                 WHERE a.server_id = $1 ORDER BY a.id DESC LIMIT 100`, [serverId]);
});

// ----- Signalements -----

const REASONS = ['spam', 'harcelement', 'contenu_choquant', 'arnaque', 'usurpation', 'autre'] as const;

action('report:create', z.object({ userId: id, messageId: id.optional(), serverId: id.optional(), reason: z.enum(REASONS), details: txt(1000).optional() }), async (ctx, data) => {
  if (data.userId === ctx.userId) throw new AppError('Tu ne peux pas te signaler toi-même.');
  const recent = await one<{ n: number }>("SELECT count(*)::int AS n FROM reports WHERE reporter_id = $1 AND created_at > now() - interval '1 hour'", [ctx.userId]);
  if (recent!.n >= 10) throw new AppError('Tu as envoyé beaucoup de signalements : réessaie plus tard.');
  let serverId = data.serverId ?? null;
  let copy = '';
  if (data.messageId) {
    const message = await one<any>('SELECT channel_id, author_id, content FROM messages WHERE id = $1', [data.messageId]);
    if (!message || message.author_id !== data.userId) throw new AppError('Message introuvable.');
    const { channel } = await channelAccess(message.channel_id, ctx.userId);
    serverId = channel.server_id;
    copy = message.content.slice(0, 2000);
  } else if (serverId && !(await one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [serverId, ctx.userId]))) {
    throw new AppError('Serveur introuvable.');
  }
  await query(`INSERT INTO reports (reporter_id, target_user_id, server_id, message_id, message_copy, reason, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ctx.userId, data.userId, serverId, data.messageId ?? null, copy, data.reason, data.details ?? '']);
  securityLog('report_created', { reporter: ctx.userId, target: data.userId, serverId, reason: data.reason });
});

/** Signalements d'un serveur (modérateurs) ou de tout le site (administrateurs, sans serverId). */
action('report:list', z.object({ serverId: id.optional(), status: z.enum(['open', 'resolved', 'dismissed']).default('open') }), async (ctx, data) => {
  if (data.serverId) await requireMember(data.serverId, ctx.userId, P.MODERATE_MEMBERS);
  else if (!(await one('SELECT 1 FROM users WHERE id = $1 AND is_admin', [ctx.userId]))) throw new AppError("Tu n'as pas la permission de faire ça.");
  return query(
    `SELECT r.id, r.reason, r.details, r.message_copy AS "messageCopy", r.message_id AS "messageId", r.status, r.created_at AS "createdAt",
            r.server_id AS "serverId", r.target_user_id AS "targetId", t.username AS "targetName", rp.username AS "reporterName"
       FROM reports r LEFT JOIN users t ON t.id = r.target_user_id LEFT JOIN users rp ON rp.id = r.reporter_id
      WHERE r.status = $1 AND ($2::bigint IS NULL OR r.server_id = $2)
      ORDER BY r.id DESC LIMIT 100`, [data.status, data.serverId ?? null]);
});

action('report:resolve', z.object({ reportId: id, status: z.enum(['resolved', 'dismissed']) }), async (ctx, data) => {
  const report = await one<any>('SELECT server_id FROM reports WHERE id = $1', [data.reportId]);
  if (!report) throw new AppError('Signalement introuvable.');
  if (report.server_id) await requireMember(report.server_id, ctx.userId, P.MODERATE_MEMBERS);
  else if (!(await one('SELECT 1 FROM users WHERE id = $1 AND is_admin', [ctx.userId]))) throw new AppError("Tu n'as pas la permission de faire ça.");
  await query('UPDATE reports SET status = $2, handled_by = $3 WHERE id = $1', [data.reportId, data.status, ctx.userId]);
  if (report.server_id) await audit(report.server_id, ctx.userId, `report_${data.status}`, String(data.reportId));
});
