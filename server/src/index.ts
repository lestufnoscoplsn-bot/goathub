// Point de départ du serveur GoatHub.
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { registerAuthRoutes } from './http/auth.js';
import { registerInviteRoutes } from './http/invites.js';
import { registerLivekitWebhook } from './http/livekit-webhook.js';
import { registerSecurity } from './http/security.js';
import { registerUploadRoutes } from './http/uploads.js';
import { attachRealtime } from './realtime/socket.js';
import { securityLog } from './security/audit.js';

await mkdir(config.DATA_DIR, { recursive: true, mode: 0o700 });
await migrate();

const app = Fastify({
  trustProxy: config.TRUST_PROXY,
  bodyLimit: 64 * 1024, // 64 Ko pour les données JSON (les fichiers ont leur propre limite)
  // Pas de journal de chaque visite (moins de données personnelles conservées)
  logger: { level: 'warn' },
});

await app.register(cookie);
registerSecurity(app);
registerAuthRoutes(app);
registerUploadRoutes(app);
registerInviteRoutes(app);
registerLivekitWebhook(app);
app.get('/healthz', async () => ({ ok: true }));

// L'interface (React) une fois construite
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist, wildcard: false, index: false });
  app.get('/assets/*', (req, reply) => reply.sendFile(req.url.split('?')[0].slice(1), { maxAge: '365d', immutable: true }));
  // Toutes les autres adresses (/, /channels/…, /invite/…) affichent l'application
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/socket.io')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Introuvable.' });
  });
}

app.setErrorHandler((error: any, _req, reply) => {
  if (error.statusCode === 413) return reply.code(413).send({ error: `Fichier trop volumineux (${config.MAX_UPLOAD_MB} Mo maximum).` });
  if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({ error: 'Requête invalide.' });
  app.log.error(error);
  return reply.code(500).send({ error: 'Erreur du serveur.' });
});

await app.ready();
attachRealtime(app.server);
await app.listen({ port: config.PORT, host: '0.0.0.0' });
securityLog('startup');
console.log(`GoatHub démarré sur le port ${config.PORT}`);

const stop = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
