// Connexions temps réel (Socket.IO sur WebSocket) : authentification par cookie, limites, présence.
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { allowedOrigins } from '../config.js';
import { query } from '../db/pool.js';
import { securityLog } from '../security/audit.js';
import { Limiter } from '../security/limits.js';
import { setUserEmitter } from '../services/bus.js';
import { addConnection, removeConnection } from '../services/presence.js';
import { COOKIE, parseCookieHeader, sessionFromToken } from '../services/sessions.js';
import { emitToUser, serverRoom, setIo, userRoom } from './hub.js';
import { bindHandlers, type Ctx } from './registry.js';
// Chaque fichier enregistre ses actions en étant chargé
import './handlers/users.js';
import './handlers/social.js';
import './handlers/servers.js';
import './handlers/moderation.js';
import './handlers/messages.js';
import { voiceSocketClosed } from './handlers/voice.js';
import { announcePresence } from './handlers/users.js';

const perIp = new Map<string, number>();
const MAX_SOCKETS_PER_IP = 30;

export function attachRealtime(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    maxHttpBufferSize: 100_000,     // 100 Ko par message temps réel
    pingInterval: 20_000,
    pingTimeout: 20_000,
    cors: { origin: [...allowedOrigins], credentials: true },
    // Une page d'un autre site ne peut pas ouvrir de connexion (protection CSRF)
    allowRequest: (req, done) => {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        securityLog('csrf_blocked', { origin: origin.slice(0, 100), url: 'socket.io' });
        return done('origin', false);
      }
      done(null, true);
    },
  });
  setIo(io);
  setUserEmitter((userId, event, payload) => emitToUser(userId, event, payload));

  io.use(async (socket, next) => {
    const ip = (socket.handshake.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() || socket.handshake.address;
    if ((perIp.get(ip) ?? 0) >= MAX_SOCKETS_PER_IP) {
      securityLog('rate_limited', { ip, url: 'socket.io' });
      return next(new Error('too_many'));
    }
    const session = await sessionFromToken(parseCookieHeader(socket.handshake.headers.cookie)[COOKIE]);
    if (!session) return next(new Error('unauthorized'));
    socket.data = { userId: session.userId, sessionId: session.sessionId, ip };
    next();
  });

  io.on('connection', async (socket) => {
    const { userId, sessionId, ip } = socket.data as { userId: number; sessionId: number; ip: string };
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const ctx: Ctx = { socket, userId, sessionId, ip };
    const events = new Limiter(120, 10_000); // 120 actions en 10 secondes, sinon la connexion est coupée
    let flooded = false;
    bindHandlers(socket, ctx, () => {
      if (events.take('x')) return true;
      if (!flooded) {
        flooded = true;
        securityLog('flood', { userId, ip });
        socket.emit('security:alert', { message: 'Trop d’actions envoyées : connexion coupée.' });
        setTimeout(() => socket.disconnect(true), 100);
      }
      return false;
    });

    socket.join(userRoom(userId));
    for (const row of await query<{ server_id: number }>('SELECT server_id FROM members WHERE user_id = $1', [userId])) socket.join(serverRoom(row.server_id));
    addConnection(userId, socket.id);
    await announcePresence(userId);

    socket.on('disconnect', async () => {
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left > 0) perIp.set(ip, left);
      else perIp.delete(ip);
      removeConnection(userId, socket.id);
      await voiceSocketClosed(userId, socket.id);
      await announcePresence(userId);
    });
  });
}
