// Sessions : un badge aléatoire de 256 bits dans un cookie protégé ; seule son empreinte est en base.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { one, query } from '../db/pool.js';
import { randomToken, sha256 } from '../security/crypto.js';
import { deviceName, networkHint } from '../security/text.js';
import { config } from '../config.js';

export const COOKIE = 'gh_session';
const IDLE_DAYS = 30;
const MAX_DAYS = 90;

export const isHttps = (req: FastifyRequest) => req.protocol === 'https';

export async function createSession(userId: number, req: FastifyRequest): Promise<string> {
  const token = randomToken(32);
  await query('INSERT INTO sessions (user_id, token_hash, device, network) VALUES ($1, $2, $3, $4)',
    [userId, sha256(token), deviceName(req.headers['user-agent']), networkHint(req.ip)]);
  return token;
}

export function setSessionCookie(reply: FastifyReply, req: FastifyRequest, token: string) {
  reply.setCookie(COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: isHttps(req) || config.FORCE_HTTPS, maxAge: IDLE_DAYS * 86400,
  });
}

export interface Session { userId: number; sessionId: number; tokenHash: string }

export async function sessionFromToken(token: string | undefined): Promise<Session | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = sha256(token);
  const row = await one<any>(
    `SELECT id, user_id, created_at, last_seen FROM sessions WHERE token_hash = $1`, [tokenHash]);
  if (!row) return null;
  const now = Date.now();
  if (now - +new Date(row.last_seen) > IDLE_DAYS * 864e5 || now - +new Date(row.created_at) > MAX_DAYS * 864e5) {
    await query('DELETE FROM sessions WHERE id = $1', [row.id]);
    return null;
  }
  if (now - +new Date(row.last_seen) > 3600_000) await query('UPDATE sessions SET last_seen = now() WHERE id = $1', [row.id]);
  return { userId: row.user_id, sessionId: row.id, tokenHash };
}

export const sessionFromRequest = (req: FastifyRequest) => sessionFromToken(req.cookies[COOKIE]);

export function parseCookieHeader(header = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
