// Envoi et lecture des fichiers (photos, vidéos, documents).
import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { one } from '../db/pool.js';
import { securityLog } from '../security/audit.js';
import { randomId } from '../security/crypto.js';
import { Limiter } from '../security/limits.js';
import { clean } from '../security/text.js';
import { canSeeChannel } from '../services/access.js';
import { sessionFromRequest } from '../services/sessions.js';

const dir = path.join(config.DATA_DIR, 'uploads');
const perUser = new Limiter(60, 3600_000);

const TYPES: Record<string, { mime: string; kind: 'image' | 'video' | 'audio' | 'file' }> = {
  png: { mime: 'image/png', kind: 'image' }, jpg: { mime: 'image/jpeg', kind: 'image' }, jpeg: { mime: 'image/jpeg', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' }, webp: { mime: 'image/webp', kind: 'image' },
  mp4: { mime: 'video/mp4', kind: 'video' }, webm: { mime: 'video/webm', kind: 'video' }, mov: { mime: 'video/quicktime', kind: 'video' },
  mp3: { mime: 'audio/mpeg', kind: 'audio' }, ogg: { mime: 'audio/ogg', kind: 'audio' }, wav: { mime: 'audio/wav', kind: 'audio' },
};

/** Vérifie que le contenu correspond bien au type annoncé (un fichier piégé peut changer d'extension). */
function contentMatches(ext: string, data: Buffer): boolean {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => data[at + i] === b);
  switch (ext) {
    case 'png': return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg': case 'jpeg': return starts([0xff, 0xd8, 0xff]);
    case 'gif': return data.subarray(0, 6).toString('latin1').startsWith('GIF8');
    case 'webp': return data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'mp4': case 'mov': return data.subarray(4, 8).toString('latin1') === 'ftyp';
    case 'webm': return starts([0x1a, 0x45, 0xdf, 0xa3]);
    default: return true;
  }
}

export function registerUploadRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: config.MAX_UPLOAD_MB * 1024 * 1024 },
    (_req, body, done) => done(null, body));

  app.post('/api/uploads', { bodyLimit: config.MAX_UPLOAD_MB * 1024 * 1024 }, async (req, reply) => {
    const session = await sessionFromRequest(req);
    if (!session) return reply.code(401).send({ error: 'Connexion requise.' });
    if (!perUser.take(String(session.userId))) {
      securityLog('upload_limit', { userId: session.userId });
      return reply.code(429).send({ error: 'Tu as envoyé beaucoup de fichiers : attends un peu.' });
    }
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || !data.length) return reply.code(400).send({ error: 'Fichier vide.' });
    let filename = 'fichier';
    try { filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'fichier')); } catch { /* nom illisible */ }
    filename = clean(path.basename(filename.replace(/\\/g, '/'))).trim().slice(0, 120) || 'fichier';
    const ext = (filename.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
    const known = TYPES[ext];
    if (known && !contentMatches(ext, data)) return reply.code(400).send({ error: "Le contenu de ce fichier ne correspond pas à son type." });
    const id = randomId();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, id), data, { mode: 0o600 });
    const type = known ?? { mime: 'application/octet-stream', kind: 'file' as const };
    await one('INSERT INTO uploads (id, owner_id, filename, stored, mime, kind, size) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, session.userId, filename, id, type.mime, type.kind, data.length]);
    return { id, url: `/api/uploads/${id}`, name: filename, size: data.length, kind: type.kind };
  });

  app.get('/api/uploads/:id', async (req, reply) => {
    const session = await sessionFromRequest(req);
    if (!session) return reply.code(401).send({ error: 'Connexion requise.' });
    const { id } = req.params as { id: string };
    if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return reply.code(404).send({ error: 'Introuvable.' });
    const file = await one<any>('SELECT * FROM uploads WHERE id = $1', [id]);
    if (!file) return reply.code(404).send({ error: 'Introuvable.' });
    // Un fichier envoyé dans un salon n'est visible que par ceux qui voient ce salon
    if (file.channel_id && file.owner_id !== session.userId && !(await canSeeChannel(file.channel_id, session.userId))) {
      return reply.code(404).send({ error: 'Introuvable.' });
    }
    const inline = file.kind !== 'file';
    reply.header('Content-Type', file.mime);
    reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.send(createReadStream(path.join(dir, file.stored)));
  });
}
