// Inscription, connexion (avec double authentification) et déconnexion.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminEmails, config } from '../config.js';
import { one, query } from '../db/pool.js';
import { securityLog } from '../security/audit.js';
import { decryptText, encryptText, fingerprint, randomToken, safeEqual } from '../security/crypto.js';
import { Limiter } from '../security/limits.js';
import { checkPassword, hashPassword, passwordProblem } from '../security/passwords.js';
import { clean, deviceName, networkHint } from '../security/text.js';
import { verifyTotp } from '../security/totp.js';
import { notifyUser } from '../services/bus.js';
import { COOKIE, createSession, sessionFromRequest, setSessionCookie } from '../services/sessions.js';
import { sha256 } from '../security/crypto.js';

export const USERNAME_RE = /^[\p{L}\p{N}_.-]{2,16}$/u;
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

const signupLimit = new Limiter(config.SIGNUPS_PER_HOUR, 3600_000); // comptes par adresse et par heure
const failsPerIp = new Limiter(10, 600_000);     // 10 erreurs par adresse en 10 min
const failsPerAccount = new Limiter(10, 900_000); // 10 erreurs par compte en 15 min
const tickets = new Map<string, { userId: number; expires: number; tries: number }>();

const text = (max: number) => z.string().max(max).transform(clean);

export async function logSecurity(userId: number, kind: string, details: string) {
  await query('INSERT INTO security_events (user_id, kind, details) VALUES ($1, $2, $3)', [userId, kind, details.slice(0, 200)]);
  await query(`DELETE FROM security_events WHERE user_id = $1 AND id NOT IN
                 (SELECT id FROM security_events WHERE user_id = $1 ORDER BY id DESC LIMIT 50)`, [userId]);
}

async function loginSucceeded(userId: number, req: FastifyRequest) {
  const device = deviceName(req.headers['user-agent']);
  const network = networkHint(req.ip);
  const print = fingerprint(`${device}|${network}`);
  const known = await one<{ n: number }>('SELECT count(*)::int AS n FROM known_devices WHERE user_id = $1', [userId]);
  const inserted = await query('INSERT INTO known_devices (user_id, fingerprint) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [userId, print]);
  if (inserted.length && known!.n > 0) {
    securityLog('unusual_login', { userId, device, network });
    await logSecurity(userId, 'new_device', `${device} · réseau ${network}`);
    notifyUser(userId, 'security:alert', {
      message: `Nouvelle connexion à ton compte : ${device}, réseau ${network}. Si ce n'est pas toi, change ton mot de passe tout de suite.`,
    });
  }
  await logSecurity(userId, 'login', `${device} · réseau ${network}`);
  securityLog('login', { userId, ip: req.ip });
  return createSession(userId, req);
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => ({
    signupCodeRequired: !!config.SIGNUP_CODE,
    maxUploadMb: config.MAX_UPLOAD_MB,
  }));

  app.post('/api/auth/register', async (req, reply) => {
    if (signupLimit.blocked(req.ip)) return reply.code(429).send({ error: "Trop d'inscriptions depuis cette adresse. Réessaie plus tard." });
    const body = z.object({ email: text(200), username: text(40), password: z.string().max(200), signupCode: text(100).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Données invalides.' });
    const { password } = body.data;
    const email = body.data.email.trim().toLowerCase();
    const username = body.data.username.trim();
    if (config.SIGNUP_CODE && !safeEqual(sha256(body.data.signupCode?.trim() ?? ''), sha256(config.SIGNUP_CODE))) {
      signupLimit.hit(req.ip);
      return reply.code(400).send({ error: "Code d'inscription incorrect." });
    }
    if (!EMAIL_RE.test(email) || email.length > 120) return reply.code(400).send({ error: 'Adresse e-mail invalide.' });
    if (!USERNAME_RE.test(username)) return reply.code(400).send({ error: 'Le pseudo doit faire 2 à 16 caractères (lettres, chiffres, _ . -).' });
    const problem = passwordProblem(password, username, email);
    if (problem) return reply.code(400).send({ error: problem });
    const emailHash = fingerprint(email);
    if (await one('SELECT 1 FROM users WHERE email_hash = $1', [emailHash])) return reply.code(400).send({ error: 'Cet e-mail est déjà utilisé.' });
    if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) return reply.code(400).send({ error: 'Ce pseudo est déjà pris.' });
    const user = await one<{ id: number }>(
      `INSERT INTO users (email_hash, email_enc, username, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [emailHash, encryptText(email), username, await hashPassword(password), adminEmails.has(email)],
    );
    signupLimit.hit(req.ip);
    securityLog('register', { userId: user!.id, ip: req.ip });
    setSessionCookie(reply, req, await loginSucceeded(user!.id, req));
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (failsPerIp.blocked(req.ip)) {
      securityLog('ip_blocked', { ip: req.ip });
      return reply.code(429).send({ error: 'Trop de tentatives. Réessaie dans quelques minutes.' });
    }
    const body = z.object({ email: text(200), password: z.string().max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Données invalides.' });
    const emailHash = fingerprint(body.data.email.trim().toLowerCase());
    if (failsPerAccount.blocked(emailHash)) {
      securityLog('account_locked', { account: emailHash.slice(0, 14), ip: req.ip });
      return reply.code(429).send({ error: 'Trop de mauvais mots de passe pour ce compte. Réessaie dans 15 minutes.' });
    }
    const user = await one<any>('SELECT id, password_hash, totp_secret_enc FROM users WHERE email_hash = $1', [emailHash]);
    if (!(await checkPassword(body.data.password, user?.password_hash))) {
      failsPerIp.hit(req.ip);
      failsPerAccount.hit(emailHash);
      securityLog('bad_password', { account: emailHash.slice(0, 14), ip: req.ip });
      if (user) await logSecurity(user.id, 'failed', `Mauvais mot de passe · réseau ${networkHint(req.ip)}`);
      return reply.code(400).send({ error: 'E-mail ou mot de passe incorrect.' });
    }
    if (user.totp_secret_enc) {
      const ticket = randomToken(24);
      for (const [k, v] of tickets) if (v.expires < Date.now()) tickets.delete(k);
      tickets.set(ticket, { userId: user.id, expires: Date.now() + 300_000, tries: 0 });
      return { twoFactor: true, ticket };
    }
    failsPerAccount.reset(emailHash);
    setSessionCookie(reply, req, await loginSucceeded(user.id, req));
    return { ok: true };
  });

  app.post('/api/auth/2fa', async (req, reply) => {
    if (failsPerIp.blocked(req.ip)) return reply.code(429).send({ error: 'Trop de tentatives. Réessaie dans quelques minutes.' });
    const body = z.object({ ticket: z.string().max(100), code: text(20) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Données invalides.' });
    const ticket = tickets.get(body.data.ticket);
    if (!ticket || ticket.expires < Date.now()) return reply.code(401).send({ error: 'Délai dépassé : recommence la connexion.' });
    const user = await one<any>('SELECT id, totp_secret_enc, totp_last_step, recovery_codes FROM users WHERE id = $1', [ticket.userId]);
    const code = body.data.code.replace(/\s/g, '').toLowerCase();
    let valid = false;
    if (/^\d{6}$/.test(code) && user?.totp_secret_enc) {
      const step = verifyTotp(decryptText(user.totp_secret_enc), code, Number(user.totp_last_step));
      if (step !== null) {
        await query('UPDATE users SET totp_last_step = $1 WHERE id = $2', [step, user.id]);
        valid = true;
      }
    } else if (/^[0-9a-f]{6}-[0-9a-f]{6}$/.test(code) && user) {
      const hash = fingerprint(code);
      const used = await query('UPDATE users SET recovery_codes = array_remove(recovery_codes, $1) WHERE id = $2 AND $1 = ANY(recovery_codes) RETURNING cardinality(recovery_codes) AS left', [hash, user.id]);
      if (used.length) {
        valid = true;
        await logSecurity(user.id, 'recovery_code', `Code de secours utilisé · il en reste ${used[0].left}`);
      }
    }
    if (!valid) {
      ticket.tries += 1;
      failsPerIp.hit(req.ip);
      securityLog('2fa_failed', { userId: ticket.userId, ip: req.ip });
      if (ticket.tries >= 5) {
        tickets.delete(body.data.ticket);
        securityLog('2fa_failures', { userId: ticket.userId, ip: req.ip });
        await logSecurity(ticket.userId, 'failed', `5 mauvais codes de double authentification · réseau ${networkHint(req.ip)}`);
        return reply.code(401).send({ error: 'Trop de codes incorrects : recommence la connexion.' });
      }
      return reply.code(400).send({ error: 'Code incorrect.' });
    }
    tickets.delete(body.data.ticket);
    setSessionCookie(reply, req, await loginSucceeded(ticket.userId, req));
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const session = await sessionFromRequest(req);
    if (session) await query('DELETE FROM sessions WHERE id = $1', [session.sessionId]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
}
