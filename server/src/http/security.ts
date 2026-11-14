// Protections appliquées à TOUTES les requêtes HTTP.
import type { FastifyInstance } from 'fastify';
import { allowedOrigins, config } from '../config.js';
import { securityLog } from '../security/audit.js';
import { Limiter } from '../security/limits.js';

const perIp = new Limiter(600, 60_000); // 600 requêtes par minute et par adresse

export function registerSecurity(app: FastifyInstance) {
  const livekitOrigin = new URL(config.LIVEKIT_PUBLIC_URL).origin;
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' ${livekitOrigin} ${livekitOrigin.replace(/^ws/, 'http')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');

  app.addHook('onRequest', async (req, reply) => {
    // 1. HTTPS obligatoire en production
    if (config.FORCE_HTTPS && req.protocol !== 'https' && req.url !== '/healthz') {
      if (req.method === 'GET' || req.method === 'HEAD') return reply.redirect(`https://${req.hostname}${req.url}`, 308);
      return reply.code(403).send({ error: 'HTTPS obligatoire.' });
    }
    // 2. Limite de requêtes par adresse (contre les robots et la saturation)
    if (!req.url.startsWith('/socket.io') && !perIp.take(req.ip)) {
      securityLog('rate_limited', { ip: req.ip, url: req.url.slice(0, 100) });
      return reply.code(429).send({ error: 'Trop de requêtes : ralentis un peu.' });
    }
    // 3. Protection CSRF : une action venant d'un autre site est refusée
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url !== '/api/livekit/webhook') {
      let origin = req.headers.origin;
      if (!origin && req.headers.referer) {
        try { origin = new URL(req.headers.referer).origin; } catch { origin = 'invalide'; }
      }
      if (origin && !allowedOrigins.has(origin)) {
        securityLog('csrf_blocked', { ip: req.ip, origin: String(origin).slice(0, 100), url: req.url.slice(0, 100) });
        return reply.code(403).send({ error: 'Requête refusée (autre site).' });
      }
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Content-Security-Policy', reply.getHeader('Content-Security-Policy') ?? csp);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'microphone=(self), camera=(self), display-capture=(self), geolocation=(), payment=(), usb=()');
    if (req.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    if (req.url.startsWith('/api/') && !reply.getHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    reply.removeHeader('X-Powered-By');
    return payload;
  });
}
