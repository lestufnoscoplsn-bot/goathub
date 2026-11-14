// Démarrage de l'appli, profil, statut, sécurité du compte et double authentification.
import { z } from 'zod';
import { config } from '../../config.js';
import { one, query } from '../../db/pool.js';
import { logSecurity, USERNAME_RE } from '../../http/auth.js';
import { securityLog } from '../../security/audit.js';
import { decryptText, encryptText, fingerprint } from '../../security/crypto.js';
import { checkPassword, hashPassword, passwordProblem } from '../../security/passwords.js';
import { newRecoveryCodes, newTotpSecret, qrDataUrl, totpUri, verifyTotp } from '../../security/totp.js';
import { canSeeChannel } from '../../services/access.js';
import { AppError } from '../../services/errors.js';
import { setIdle, statusChange } from '../../services/presence.js';
import { getUser, publicUser, serverPayload, USER_COLS } from '../../services/serialize.js';
import { activeVoiceChannels, callPayload, calls, voiceUsers } from '../../services/voice.js';
import { getIo, presenceAudience } from '../hub.js';
import { action, id, txt, type Ctx } from '../registry.js';
import { dmList, relationList } from './social.js';

/** Annonce le statut d'un utilisateur à ceux qui doivent le voir (s'il a changé). */
export async function announcePresence(userId: number) {
  const row = await one<{ status: string }>('SELECT status FROM users WHERE id = $1', [userId]);
  if (!row) return;
  const status = statusChange(userId, row.status);
  if (status) getIo().to(await presenceAudience(userId)).emit('presence', { userId, status });
}

async function unreadStates(userId: number) {
  const rows = await query<any>(
    `WITH visible AS (
       SELECT c.id, c.server_id FROM channels c JOIN members m ON m.server_id = c.server_id AND m.user_id = $1 WHERE c.type = 'text'
       UNION ALL
       SELECT c.id, NULL FROM channels c JOIN channel_recipients r ON r.channel_id = c.id AND r.user_id = $1
     )
     SELECT v.id, v.server_id,
            count(msg.id)::int AS unread,
            count(msg.id) FILTER (WHERE v.server_id IS NULL OR $1 = ANY(msg.mentions) OR msg.mention_everyone)::int AS mentions
       FROM visible v
       LEFT JOIN read_states rs ON rs.channel_id = v.id AND rs.user_id = $1
       JOIN messages msg ON msg.channel_id = v.id AND msg.id > COALESCE(rs.last_read_id, 0) AND msg.author_id IS DISTINCT FROM $1
      GROUP BY v.id, v.server_id`, [userId]);
  return Object.fromEntries(rows.map((r) => [r.id, { unread: r.unread, mentions: r.mentions }]));
}

async function requirePassword(ctx: Ctx, password: string) {
  const user = await one<any>('SELECT * FROM users WHERE id = $1', [ctx.userId]);
  if (!(await checkPassword(password, user?.password_hash))) {
    securityLog('bad_password_open_session', { userId: ctx.userId, ip: ctx.ip });
    throw new AppError('Mot de passe actuel incorrect.');
  }
  return user;
}

/** Déconnecte toutes les autres sessions du compte (et ferme leurs fenêtres). */
export async function revokeOtherSessions(ctx: Ctx): Promise<number> {
  const removed = await query<{ id: number }>('DELETE FROM sessions WHERE user_id = $1 AND id <> $2 RETURNING id', [ctx.userId, ctx.sessionId]);
  const ids = new Set(removed.map((r) => r.id));
  for (const socket of await getIo().in(`user:${ctx.userId}`).fetchSockets()) {
    if (ids.has(socket.data.sessionId)) socket.disconnect(true);
  }
  return ids.size;
}

action('init', z.object({}), async (ctx) => {
  const me = await one<any>(`SELECT ${USER_COLS}, u.email_enc, u.totp_secret_enc, u.is_admin FROM users u WHERE u.id = $1`, [ctx.userId]);
  const serverIds = (await query<{ server_id: number }>('SELECT server_id FROM members WHERE user_id = $1 ORDER BY joined_at', [ctx.userId])).map((r) => r.server_id);
  const voiceStates: Record<number, unknown> = {};
  for (const channelId of activeVoiceChannels()) {
    if (await canSeeChannel(channelId, ctx.userId)) voiceStates[channelId] = voiceUsers(channelId);
  }
  const activeCalls = [];
  for (const call of calls.values()) if (await canSeeChannel(call.channelId, ctx.userId)) activeCalls.push(callPayload(call));
  return {
    me: {
      ...publicUser(me),
      statusPref: me.status,
      email: decryptText(me.email_enc),
      twoFactor: !!me.totp_secret_enc,
      isAdmin: me.is_admin,
    },
    servers: (await Promise.all(serverIds.map(serverPayload))).filter(Boolean),
    dms: await dmList(ctx.userId),
    relations: await relationList(ctx.userId),
    reads: await unreadStates(ctx.userId),
    voiceStates,
    calls: activeCalls,
    livekitUrl: config.LIVEKIT_PUBLIC_URL,
    publicUrl: config.PUBLIC_URL,
  };
});

action('profile:update', z.object({
  username: txt(40).optional(),
  bio: txt(190).optional(),
  customStatus: txt(80).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatarId: z.string().regex(/^[A-Za-z0-9_-]{22}$/).nullable().optional(),
}), async (ctx, data) => {
  if (data.username !== undefined) {
    if (!USERNAME_RE.test(data.username)) throw new AppError('Le pseudo doit faire 2 à 16 caractères (lettres, chiffres, _ . -).');
    if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2', [data.username, ctx.userId])) throw new AppError('Ce pseudo est déjà pris.');
  }
  if (data.avatarId) {
    const file = await one<any>('SELECT kind, owner_id FROM uploads WHERE id = $1', [data.avatarId]);
    if (!file || file.owner_id !== ctx.userId || file.kind !== 'image') throw new AppError('Image invalide.');
  }
  await query(
    `UPDATE users SET username = COALESCE($2, username), bio = COALESCE($3, bio), custom_status = COALESCE($4, custom_status),
            accent_color = COALESCE($5, accent_color), avatar_id = CASE WHEN $6::boolean THEN $7 ELSE avatar_id END WHERE id = $1`,
    [ctx.userId, data.username ?? null, data.bio ?? null, data.customStatus ?? null, data.accentColor ?? null,
      data.avatarId !== undefined, data.avatarId ?? null]);
  const user = await getUser(ctx.userId);
  getIo().to(await presenceAudience(ctx.userId)).emit('user:update', user);
  return user;
});

action('status:set', z.object({ status: z.enum(['online', 'idle', 'dnd', 'invisible']) }), async (ctx, { status }) => {
  await query('UPDATE users SET status = $1 WHERE id = $2', [status, ctx.userId]);
  await announcePresence(ctx.userId);
  return { status };
});

action('idle', z.object({ idle: z.boolean() }), async (ctx, { idle }) => {
  setIdle(ctx.userId, ctx.socket.id, idle);
  await announcePresence(ctx.userId);
});

// ----- Sécurité du compte -----

action('account:password', z.object({ current: z.string().max(200), next: z.string().max(200) }), async (ctx, data) => {
  const user = await requirePassword(ctx, data.current);
  const problem = passwordProblem(data.next, user.username, decryptText(user.email_enc));
  if (problem) throw new AppError(problem);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(data.next), ctx.userId]);
  await logSecurity(ctx.userId, 'password', 'Mot de passe changé');
  securityLog('password_changed', { userId: ctx.userId, ip: ctx.ip });
  return { loggedOut: await revokeOtherSessions(ctx) };
});

action('security:status', z.object({}), async (ctx) => {
  const user = await one<any>('SELECT totp_secret_enc, cardinality(recovery_codes) AS codes FROM users WHERE id = $1', [ctx.userId]);
  const sessions = await query<any>('SELECT id, device, network, created_at, last_seen FROM sessions WHERE user_id = $1 ORDER BY last_seen DESC', [ctx.userId]);
  const events = await query<any>('SELECT kind, details, created_at FROM security_events WHERE user_id = $1 ORDER BY id DESC LIMIT 30', [ctx.userId]);
  return {
    twoFactor: !!user.totp_secret_enc,
    recoveryLeft: user.codes,
    sessions: sessions.map((s) => ({ id: s.id, device: s.device, network: s.network, createdAt: s.created_at, lastSeen: s.last_seen, current: s.id === ctx.sessionId })),
    events: events.map((e) => ({ kind: e.kind, details: e.details, at: e.created_at })),
  };
});

action('session:revoke', z.object({ id }), async (ctx, { id: sessionId }) => {
  if (sessionId === ctx.sessionId) throw new AppError("C'est l'appareil que tu utilises : utilise « Déconnexion ».");
  const removed = await query('DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id', [sessionId, ctx.userId]);
  if (!removed.length) throw new AppError('Appareil introuvable.');
  for (const socket of await getIo().in(`user:${ctx.userId}`).fetchSockets()) if (socket.data.sessionId === sessionId) socket.disconnect(true);
  await logSecurity(ctx.userId, 'revoked', 'Un appareil a été déconnecté');
});

action('sessions:revoke-others', z.object({}), async (ctx) => {
  const count = await revokeOtherSessions(ctx);
  await logSecurity(ctx.userId, 'revoked', `${count} autre(s) appareil(s) déconnecté(s)`);
  return { count };
});

action('2fa:setup', z.object({ password: z.string().max(200) }), async (ctx, { password }) => {
  const user = await requirePassword(ctx, password);
  if (user.totp_secret_enc) throw new AppError('La double authentification est déjà activée.');
  const secret = newTotpSecret();
  await query('UPDATE users SET totp_pending_enc = $1 WHERE id = $2', [encryptText(secret), ctx.userId]);
  return { qr: await qrDataUrl(totpUri(secret, user.username)), secret: secret.match(/.{4}/g)!.join(' ') };
});

action('2fa:enable', z.object({ code: z.string().max(10) }), async (ctx, { code }) => {
  const user = await one<any>('SELECT totp_pending_enc FROM users WHERE id = $1', [ctx.userId]);
  if (!user?.totp_pending_enc) throw new AppError("Recommence l'activation.");
  const secret = decryptText(user.totp_pending_enc);
  const step = verifyTotp(secret, code, 0);
  if (step === null) throw new AppError("Code incorrect. Vérifie l'heure de ton téléphone et réessaie.");
  const codes = newRecoveryCodes();
  await query('UPDATE users SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_last_step = $2, recovery_codes = $3 WHERE id = $1',
    [ctx.userId, step, codes.map(fingerprint)]);
  await logSecurity(ctx.userId, '2fa', 'Double authentification activée');
  securityLog('2fa_enabled', { userId: ctx.userId });
  await revokeOtherSessions(ctx);
  return { recoveryCodes: codes };
});

action('2fa:disable', z.object({ password: z.string().max(200), code: z.string().max(10) }), async (ctx, data) => {
  const user = await requirePassword(ctx, data.password);
  if (!user.totp_secret_enc) throw new AppError("La double authentification n'est pas activée.");
  const step = verifyTotp(decryptText(user.totp_secret_enc), data.code, Number(user.totp_last_step));
  if (step === null) throw new AppError('Code de double authentification incorrect.');
  await query("UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, recovery_codes = '{}', totp_last_step = $2 WHERE id = $1", [ctx.userId, step]);
  await logSecurity(ctx.userId, '2fa', 'Double authentification désactivée');
  securityLog('2fa_disabled', { userId: ctx.userId, ip: ctx.ip });
});

action('2fa:recovery', z.object({ password: z.string().max(200) }), async (ctx, { password }) => {
  const user = await requirePassword(ctx, password);
  if (!user.totp_secret_enc) throw new AppError("La double authentification n'est pas activée.");
  const codes = newRecoveryCodes();
  await query('UPDATE users SET recovery_codes = $2 WHERE id = $1', [ctx.userId, codes.map(fingerprint)]);
  await logSecurity(ctx.userId, '2fa', 'Nouveaux codes de secours créés');
  return { recoveryCodes: codes };
});
