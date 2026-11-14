// Aperçu public d'un lien d'invitation (nom du serveur, icône, nombre de membres).
import type { FastifyInstance } from 'fastify';
import { one } from '../db/pool.js';
import { uploadUrl } from '../services/serialize.js';
import { isConnected } from '../services/presence.js';
import { query } from '../db/pool.js';

export async function findValidInvite(code: string) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(code)) return null;
  const invite = await one<any>(
    `SELECT i.*, s.name, s.icon_id FROM invites i JOIN servers s ON s.id = i.server_id
      WHERE i.code = $1 AND (i.expires_at IS NULL OR i.expires_at > now()) AND (i.max_uses IS NULL OR i.uses < i.max_uses)`, [code]);
  return invite;
}

export function registerInviteRoutes(app: FastifyInstance) {
  app.get('/api/invites/:code', async (req, reply) => {
    const invite = await findValidInvite((req.params as { code: string }).code);
    if (!invite) return reply.code(404).send({ error: "Cette invitation n'existe pas ou a expiré." });
    const members = await query<{ user_id: number }>('SELECT user_id FROM members WHERE server_id = $1', [invite.server_id]);
    return {
      code: invite.code,
      server: { id: invite.server_id, name: invite.name, icon: null as string | null, hasIcon: !!invite.icon_id },
      memberCount: members.length,
      onlineCount: members.filter((m) => isConnected(m.user_id)).length,
      iconUrl: invite.icon_id ? uploadUrl(invite.icon_id) : null,
    };
  });
}
